/**
 * TradingEngine — Isolated trading lifecycle manager
 * Handles proposal/buy flow for Touch/No Touch contracts.
 * Completely separate from analytics, charting, and tick processing.
 */

const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
    constructor(derivClient) {
        super();
        this.deriv = derivClient;
        this.accountInfo = null;     // Set when authorize event fires
        this.tradeHistory = [];      // In-memory session log
        this.maxHistorySize = 50;    // Keep last 50 trades
        this.trackedContracts = new Map(); // contractId -> { ownerId, subscriptionId, isSettled, timestamp }

        // Stale contract watchdog
        this._staleWatchdog = setInterval(() => this._pollStaleContracts(), 15000);

        // Listen for account info from DerivClient's authorize event
        this.deriv.on('authorize', (info) => {
            this.accountInfo = info;
            console.log(`[TradingEngine] Account loaded: ${info.isVirtual ? 'DEMO' : 'REAL'} (${info.loginId}), Balance: ${info.balance} ${info.currency}`);

            if (this.trackedContracts.size > 0) {
                this._resubscribeOpenContracts();
            }
        });

        this.deriv.on('proposal_open_contract', (openContract) => {
            this._handleContractUpdate(openContract);
        });
    }

    /**
     * Get a price proposal for a Touch/No Touch contract.
     * @param {Object} params
     * @param {number} params.amount - Stake amount (e.g. 1)
     * @param {string} params.contract_type - "ONETOUCH" or "NOTOUCH"
     * @param {string} params.barrier - Barrier price (e.g. "+2.00" or absolute like "5634.50")
     * @param {number} params.duration - Duration value (e.g. 5)
     * @param {string} params.duration_unit - Duration unit: "t" (ticks), "s","m","h","d"
     * @param {string} [params.basis="stake"] - "stake" or "payout"
     * @param {string} [params.currency="USD"] - Account currency
     * @returns {Promise<Object>} - { proposalId, askPrice, payout, longcode, spot }
     */
    async getProposal(params) {
        const payload = {
            proposal: 1,
            amount: params.amount,
            basis: params.basis || 'stake',
            contract_type: params.contract_type,
            currency: params.currency || 'USD',
            duration: params.duration,
            duration_unit: params.duration_unit || 'm',
            symbol: this.deriv.symbol,
            barrier: String(params.barrier)
        };

        console.log(`[TradingEngine] Requesting proposal:`, JSON.stringify(payload));
        const response = await this.deriv.sendRequest(payload);

        if (!response.proposal) {
            throw new Error('Invalid proposal response');
        }

        const p = response.proposal;
        return {
            proposalId: p.id,
            askPrice: parseFloat(p.ask_price),
            payout: parseFloat(p.payout),
            longcode: p.longcode,
            spot: parseFloat(p.spot),
            spotTime: p.spot_time
        };
    }

    /**
     * Execute a buy using a proposal ID.
     * @param {string} proposalId - The proposal ID from getProposal()
     * @param {number} maxPrice - Maximum price willing to pay (safety cap)
     * @returns {Promise<Object>} - { contractId, buyPrice, payout, longcode, balanceAfter }
     */
    async executeBuy(proposalId, maxPrice, ownerId = null) {
        console.log(`[TradingEngine] Executing buy: proposal=${proposalId}, maxPrice=${maxPrice}`);

        const response = await this.deriv.sendRequest({
            buy: proposalId,
            price: maxPrice
        });

        if (!response.buy) {
            throw new Error('Invalid buy response');
        }

        const b = response.buy;
        const tradeRecord = {
            contractId: b.contract_id,
            buyPrice: parseFloat(b.buy_price),
            payout: parseFloat(b.payout),
            longcode: b.longcode,
            balanceAfter: parseFloat(b.balance_after),
            transactionId: b.transaction_id,
            timestamp: Date.now(),
            outcome: 'pending',
            status: 'open',
            isSettled: false
        };

        // Store in session history
        this.tradeHistory.unshift(tradeRecord);
        if (this.tradeHistory.length > this.maxHistorySize) {
            this.tradeHistory.pop();
        }

        console.log(`[TradingEngine] ✓ Trade executed: Contract #${tradeRecord.contractId}, Cost: ${tradeRecord.buyPrice}, Payout: ${tradeRecord.payout}`);

        try {
            await this._subscribeToContract(tradeRecord.contractId, ownerId);
        } catch (err) {
            console.warn(`[TradingEngine] Failed to subscribe to contract #${tradeRecord.contractId}: ${err.message || err}`);
        }

        return tradeRecord;
    }

    async _subscribeToContract(contractId, ownerId = null) {
        const contractKey = String(contractId);
        const tracked = this.trackedContracts.get(contractKey) || { 
            ownerId: null, 
            subscriptionId: null, 
            isSettled: false,
            timestamp: Date.now()
        };

        if (ownerId !== null && ownerId !== undefined) tracked.ownerId = ownerId;
        tracked.isSettled = false;
        tracked.timestamp = Date.now();
        this.trackedContracts.set(contractKey, tracked);

        const response = await this.deriv.sendRequest({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1
        });

        const subscriptionId = response.subscription?.id || response.proposal_open_contract?.subscription?.id || null;
        if (subscriptionId) tracked.subscriptionId = subscriptionId;
        this.trackedContracts.set(contractKey, tracked);

        if (response.proposal_open_contract) {
            this._handleContractUpdate(response.proposal_open_contract);
        }
    }

    _resubscribeOpenContracts() {
        for (const [contractId, tracked] of this.trackedContracts.entries()) {
            if (tracked.isSettled) continue;
            tracked.subscriptionId = null;
            this.trackedContracts.set(contractId, tracked);
            this._subscribeToContract(contractId, tracked.ownerId).catch((err) => {
                console.warn(`[TradingEngine] Re-subscribe failed for contract #${contractId}: ${err.message || err}`);
            });
        }
    }

    async _pollStaleContracts() {
        if (!this.deriv.isConnected) return;

        const now = Date.now();
        for (const [contractId, tracked] of this.trackedContracts.entries()) {
            if (tracked.isSettled) continue;
            
            // If the contract has been pending for over 60 seconds since we last tracked or updated it,
            // we manually poll its status without a stream just to be sure Deriv didn't drop us.
            if (now - tracked.timestamp > 60000) {
                try {
                    const response = await this.deriv.sendRequest({
                        proposal_open_contract: 1,
                        contract_id: contractId
                    });
                    
                    if (response.proposal_open_contract) {
                        const status = response.proposal_open_contract.status || 'unknown';
                        const isSold = response.proposal_open_contract.is_sold;
                        console.log(`[TradingEngine] 🔍 Watchdog polled #${contractId}: status=${status}, is_sold=${isSold}`);
                        // Update the timestamp so we don't spam the poll
                        tracked.timestamp = now;
                        this.trackedContracts.set(contractId, tracked);
                        this._handleContractUpdate(response.proposal_open_contract);
                    }
                } catch (err) {
                    console.warn(`[TradingEngine] Watchdog poll failed for #${contractId}: ${err.message}`);
                }
            }
        }
    }

    _handleContractUpdate(openContract) {
        const contractId = openContract?.contract_id || openContract?.id;
        if (!contractId) return;

        const contractKey = String(contractId);
        const tracked = this.trackedContracts.get(contractKey);
        if (!tracked) return;
        if (tracked.isSettled && openContract.is_sold) return;

        const subscriptionId = openContract.subscription?.id || tracked.subscriptionId || null;
        if (subscriptionId) tracked.subscriptionId = subscriptionId;

        const outcome = this._normalizeOutcome(openContract, tracked.ownerId);
        tracked.isSettled = outcome.isSettled;
        tracked.timestamp = Date.now(); // Update timestamp on any active info
        this.trackedContracts.set(contractKey, tracked);
        this._updateTradeHistory(outcome);

        if (outcome.isSettled) {
            this.emit('trade_outcome', outcome);
            this._cleanupTrackedContract(contractKey, tracked.subscriptionId).catch((err) => {
                console.warn(`[TradingEngine] Failed to clean up contract #${contractId}: ${err.message || err}`);
            });
        } else {
            // Emit live contract update for real-time color changes on chart
            this.emit('contract_update', outcome);
        }
    }

    async _cleanupTrackedContract(contractKey, subscriptionId) {
        this.trackedContracts.delete(contractKey);
        if (!subscriptionId) return;

        try {
            await this.deriv.sendRequest({ forget: subscriptionId }, 10000);
        } catch (err) {
            console.warn(`[TradingEngine] Forget failed for subscription ${subscriptionId}: ${err.message || err}`);
        }
    }

    _updateTradeHistory(outcome) {
        const trade = this.tradeHistory.find(t => String(t.contractId) === String(outcome.contractId));
        if (!trade) return;

        for (const [key, value] of Object.entries(outcome)) {
            if (value !== null && value !== undefined) {
                trade[key] = value;
            }
        }
    }

    _normalizeOutcome(openContract, ownerId) {
        const buyPrice = this._parseNumber(openContract.buy_price);
        const payout = this._parseNumber(openContract.payout);
        const profit = this._parseNumber(openContract.profit);
        const barrier = this._parseNumber(openContract.barrier);
        const entrySpot = this._parseNumber(openContract.entry_tick);
        const currentSpot = this._parseNumber(openContract.current_spot);
        const exitSpot = this._parseNumber(openContract.exit_tick);
        const contractStatus = String(openContract.status || (openContract.is_sold ? 'sold' : 'open')).toLowerCase();
        const touchedBarrier = this._didTouchBarrier(entrySpot, barrier, currentSpot, contractStatus);
        const isSettled = Boolean(openContract.is_sold) || ['won', 'lost', 'sold', 'expired'].includes(contractStatus);

        let outcome = 'pending';
        if (isSettled) {
            if (contractStatus === 'won') outcome = 'won';
            else if (contractStatus === 'lost') outcome = 'lost';
            else if (profit > 0) outcome = 'won';
            else if (profit < 0) outcome = 'lost';
            else outcome = 'flat';
        }

        return {
            ownerId,
            contractId: openContract.contract_id || openContract.id,
            outcome,
            status: isSettled ? 'settled' : 'open',
            contractStatus,
            isSettled,
            buyPrice,
            payout,
            profit,
            touchedBarrier,
            barrier,
            entrySpot,
            currentSpot,
            currentSpotTimeSec: this._parseEpochSec(openContract.current_spot_time),
            exitSpot,
            entryTimeSec: this._parseEpochSec(openContract.date_start || openContract.entry_tick_time || openContract.current_spot_time),
            expiryTimeSec: this._parseEpochSec(openContract.date_expiry),
            exitTimeSec: this._parseEpochSec(openContract.exit_tick_time || openContract.sell_time),
            settledAt: this._parseEpochMs(openContract.sell_time || openContract.exit_tick_time),
            longcode: openContract.longcode || null
        };
    }

    _didTouchBarrier(entrySpot, barrier, currentSpot, contractStatus) {
        if (contractStatus === 'won') return true;
        if (!Number.isFinite(entrySpot) || !Number.isFinite(barrier) || !Number.isFinite(currentSpot)) return false;
        if (barrier >= entrySpot) return currentSpot >= barrier;
        return currentSpot <= barrier;
    }

    _parseNumber(value) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : null;
    }

    _parseEpochSec(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    _parseEpochMs(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n * 1000 : null;
    }

    /**
     * Get current account info (set after authorization).
     * @returns {Object|null}
     */
    getAccountInfo() {
        return this.accountInfo;
    }

    /**
     * Get recent trade history for the session.
     * @returns {Array}
     */
    getHistory() {
        return this.tradeHistory;
    }
}

module.exports = TradingEngine;
