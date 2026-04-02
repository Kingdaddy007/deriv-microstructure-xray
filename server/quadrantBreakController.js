/**
 * Quadrant Break Controller — Execution Engine
 *
 * Equivalent to botController.js but for the Quadrant Break strategy.
 * Handles: Q3→Q4 transition detection, trade firing, outcome tracking,
 *          auto-pause after 2 consecutive losses, one trade per block.
 *
 * Does NOTHING during Q1, Q2, Q3. Fires (or skips) at the INSTANT
 * the quadrant transitions from Q3 to Q4.
 *
 * Shares infrastructure with Cipher Swarm:
 *   - blockTracker (read-only)
 *   - tradingEngine (for proposals + execution)
 *   - broadcast() (for UI updates)
 */

const EventEmitter = require('events');
const TradeLogger = require('./tradeLogger');

const EXECUTION_TIMEOUT_MS = 15000; // 15s safety timeout

class QuadrantBreakController extends EventEmitter {
    constructor({ blockTracker, strategy, tradingEngine, broadcast, accountMode = 'demo' }) {
        super();
        this.block = blockTracker;
        this.strategy = strategy;
        this.trading = tradingEngine;
        this.broadcast = broadcast;
        this.accountMode = accountMode;

        // Trade logger
        this.logger = new TradeLogger();

        // Bot state
        this.enabled = false;
        this.stake = 1.00;
        this.consecutiveLosses = 0;
        this.isPaused = false;
        this._pendingExecution = false;
        this._executionTimer = null;
        this._firedThisBlock = false;    // One trade per block, period
        this._currentBlockStart = null;  // Track which block we've evaluated

        // Session stats
        this.sessionStats = {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            totalStaked: 0,
            totalPayout: 0,
            skips: 0
        };

        // Last evaluation snapshot (for UI)
        this._lastEvaluation = null;

        // Listen for trade outcomes
        this.trading.on('trade_outcome', (outcome) => {
            this._handleOutcome(outcome);
        });
    }

    /**
     * Core tick handler. Called from index.js on every tick
     * ONLY when activeStrategy === 'quadrant'.
     *
     * @param {number} epoch - tick epoch in seconds
     * @param {number} price - current tick price
     * @param {number} barrierDistance - barrier distance from UI config
     */
    async onTick(epoch, price, barrierDistance) {
        // Guard: bot off, paused, or trade in flight
        if (!this.enabled || this.isPaused || this._pendingExecution) return;

        const state = this.block.getState();

        // Reset fired flag on new block
        if (state.blockStart !== this._currentBlockStart) {
            this._currentBlockStart = state.blockStart;
            this._firedThisBlock = false;
        }

        // Already fired or skipped this block — do nothing
        if (this._firedThisBlock) return;

        // THE CRITICAL MOMENT: Q3 → Q4 transition
        // prevQuadrant is Q3 AND current quadrant is Q4 → first tick of Q4
        if (state.prevQuadrant === 'Q3' && state.quadrant === 'Q4') {
            this._firedThisBlock = true; // Lock immediately — one eval per block
            await this._evaluateAndFire(epoch, price, barrierDistance, state);
        }
    }

    /**
     * Evaluate the 5-gate strategy and fire (or skip) a trade.
     * Called exactly ONCE per block, at the Q3→Q4 transition.
     */
    async _evaluateAndFire(epoch, price, barrierDistance, blockState) {
        // Run the strategy evaluation
        const result = this.strategy.evaluate(blockState, barrierDistance);

        // Store evaluation for UI display
        this._lastEvaluation = {
            ...result,
            epoch,
            price,
            barrierDistance,
            blockStart: blockState.blockStart
        };

        // Broadcast gate status to all clients
        this.broadcast('quadrant_gate_status', {
            signal: result.signal,
            direction: result.direction,
            gates: result.gates,
            reason: result.reason,
            blockStart: blockState.blockStart,
            evaluatedAt: epoch
        });

        // SKIP — log and do nothing
        if (result.signal === 'SKIP') {
            this.sessionStats.skips++;
            console.log(`[QB] ○ SKIP — ${result.reason}`);
            this._broadcastStatus();
            return;
        }

        // FIRE — execute the trade
        console.log(`[QB] ✓ FIRE — ${result.direction} ONETOUCH | All 5 gates passed`);

        // Calculate barrier with direction
        const signedBarrier = result.direction === 'BUY'
            ? `+${barrierDistance}`
            : `-${barrierDistance}`;

        this._pendingExecution = true;
        this._startExecutionTimeout();

        // Step 1: Get proposal
        let proposal;
        try {
            proposal = await this.trading.getProposal({
                amount: this.stake,
                contract_type: 'ONETOUCH',
                barrier: signedBarrier,
                duration: 2,
                duration_unit: 'm',
                basis: 'stake',
                currency: 'USD'
            });
        } catch (err) {
            console.error(`[QB] ✗ Proposal failed: ${err.message}`);
            this._clearExecution();
            return;
        }

        // Step 2: Execute buy immediately — no hesitation
        try {
            const tradeRecord = await this.trading.executeBuy(
                proposal.proposalId,
                proposal.askPrice,
                'quadrant_bot'  // ownerId for outcome routing
            );

            this.block.tradeCount++;
            this.sessionStats.totalTrades++;
            this.sessionStats.totalStaked += this.stake;

            console.log(`[QB] ✓ Trade placed — Contract #${tradeRecord.contractId} | ` +
                `${result.direction} | Cost: $${tradeRecord.buyPrice} | Payout: $${tradeRecord.payout}`);

            // Log trade to SQLite
            try {
                this.logger.logQuadrantTrade({
                    timestamp: epoch,
                    blockState,
                    direction: result.direction,
                    barrier: barrierDistance,
                    stake: this.stake,
                    contractId: tradeRecord.contractId,
                    buyPrice: tradeRecord.buyPrice,
                    potentialPayout: tradeRecord.payout,
                    gates: result.gates,
                    signal: result.signal,
                    reason: result.reason,
                    accountMode: this.accountMode
                });
                console.log(`[QB] 📝 Trade logged to DB (${this.accountMode})`);
            } catch (logErr) {
                console.error(`[QB] ⚠ Failed to log trade: ${logErr.message}`);
            }

            // Broadcast trade execution
            this.broadcast('quadrant_trade_executed', {
                direction: result.direction,
                contractId: tradeRecord.contractId,
                buyPrice: tradeRecord.buyPrice,
                payout: tradeRecord.payout,
                stake: this.stake,
                gates: result.gates,
                blockStart: blockState.blockStart,
                timestamp: epoch
            });

            this.emit('trade_executed', {
                strategy: 'quadrant',
                direction: result.direction,
                contractId: tradeRecord.contractId,
                buyPrice: tradeRecord.buyPrice,
                payout: tradeRecord.payout,
                gates: result.gates,
                blockState,
                timestamp: epoch
            });

        } catch (err) {
            console.error(`[QB] ✗ Trade execution failed: ${err.message}`);
        } finally {
            this._clearExecution();
            this._broadcastStatus();
        }
    }

    // ── Outcome Handler ──────────────────────────────────

    _handleOutcome(outcome) {
        // Only handle outcomes from quadrant bot trades
        if (outcome.ownerId !== 'quadrant_bot') return;

        const profit = outcome.outcome === 'won'
            ? (outcome.payout || 0) - (outcome.buyPrice || 0)
            : -(outcome.buyPrice || 0);

        // Update trade in database
        if (outcome.contractId) {
            try {
                this.logger.updateOutcome(
                    outcome.contractId,
                    outcome.outcome,
                    outcome.payout || null,
                    profit
                );
                console.log(`[QB] 📝 Outcome logged: ${outcome.outcome} | Profit: $${profit.toFixed(2)}`);
            } catch (logErr) {
                console.error(`[QB] ⚠ Failed to log outcome: ${logErr.message}`);
            }
        }

        if (outcome.outcome === 'lost') {
            this.consecutiveLosses++;
            this.sessionStats.losses++;
            console.log(`[QB] ✗ LOSS #${this.consecutiveLosses} consecutive | -$${Math.abs(profit).toFixed(2)}`);

            if (this.consecutiveLosses >= 2) {
                this.isPaused = true;
                console.log(`[QB] ⚠ AUTO-PAUSED after 2 consecutive losses`);
            }
        } else if (outcome.outcome === 'won') {
            this.consecutiveLosses = 0;
            this.sessionStats.wins++;
            this.sessionStats.totalPayout += (outcome.payout || 0);
            console.log(`[QB] ✓ WIN — +$${profit.toFixed(2)} — loss counter reset`);
        }

        this.broadcast('quadrant_trade_outcome', {
            outcome: outcome.outcome,
            profit,
            contractId: outcome.contractId,
            consecutiveLosses: this.consecutiveLosses,
            paused: this.isPaused
        });

        this._broadcastStatus();
    }

    // ── Execution Timeout ────────────────────────────────

    _startExecutionTimeout() {
        this._clearExecutionTimer();
        this._executionTimer = setTimeout(() => {
            if (this._pendingExecution) {
                console.warn(`[QB] ⚠ Execution timeout (${EXECUTION_TIMEOUT_MS}ms) — clearing stuck state`);
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
            this.isPaused = false;
            this.consecutiveLosses = 0;
            this._pendingExecution = false;
            this._firedThisBlock = false;
            this._clearExecutionTimer();
            console.log(`[QB] ENABLED — Stake: $${this.stake}`);
        } else {
            this._clearExecution();
            console.log(`[QB] DISABLED`);
        }
        this._broadcastStatus();
    }

    setStake(amount) {
        if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0.35) {
            this.stake = amount;
            console.log(`[QB] Stake: $${amount}`);
            this._broadcastStatus();
        }
    }

    unpause() {
        this.isPaused = false;
        this.consecutiveLosses = 0;
        console.log(`[QB] UNPAUSED — loss counter reset`);
        this._broadcastStatus();
    }

    // ── Status ───────────────────────────────────────────

    getStatus() {
        return {
            strategy: 'quadrant',
            enabled: this.enabled,
            paused: this.isPaused,
            stake: this.stake,
            consecutiveLosses: this.consecutiveLosses,
            pendingExecution: this._pendingExecution,
            firedThisBlock: this._firedThisBlock,
            sessionStats: { ...this.sessionStats },
            lastEvaluation: this._lastEvaluation
        };
    }

    _broadcastStatus() {
        this.broadcast('quadrant_bot_status', this.getStatus());
    }
}

module.exports = QuadrantBreakController;
