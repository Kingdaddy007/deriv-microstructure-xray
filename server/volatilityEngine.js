/**
 * Volatility Engine
 *
 * Calculates rolling volatility from log-returns,
 * vol ratio, vol trend, and tick momentum.
 *
 * Performance: incremental — one log-return is appended per tick.
 * Standard deviations are computed only over the required window tail
 * (max 300 values), not over the full 30k tick history.
 */

const config = require('./config');

class VolatilityEngine {
    /**
     * @param {import('./tickStore')} tickStore
     */
    constructor(tickStore) {
        this.tickStore = tickStore;

        /** Rolling σ per window */
        this.rollingVol = {};

        /** Vol ratio (short / baseline) */
        this.volRatio = null;
        this.volRatioLabel = 'N/A';

        /** Vol trend */
        this.volTrend = 'N/A';
        this._vol30History = []; // last 60 values of vol30 to detect trend

        /** Momentum */
        this.momentumScore = 0;
        this.momentumDirection = 'NEUTRAL';

        /** Configuration */
        this.VOL_WINDOWS  = config.VOL_WINDOWS         || [10, 30, 60, 120, 300];
        this.VOL_SHORT    = config.VOL_SHORT_WINDOW     || 30;
        this.VOL_BASELINE = config.VOL_BASELINE_WINDOW  || 300;
        this.MOMENTUM_WINDOW = config.MOMENTUM_WINDOW   || 10;

        /**
         * Incremental log-returns ring buffer.
         * We keep only as many values as the largest window requires.
         * This avoids ever touching the full tick history during update().
         */
        this._maxWindow  = Math.max(...this.VOL_WINDOWS); // e.g. 300
        this._logReturns = [];       // length bounded to _maxWindow
        this._lastQuote  = null;     // last tick quote seen
    }

    /**
     * Recalculate everything for the newest tick.
     * Incremental: appends one log-return instead of recomputing from full history.
     * Call this on every tick.
     */
    update() {
        const tick = this.tickStore.getCurrentTick();
        if (!tick) return;

        const { quote } = tick;

        // --- 1. Append one log-return (O(1)) ---
        if (this._lastQuote !== null && this._lastQuote > 0 && quote > 0) {
            const lr = Math.log(quote / this._lastQuote);
            this._logReturns.push(lr);
            // Keep buffer bounded to the largest window we need
            if (this._logReturns.length > this._maxWindow) {
                this._logReturns.shift();
            }
        }
        this._lastQuote = quote;

        const len = this._logReturns.length;
        if (len < 2) return;

        // --- 2. Rolling σ for each window (slice from tail — max 300 values) ---
        for (const w of this.VOL_WINDOWS) {
            if (len >= w) {
                const slice = this._logReturns.slice(len - w);
                this.rollingVol[w] = this._stddev(slice);
            } else {
                this.rollingVol[w] = null;
            }
        }

        // --- 3. Vol Ratio ---
        const volShort = this.rollingVol[this.VOL_SHORT];
        const volBase  = this.rollingVol[this.VOL_BASELINE];
        if (volShort != null && volBase != null && volBase > 0) {
            this.volRatio = volShort / volBase;
            if      (this.volRatio >= 1.3) this.volRatioLabel = 'HIGH';
            else if (this.volRatio >= 1.1) this.volRatioLabel = 'ABOVE AVG';
            else if (this.volRatio >= 0.9) this.volRatioLabel = 'NORMAL';
            else if (this.volRatio >= 0.7) this.volRatioLabel = 'BELOW AVG';
            else                           this.volRatioLabel = 'LOW';
        } else {
            this.volRatio     = null;
            this.volRatioLabel = 'N/A';
        }

        // --- 4. Vol Trend ---
        if (volShort != null) {
            this._vol30History.push(volShort);
            if (this._vol30History.length > 60) this._vol30History.shift();

            if (this._vol30History.length >= 31) {
                const prev = this._vol30History[this._vol30History.length - 31];
                const curr = this._vol30History[this._vol30History.length - 1];
                if      (curr > prev * 1.05) this.volTrend = 'EXPANDING';
                else if (curr < prev * 0.95) this.volTrend = 'CONTRACTING';
                else                         this.volTrend = 'STABLE';
            }
        }

        // --- 5. Tick Momentum ---
        if (len >= this.MOMENTUM_WINDOW) {
            const recent = this._logReturns.slice(len - this.MOMENTUM_WINDOW);
            let ups = 0, downs = 0;
            for (const r of recent) {
                if (r > 0) ups++;
                else if (r < 0) downs++;
            }
            this.momentumScore = (ups - downs) / this.MOMENTUM_WINDOW;
            if      (this.momentumScore >  0.4) this.momentumDirection = 'UP';
            else if (this.momentumScore < -0.4) this.momentumDirection = 'DOWN';
            else                                this.momentumDirection = 'NEUTRAL';
        }
    }

    /**
     * Population standard deviation
     * @param {number[]} arr
     * @returns {number}
     */
    _stddev(arr) {
        const n = arr.length;
        if (n === 0) return 0;
        let sum = 0;
        for (const v of arr) sum += v;
        const mean = sum / n;
        let sqSum = 0;
        for (const v of arr) sqSum += (v - mean) ** 2;
        return Math.sqrt(sqSum / n);
    }

    /**
     * Get the per-tick σ for the given window (used by probabilityEngine)
     * @param {number} window
     * @returns {number|null}
     */
    getSigma(window) {
        return this.rollingVol[window] || null;
    }

    /**
     * Get full snapshot for broadcasting to the dashboard
     */
    getSnapshot() {
        return {
            rollingVol: { ...this.rollingVol },
            volRatio:      this.volRatio,
            volRatioLabel: this.volRatioLabel,
            volTrend:      this.volTrend,
            momentum: {
                score:     this.momentumScore,
                direction: this.momentumDirection
            }
        };
    }
}

module.exports = VolatilityEngine;
