/**
 * Quadrant Break Strategy — The Brain
 *
 * Pure logic engine with zero side effects. Takes block state as input,
 * returns a decision. No trading, no WebSocket, no database — just math.
 *
 * 5-Gate System:
 *   Gate 0: Q1 Structure Check (must be ranging, not trending)
 *   Gate 1: Q1 Liquidity Clearance (Q2 must clear Q1's extreme early)
 *   Gate 2: Q3 Rejection Filter (no violent snap-back after break)
 *   Gate 3: Q3 Energy Filter (clean directional energy, not choppy)
 *   Gate 4: Q1-Q3 Exhaustion Filter (market not over-extended)
 *
 * Philosophy: No trade > bad trade. If ANY gate fails → SKIP.
 */

const DEFAULT_CONFIG = {
    q1BodyRatioMax: 0.80,           // Gate 0: max body/range ratio before Q1 is "trending"
    q1MinRange: 0.10,               // Gate 0: minimum Q1 range to avoid division issues on tight consolidation
    q1ClearanceWindow: 0.20,        // Gate 1: Q2 must clear Q1 extreme within first 20% of Q2 ticks
    q3SnapBackMax: 0.60,            // Gate 2: max retrace ratio after Q3 break
    q3CloseSideThreshold: 0.50,     // Gate 3: Q3 close must be on correct side of midpoint
    q3MaxReversals: 4,              // Gate 3: max direction changes allowed in Q3
    exhaustionMultiplier: 5.0,      // Gate 4: skip if total displacement > barrier * this
};

class QuadrantBreakStrategy {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Main evaluation method. Called at Q3→Q4 transition.
     *
     * @param {Object} blockState - From blockTracker.getState()
     * @param {number} barrierDistance - From UI config (e.g. 1.6)
     * @returns {{ signal: 'FIRE'|'SKIP', direction: 'BUY'|'SELL'|null, gates: Object, reason: string }}
     */
    evaluate(blockState, barrierDistance) {
        const { q1, q2, q3, blockOpen } = blockState;

        // Safety: need completed Q1, Q2, Q3 data
        if (!q1 || !q2 || !q3 || q1.tickCount === 0 || q2.tickCount === 0 || q3.tickCount === 0) {
            return {
                signal: 'SKIP',
                direction: null,
                gates: this._emptyGates('Incomplete quadrant data'),
                reason: 'Incomplete quadrant data — not enough ticks in Q1/Q2/Q3'
            };
        }

        // Determine direction FIRST — needed by several gates
        const direction = this._determineDirection(q2, q3);

        // Run all 5 gates
        const gate0 = this._gate0_Q1Structure(q1);
        const gate1 = this._gate1_Q1Clearance(q1, q2, direction);
        const gate2 = this._gate2_Q3Rejection(q2, q3, direction);
        const gate3 = this._gate3_Q3Energy(q3, direction);
        const gate4 = this._gate4_Exhaustion(blockOpen, q3, barrierDistance);

        const gates = {
            gate0: { ...gate0, name: 'Q1 Structure' },
            gate1: { ...gate1, name: 'Q1 Clearance' },
            gate2: { ...gate2, name: 'Q3 Rejection' },
            gate3: { ...gate3, name: 'Q3 Energy' },
            gate4: { ...gate4, name: 'Exhaustion' }
        };

        // ALL gates must pass
        const allPassed = gate0.passed && gate1.passed && gate2.passed && gate3.passed && gate4.passed;

        if (!allPassed) {
            // Find first failing gate for the reason
            const failedGate = [gate0, gate1, gate2, gate3, gate4].find(g => !g.passed);
            return {
                signal: 'SKIP',
                direction,
                gates,
                reason: failedGate ? failedGate.reason : 'Unknown gate failure'
            };
        }

        return {
            signal: 'FIRE',
            direction,
            gates,
            reason: `All 5 gates passed → ${direction} ONETOUCH`
        };
    }

    /**
     * Determine trade direction from Q3's break of Q2's key level.
     * Q3 broke Q2 HIGH → BUY. Q3 broke Q2 LOW → SELL.
     * If Q3 broke both, use whichever break was larger (more displacement).
     */
    _determineDirection(q2, q3) {
        const brokeHigh = q3.high > q2.high;
        const brokeLow = q3.low < q2.low;

        if (brokeHigh && !brokeLow) return 'BUY';
        if (brokeLow && !brokeHigh) return 'SELL';

        if (brokeHigh && brokeLow) {
            // Both broken — use the larger displacement
            const highBreak = q3.high - q2.high;
            const lowBreak = q2.low - q3.low;
            return highBreak >= lowBreak ? 'BUY' : 'SELL';
        }

        // Q3 didn't break either Q2 level — no valid signal
        return null;
    }

    // ─────────────────────────────────────────────────────────
    // GATE 0: Q1 Structure Check
    // Q1 must be ranging (energy accumulation), not trending
    // ─────────────────────────────────────────────────────────
    _gate0_Q1Structure(q1) {
        const range = q1.high - q1.low;

        // Tiny range = tight consolidation → treat as ranging regardless
        if (range < this.config.q1MinRange) {
            return { passed: true, value: 0, threshold: this.config.q1BodyRatioMax, reason: 'Q1 tight consolidation — treated as ranging' };
        }

        const bodyRatio = this._bodyRangeRatio(q1);

        if (bodyRatio > this.config.q1BodyRatioMax) {
            return {
                passed: false,
                value: parseFloat(bodyRatio.toFixed(3)),
                threshold: this.config.q1BodyRatioMax,
                reason: `Q1 is trending (body/range=${bodyRatio.toFixed(2)} > ${this.config.q1BodyRatioMax}) — energy already spent`
            };
        }

        return {
            passed: true,
            value: parseFloat(bodyRatio.toFixed(3)),
            threshold: this.config.q1BodyRatioMax,
            reason: 'Q1 is ranging — energy accumulating'
        };
    }

    // ─────────────────────────────────────────────────────────
    // GATE 1: Q1 Liquidity Clearance
    // Q2 must take out Q1's key extreme early in its life
    // ─────────────────────────────────────────────────────────
    _gate1_Q1Clearance(q1, q2, direction) {
        if (direction === null) {
            return { passed: false, value: null, threshold: null, reason: 'No direction — Q3 did not break Q2 level' };
        }

        const clearanceDeadline = Math.floor(q2.tickCount * this.config.q1ClearanceWindow);

        if (direction === 'BUY') {
            if (q2.tickAtQ1HighClear === null) {
                return {
                    passed: false,
                    value: null,
                    threshold: clearanceDeadline,
                    reason: 'Q2 never cleared Q1 high — path ahead blocked'
                };
            }
            const clearedWithinWindow = q2.tickAtQ1HighClear <= clearanceDeadline;
            return {
                passed: clearedWithinWindow,
                value: q2.tickAtQ1HighClear,
                threshold: clearanceDeadline,
                reason: clearedWithinWindow
                    ? `Q2 cleared Q1 high at tick ${q2.tickAtQ1HighClear} (within ${clearanceDeadline})`
                    : `Q2 cleared Q1 high too late (tick ${q2.tickAtQ1HighClear} > ${clearanceDeadline})`
            };
        }

        // SELL direction
        if (q2.tickAtQ1LowClear === null) {
            return {
                passed: false,
                value: null,
                threshold: clearanceDeadline,
                reason: 'Q2 never cleared Q1 low — path ahead blocked'
            };
        }
        const clearedWithinWindow = q2.tickAtQ1LowClear <= clearanceDeadline;
        return {
            passed: clearedWithinWindow,
            value: q2.tickAtQ1LowClear,
            threshold: clearanceDeadline,
            reason: clearedWithinWindow
                ? `Q2 cleared Q1 low at tick ${q2.tickAtQ1LowClear} (within ${clearanceDeadline})`
                : `Q2 cleared Q1 low too late (tick ${q2.tickAtQ1LowClear} > ${clearanceDeadline})`
        };
    }

    // ─────────────────────────────────────────────────────────
    // GATE 2: Q3 Rejection Filter
    // After Q3 breaks Q2's level, it must NOT violently snap back
    // Also checks "Spring vs Trap" sequence
    // ─────────────────────────────────────────────────────────
    _gate2_Q3Rejection(q2, q3, direction) {
        if (direction === null) {
            return { passed: false, value: null, threshold: null, reason: 'No direction — cannot evaluate rejection' };
        }

        // Calculate snap-back ratio
        let maxBreakDisplacement, retrace, snapBackRatio;

        if (direction === 'BUY') {
            maxBreakDisplacement = q3.high - q2.high;
            if (maxBreakDisplacement <= 0) {
                return { passed: false, value: 0, threshold: this.config.q3SnapBackMax, reason: 'Q3 did not break Q2 high' };
            }
            // How much Q3 retraced from its maximum break
            retrace = q3.high - q3.close;
            snapBackRatio = retrace / maxBreakDisplacement;
        } else {
            // SELL
            maxBreakDisplacement = q2.low - q3.low;
            if (maxBreakDisplacement <= 0) {
                return { passed: false, value: 0, threshold: this.config.q3SnapBackMax, reason: 'Q3 did not break Q2 low' };
            }
            retrace = q3.close - q3.low;
            snapBackRatio = retrace / maxBreakDisplacement;
        }

        // Snap-back check
        if (snapBackRatio > this.config.q3SnapBackMax) {
            return {
                passed: false,
                value: parseFloat(snapBackRatio.toFixed(3)),
                threshold: this.config.q3SnapBackMax,
                reason: `Q3 snap-back too violent (${(snapBackRatio * 100).toFixed(0)}% retrace > ${this.config.q3SnapBackMax * 100}% max)`
            };
        }

        // Spring vs Trap check
        const springTrapResult = this._isQ3SequenceValid(q3, direction);
        if (!springTrapResult.valid) {
            return {
                passed: false,
                value: parseFloat(snapBackRatio.toFixed(3)),
                threshold: this.config.q3SnapBackMax,
                reason: springTrapResult.reason
            };
        }

        return {
            passed: true,
            value: parseFloat(snapBackRatio.toFixed(3)),
            threshold: this.config.q3SnapBackMax,
            reason: `Q3 breakout held (snap-back=${(snapBackRatio * 100).toFixed(0)}%, sequence=${springTrapResult.type})`
        };
    }

    // ─────────────────────────────────────────────────────────
    // GATE 3: Q3 Energy / Consolidation Filter
    // Q3 must show clean directional energy, not choppiness
    // ─────────────────────────────────────────────────────────
    _gate3_Q3Energy(q3, direction) {
        if (direction === null) {
            return { passed: false, value: null, threshold: null, reason: 'No direction — cannot evaluate Q3 energy' };
        }

        // Check reversal count
        if (q3.reversalCount > this.config.q3MaxReversals) {
            return {
                passed: false,
                value: q3.reversalCount,
                threshold: this.config.q3MaxReversals,
                reason: `Q3 too choppy (${q3.reversalCount} reversals > ${this.config.q3MaxReversals} max)`
            };
        }

        // Q3 close must be on the correct side of Q3's threshold level
        const q3Mid = q3.low + (q3.high - q3.low) * this.config.q3CloseSideThreshold;
        const closeOnCorrectSide = direction === 'BUY'
            ? q3.close > q3Mid
            : q3.close < q3Mid;

        if (!closeOnCorrectSide) {
            return {
                passed: false,
                value: q3.reversalCount,
                threshold: this.config.q3MaxReversals,
                reason: `Q3 close is on wrong side of midpoint (close=${q3.close.toFixed(2)}, mid=${q3Mid.toFixed(2)}, dir=${direction})`
            };
        }

        return {
            passed: true,
            value: q3.reversalCount,
            threshold: this.config.q3MaxReversals,
            reason: `Q3 energy clean (${q3.reversalCount} reversals, close on correct side)`
        };
    }

    // ─────────────────────────────────────────────────────────
    // GATE 4: Q1-Q3 Exhaustion Filter
    // If price traveled too far already, Q4 has no fuel left
    // ─────────────────────────────────────────────────────────
    _gate4_Exhaustion(blockOpen, q3, barrierDistance) {
        if (blockOpen === null || q3.close === null) {
            return { passed: true, value: 0, threshold: 0, reason: 'Insufficient data for exhaustion check' };
        }

        const totalDisplacement = Math.abs(blockOpen - q3.close);
        const exhaustionLimit = barrierDistance * this.config.exhaustionMultiplier;

        if (totalDisplacement > exhaustionLimit) {
            return {
                passed: false,
                value: parseFloat(totalDisplacement.toFixed(2)),
                threshold: parseFloat(exhaustionLimit.toFixed(2)),
                reason: `Market over-extended (displacement=${totalDisplacement.toFixed(2)} > limit=${exhaustionLimit.toFixed(2)})`
            };
        }

        return {
            passed: true,
            value: parseFloat(totalDisplacement.toFixed(2)),
            threshold: parseFloat(exhaustionLimit.toFixed(2)),
            reason: `Fuel remaining (displacement=${totalDisplacement.toFixed(2)}, limit=${exhaustionLimit.toFixed(2)})`
        };
    }

    // ─────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────

    /**
     * Spring vs Trap check for Q3.
     * Good Q3 (Spring): dips AGAINST the trend first, then breaks WITH the trend.
     * Bad Q3 (Trap): breaks WITH the trend first, then reverses AGAINST.
     *
     * Measured by whether the extreme in the trade direction happened
     * before or after the midpoint of Q3.
     */
    _isQ3SequenceValid(q3, direction) {
        const q3MidTick = Math.floor(q3.tickCount / 2);

        if (direction === 'BUY') {
            // Good: Q3 creates its LOW before midpoint, then breaks HIGH after
            // Bad:  Q3 creates its HIGH before midpoint, then reverses
            if (q3.highTick < q3MidTick && q3.lowTick >= q3MidTick) {
                return { valid: false, type: 'TRAP', reason: 'Q3 Trap sequence — HIGH made early, LOW made late (BUY direction)' };
            }
            return { valid: true, type: q3.lowTick < q3MidTick ? 'SPRING' : 'NEUTRAL' };
        }

        // SELL direction
        // Good: Q3 creates its HIGH before midpoint, then breaks LOW after
        // Bad:  Q3 creates its LOW before midpoint, then reverses
        if (q3.lowTick < q3MidTick && q3.highTick >= q3MidTick) {
            return { valid: false, type: 'TRAP', reason: 'Q3 Trap sequence — LOW made early, HIGH made late (SELL direction)' };
        }
        return { valid: true, type: q3.highTick < q3MidTick ? 'SPRING' : 'NEUTRAL' };
    }

    /**
     * Body-to-range ratio: |open - close| / (high - low)
     * High ratio = trending, Low ratio = ranging
     */
    _bodyRangeRatio(ohlc) {
        const range = ohlc.high - ohlc.low;
        if (range === 0) return 0;
        return Math.abs(ohlc.open - ohlc.close) / range;
    }

    /**
     * Return an empty gates object for early-exit cases.
     */
    _emptyGates(reason) {
        const skipped = { passed: false, value: null, threshold: null, reason };
        return {
            gate0: { ...skipped, name: 'Q1 Structure' },
            gate1: { ...skipped, name: 'Q1 Clearance' },
            gate2: { ...skipped, name: 'Q3 Rejection' },
            gate3: { ...skipped, name: 'Q3 Energy' },
            gate4: { ...skipped, name: 'Exhaustion' }
        };
    }
}

module.exports = QuadrantBreakStrategy;
