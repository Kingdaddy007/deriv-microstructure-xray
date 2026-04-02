/**
 * Gatekeeper — Phase 1 of Cipher Swarm Bot
 *
 * Runs 5 gates + 4 kill-switches on every tick.
 * All 5 gates must pass for UNLOCKED.
 * Any fail → LOCKED, silent rejection, swarm not consulted.
 */

class Gatekeeper {
    constructor(blockTracker, volEngine) {
        this.block = blockTracker;
        this.vol = volEngine;
        this._lastLoggedState = null;
    }

    evaluate(currentPrice) {
        const state = this.block.getState();

        const gates = {};

        // Gate 1: Macro Trend
        gates.trend = {
            pass: state.macroTrend !== 'NONE',
            value: state.macroTrend,
            reason: state.macroTrend === 'NONE'
                ? 'No clear trend (last 3 blocks mixed)'
                : `Trend: ${state.macroTrend}`
        };

        // Gate 2: Temporal (Entry Zone) — V3: removed (kill-switches handle Q1 danger)
        gates.temporal = {
            pass: true,                    // V3: bypassed — Q1 sweep kill-switch is enough
            value: 'BYPASSED',
            reason: 'V3: temporal gate removed (kill-switches protect Q1)'
        };

        // Gate 3: Discount — V2: removed (swarm handles entry quality)
        gates.discount = {
            pass: true,                    // V2: bypassed
            value: 'BYPASSED',
            reason: 'V2: discount gate removed (swarm filters entry quality)'
        };

        // Gate 4: Kill-switches (4 checks, first kill stops)
        const killResult = this._checkKillSwitches(state, currentPrice);
        gates.killSwitch = {
            pass: !killResult.killed,
            value: killResult.killed ? killResult.code : 'NONE',
            reason: killResult.reason
        };

        // Gate 5: Trade limit — max 2 per block
        gates.tradeLimit = {
            pass: state.tradeCount < 2,
            value: state.tradeCount,
            reason: state.tradeCount >= 2
                ? `Block limit reached (${state.tradeCount}/2)`
                : `Trades: ${state.tradeCount}/2`
        };

        // ALL must pass
        const allPass = Object.values(gates).every(g => g.pass);

        const result = {
            unlocked: allPass,
            direction: allPass ? state.macroTrend : 'NONE',
            gates
        };

        // Log only on state transition — show ALL failing gates
        const newState = allPass ? 'UNLOCKED' : 'LOCKED';
        if (newState !== this._lastLoggedState) {
            this._lastLoggedState = newState;
            if (allPass) {
                console.log(`[Gate] UNLOCKED — Direction: ${state.macroTrend}`);
            } else {
                const failures = this._getAllFailReasons(gates);
                console.log(`[Gate] LOCKED — ${failures}`);
            }
        }

        return result;
    }

    _checkKillSwitches(state, currentPrice) {
        // Kill A: Q1 sweep without deep retrace
        // Price must have backed below block open OR taken out prev block Q4 low
        if (state.q1SweepOccurred) {
            const belowOpen = currentPrice < state.blockOpen;
            const tookQ4Low = state.prevBlock && currentPrice < state.prevBlock.q4Low;

            if (!belowOpen && !tookQ4Low) {
                return {
                    killed: true,
                    code: 'KILL_Q1_SWEEP_NO_RETRACE',
                    reason: 'Q1 sweep — no deep retracement (below open or prev Q4 low)'
                };
            }

            // Kill B: Retrace happened but momentum hasn't flipped back
            if ((belowOpen || tookQ4Low) && this.vol.momentumDirection !== state.macroTrend) {
                return {
                    killed: true,
                    code: 'KILL_Q1_SWEEP_NO_MOMENTUM',
                    reason: `Q1 sweep — retrace done but momentum (${this.vol.momentumDirection}) not aligned with trend (${state.macroTrend})`
                };
            }

            // Kill D: Ranging after sweep
            // Pulled back to block open, sitting there, no directional momentum
            if (this.vol.momentumDirection === 'NEUTRAL' && currentPrice >= state.blockOpen * 0.9995) {
                return {
                    killed: true,
                    code: 'KILL_RANGING_AFTER_SWEEP',
                    reason: 'Q1 sweep — ranging at block open, no directional momentum'
                };
            }
        }

        // Kill C: Dead market — V2: lowered from 0.9 to 0.65
        if (this.vol.volRatio !== null
            && this.vol.volRatio < 0.65
            && this.vol.volTrend === 'CONTRACTING') {
            return {
                killed: true,
                code: 'KILL_DEAD_MARKET',
                reason: `Dead market — volRatio ${this.vol.volRatio.toFixed(2)} < 0.65 and CONTRACTING`
            };
        }

        return { killed: false, code: 'NONE', reason: 'No kill conditions active' };
    }

    _getFailReason(gates) {
        for (const [name, gate] of Object.entries(gates)) {
            if (!gate.pass) {
                return `${name}: ${gate.reason}`;
            }
        }
        return 'Unknown';
    }

    _getAllFailReasons(gates) {
        const fails = [];
        for (const [name, gate] of Object.entries(gates)) {
            if (!gate.pass) {
                fails.push(`${name}: ${gate.reason}`);
            }
        }
        return fails.length > 0 ? fails.join(' | ') : 'Unknown';
    }
}

module.exports = Gatekeeper;
