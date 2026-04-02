/**
 * Bot Controller — Phase 3 of Cipher Swarm Bot
 *
 * Ties Phase 0 (BlockTracker) + Phase 1 (Gatekeeper) + Phase 2 (SwarmEngine) together.
 * Runs on every tick. Gates pass → get proposal → extract real impliedProb → swarm votes → green light → execute.
 *
 * Key design decisions:
 * 1. Uses real impliedProb from proposal (askPrice / payout), NOT a static estimate.
 * 2. Receives gateResult from caller — no double evaluation.
 * 3. Execution timeout prevents permanently stuck state.
 * 4. Contract type is ONETOUCH for both UP/DOWN — barrier sign controls direction.
 * 5. Auto-pauses after 2 consecutive losses.
 * 6. Every trade is logged to SQLite via TradeLogger (Phase 4).
 */

const EventEmitter = require('events');
const TradeLogger = require('./tradeLogger');

const EXECUTION_TIMEOUT_MS = 15000; // 15s safety timeout

class BotController extends EventEmitter {
    constructor({ blockTracker, gatekeeper, swarmEngine, tradingEngine, broadcast, accountMode = 'demo' }) {
        super();
        this.block = blockTracker;
        this.gate = gatekeeper;
        this.swarm = swarmEngine;
        this.trading = tradingEngine;
        this.broadcast = broadcast;
        this.accountMode = accountMode;  // 'demo' or 'real'

        // Trade logger (Phase 4)
        this.logger = new TradeLogger();

        // Bot state
        this.enabled = false;
        this.stake = 1.00;
        this.consecutiveLosses = 0;
        this.isPaused = false;
        this._pendingExecution = false;
        this._executionTimer = null;
        this._cooldownUntil = 0;        // epoch — no proposals until this time passes

        // Session stats
        this.sessionStats = {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            totalStaked: 0,
            totalPayout: 0
        };

        // Last decision snapshot (for dashboard/debugging)
        this._lastDecision = null;

        // Listen for trade outcomes
        this.trading.on('trade_outcome', (outcome) => {
            this._handleOutcome(outcome);
        });
    }

    /**
     * Core tick handler. Called from index.js on every tick.
     *
     * @param {number} epoch - tick epoch in seconds
     * @param {number} price - current tick price
     * @param {number} barrier - barrier distance in points (from uiConfig)
     * @param {Object} gateResult - result from gatekeeper.evaluate() (already computed)
     */
    async onTick(epoch, price, barrier, gateResult) {
        // Guard: bot off, paused, or trade in flight
        if (!this.enabled || this.isPaused || this._pendingExecution) return;

        // Cooldown after rejection/trade — don't re-poll every tick
        if (epoch < this._cooldownUntil) {
            const remaining = Math.ceil(this._cooldownUntil - epoch);
            // Log once when cooldown first blocks (every 10s to avoid spam)
            if (remaining % 10 === 0 && gateResult.unlocked) {
                console.log(`[BOT] ⏳ Cooldown active — ${remaining}s remaining (gates are open but waiting)`);
            }
            return;
        }

        // Step 1: Check gatekeeper (already evaluated in index.js, no double call)
        if (!gateResult.unlocked) {
            this._lastDecision = { stage: 'GATE_LOCKED', gateResult, timestamp: epoch };
            return;
        }

        const direction = gateResult.direction; // 'UP' or 'DOWN'

        // Step 2: Get proposal FIRST — extract real impliedProb from market
        // Barrier sign controls direction: +barrier for UP, -barrier for DOWN
        const signedBarrier = direction === 'UP'
            ? `+${barrier}`
            : `-${barrier}`;

        this._pendingExecution = true;
        this._startExecutionTimeout();

        let proposal;
        try {
            proposal = await this.trading.getProposal({
                amount: this.stake,
                contract_type: 'ONETOUCH',  // Always ONETOUCH — barrier sign controls direction
                barrier: signedBarrier,
                duration: 2,
                duration_unit: 'm',         // 2 minutes — matches contract window
                basis: 'stake',
                currency: 'USD'
            });
        } catch (err) {
            console.error(`[BOT] ✗ Proposal failed: ${err.message}`);
            this._clearExecution();
            this._lastDecision = { stage: 'PROPOSAL_FAILED', error: err.message, timestamp: epoch };
            return;
        }

        // Step 3: Extract REAL implied probability from proposal
        // impliedProb = askPrice / payout (what the market thinks the touch probability is)
        const impliedProb = proposal.askPrice / proposal.payout;

        // Step 4: Swarm votes with REAL market pricing
        const swarmResult = this.swarm.vote(barrier, price, impliedProb, direction);

        // V3: Hard veto — if Steady Hand sees negative edge, the expansion is exhausted.
        // Don't trade even if 3/4 consensus passes. SH's job is detecting sustained energy.
        const shEdge = swarmResult.votes.steadyHand.edge;
        const shVeto = shEdge !== null && shEdge < 0;

        if (!swarmResult.greenLight || shVeto) {
            const rejectReason = shVeto
                ? `SH veto (edge=${shEdge}) — expansion exhausted`
                : `consensus ${swarmResult.consensus}/4`;
            console.log(`[BOT] ○ Swarm rejected (${rejectReason}) | impliedProb: ${(impliedProb * 100).toFixed(1)}% | cooldown 60s`);
            this._clearExecution();
            this._cooldownUntil = epoch + 60;  // V3: 60s cooldown (was 30s) — prevent re-entering same exhausted move
            this._lastDecision = {
                stage: 'SWARM_REJECTED',
                swarmResult,
                impliedProb,
                proposal: { askPrice: proposal.askPrice, payout: proposal.payout },
                timestamp: epoch
            };
            return;
        }

        // Step 5: GREEN LIGHT — Execute the trade
        this.block.tradeCount++;

        console.log(`[BOT] ✓ GREEN LIGHT — ${direction} | Consensus: ${swarmResult.consensus}/4 | ` +
            `Edge: FR=${swarmResult.votes.fastReader.edge}, SH=${swarmResult.votes.steadyHand.edge} | ` +
            `impliedProb: ${(impliedProb * 100).toFixed(1)}% | Stake: $${this.stake}`);

        try {
            const tradeRecord = await this.trading.executeBuy(
                proposal.proposalId,
                proposal.askPrice,  // maxPrice = askPrice (pay what they want)
                'cipher_bot'        // ownerId for tracking
            );

            this.sessionStats.totalTrades++;
            this.sessionStats.totalStaked += this.stake;

            console.log(`[BOT] ✓ Trade placed — Contract #${tradeRecord.contractId} | Cost: $${tradeRecord.buyPrice}`);

            const blockState = this.block.getState();

            // Phase 4: Log trade to SQLite
                try {
                    this.logger.logTrade({
                        timestamp: epoch,
                        blockState,
                        gateResult,
                        swarmResult,
                        direction,
                        barrier,
                        stake: this.stake,
                        impliedProb,
                        contractId: tradeRecord.contractId,
                        buyPrice: tradeRecord.buyPrice,
                        potentialPayout: tradeRecord.payout,
                        accountMode: this.accountMode
                    });
                    console.log(`[BOT] 📝 Trade logged to DB (${this.accountMode})`);
            } catch (logErr) {
                console.error(`[BOT] ⚠ Failed to log trade: ${logErr.message}`);
            }

            this._lastDecision = {
                stage: 'TRADE_EXECUTED',
                direction,
                swarmResult,
                impliedProb,
                contractId: tradeRecord.contractId,
                buyPrice: tradeRecord.buyPrice,
                payout: tradeRecord.payout,
                timestamp: epoch,
                blockState
            };

            this.emit('trade_executed', this._lastDecision);

        } catch (err) {
            console.error(`[BOT] ✗ Trade execution failed: ${err.message}`);
            // Still count it — prevents retrying the same block endlessly
            this._lastDecision = { stage: 'EXECUTION_FAILED', error: err.message, timestamp: epoch };
        } finally {
            this._clearExecution();
            // Cooldown after trade — forces next entry to come from a FRESH signal, not same setup
            this._cooldownUntil = epoch + 60;
            this._broadcastStatus();
        }
    }

    // ── Outcome Handler ──────────────────────────────────

    _handleOutcome(outcome) {
        // Only handle outcomes from bot trades
        if (outcome.ownerId !== 'cipher_bot') return;

        // Calculate profit
        const profit = outcome.outcome === 'won'
            ? (outcome.payout || 0) - (outcome.buyPrice || 0)
            : -(outcome.buyPrice || 0);

        // Phase 4: Update trade in database
        if (outcome.contractId) {
            try {
                this.logger.updateOutcome(
                    outcome.contractId,
                    outcome.outcome,
                    outcome.payout || null,
                    profit
                );
                console.log(`[BOT] 📝 Outcome logged: ${outcome.outcome} | Profit: $${profit.toFixed(2)}`);
            } catch (logErr) {
                console.error(`[BOT] ⚠ Failed to log outcome: ${logErr.message}`);
            }
        }

        if (outcome.outcome === 'lost') {
            this.consecutiveLosses++;
            this.sessionStats.losses++;
            console.log(`[BOT] ✗ LOSS #${this.consecutiveLosses} consecutive`);

            if (this.consecutiveLosses >= 2) {
                this.isPaused = true;
                console.log(`[BOT] ⚠ AUTO-PAUSED after 2 consecutive losses`);
            }
        } else if (outcome.outcome === 'won') {
            this.consecutiveLosses = 0;
            this.sessionStats.wins++;
            this.sessionStats.totalPayout += (outcome.payout || 0);
            console.log(`[BOT] ✓ WIN — loss counter reset`);
        }
        // 'flat' or other outcomes: don't change consecutive counter

        this._broadcastStatus();
    }

    // ── Execution Timeout ────────────────────────────────

    _startExecutionTimeout() {
        this._clearExecutionTimer();
        this._executionTimer = setTimeout(() => {
            if (this._pendingExecution) {
                console.warn(`[BOT] ⚠ Execution timeout (${EXECUTION_TIMEOUT_MS}ms) — clearing stuck state`);
                this._pendingExecution = false;
                this._broadcastStatus();
            }
        }, EXECUTION_TIMEOUT_MS);
    }

    _clearExecutionTimer() {
        if (this._executionTimer) {
            clearTimeout(this._executionTimer);
            this._executionTimer = null;
        }
    }

    _clearExecution() {
        this._pendingExecution = false;
        this._clearExecutionTimer();
    }

    // ── UI Control Methods ───────────────────────────────

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (this.enabled) {
            // Fresh start when enabling
            this.isPaused = false;
            this.consecutiveLosses = 0;
            this._pendingExecution = false;
            this._clearExecutionTimer();
            console.log(`[BOT] ENABLED — Stake: $${this.stake}`);
        } else {
            this._clearExecution();
            console.log(`[BOT] DISABLED`);
        }
        this._broadcastStatus();
    }

    setStake(amount) {
        if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0.35) {
            this.stake = amount;
            console.log(`[BOT] Stake: $${amount}`);
            this._broadcastStatus();
        }
    }

    unpause() {
        this.isPaused = false;
        this.consecutiveLosses = 0;
        console.log(`[BOT] UNPAUSED — loss counter reset`);
        this._broadcastStatus();
    }

    // ── Status ───────────────────────────────────────────

    getStatus() {
        return {
            enabled: this.enabled,
            paused: this.isPaused,
            stake: this.stake,
            consecutiveLosses: this.consecutiveLosses,
            pendingExecution: this._pendingExecution,
            sessionStats: { ...this.sessionStats },
            lastDecision: this._lastDecision
        };
    }

    _broadcastStatus() {
        this.broadcast('bot_status', this.getStatus());
    }

    // ── Trade History (Phase 4) ──────────────────────────

    /**
     * Get recent trades from the database.
     */
    getRecentTrades(limit = 20) {
        return this.logger.getRecent(limit);
    }

    /**
     * Get recent losses for debugging.
     */
    getRecentLosses(limit = 10) {
        return this.logger.getLosses(limit);
    }

    /**
     * Get only settled trades (won/lost, no pending).
     * Useful to avoid "duplicate" appearance in journal views.
     */
    getSettledTrades(limit = 50) {
        return this.logger.getSettledOnly(limit);
    }

    /**
     * Get only pending trades (outcome not yet known).
     */
    getPendingTrades(limit = 50) {
        return this.logger.getPendingOnly(limit);
    }

    /**
     * Get aggregate stats from the database.
     */
    getDbStats(options = {}) {
        return this.logger.getStats(options);
    }

    /**
     * Get trades by date range.
     * @param {number} from - Start epoch (seconds)
     * @param {number} to - End epoch (seconds)
     * @param {number} limit - Max results
     * @param {string} accountMode - 'demo' or 'real' (optional)
     */
    getTradesByDateRange(from, to, limit = 50, accountMode = null) {
        return this.logger.getByDateRange(from, to, limit, accountMode);
    }

    /**
     * Get trades by account mode.
     * @param {string} accountMode - 'demo' or 'real'
     * @param {number} limit - Max results
     */
    getTradesByMode(accountMode, limit = 50) {
        return this.logger.getByMode(accountMode, limit);
    }

    /**
     * Set account mode for future trades.
     * @param {string} mode - 'demo' or 'real'
     */
    setAccountMode(mode) {
        if (mode === 'demo' || mode === 'real') {
            this.accountMode = mode;
            console.log(`[BOT] Account mode set to: ${mode}`);
        }
    }

    /**
     * COMBINED QUERY: Get trades with all filters applied together.
     * This is the main method to use for filtered queries.
     */
    queryTrades(filters = {}) {
        return this.logger.query(filters);
    }

    /**
     * COMBINED STATS: Get stats with all filters applied together.
     */
    queryStats(filters = {}) {
        return this.logger.queryStats(filters);
    }

    /**
     * Close the trade logger database.
     */
    close() {
        try {
            this.logger.close();
            console.log('[BOT] Trade logger closed');
        } catch (err) {
            console.error(`[BOT] Error closing trade logger: ${err.message}`);
        }
    }
}

module.exports = BotController;
