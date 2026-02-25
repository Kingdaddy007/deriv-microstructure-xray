/**
 * Probability Engine (v2)
 *
 * Calculates touch probability using TWO methods:
 * 1. Theoretical: GBM reflection formula P = 2Φ(-B / σ√T)
 * 2. Empirical: Historical MFE lookup from labeled dataset
 *
 * Combined estimate = 0.6 × theoretical + 0.4 × empirical
 */

const Database = require('better-sqlite3');
const config = require('./config');

/**
 * Standard normal CDF (rational approximation, accurate to ~10⁻⁷)
 * @param {number} x
 * @returns {number}
 */
function normalCDF(x) {
    if (x < -8) return 0;
    if (x > 8) return 1;
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.SQRT2;
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return 0.5 * (1.0 + sign * y);
}

class ProbabilityEngine {
    /**
     * @param {string} symbol
     * @param {import('./volatilityEngine')} volEngine
     */
    constructor(symbol, volEngine) {
        this.symbol = symbol;
        this.volEngine = volEngine;
        this.T = config.TOUCH_WINDOW_TICKS; // 120 ticks

        // Try to load empirical data
        this.hasEmpirical = false;
        try {
            this.db = new Database(config.DB_PATH, { readonly: true });
            const count = this.db.prepare('SELECT COUNT(*) as c FROM mfe_dataset WHERE symbol = ?').get(this.symbol);
            if (count && count.c > 100) {
                this.hasEmpirical = true;
                console.log(`[ProbEngine] Loaded empirical data for ${symbol}: ${count.c} samples`);
            }
        } catch (e) {
            console.warn(`[ProbEngine] No empirical database found. Using theoretical only.`);
            this.db = null;
        }
    }

    /**
     * Theoretical touch probability using GBM reflection principle.
     * P(touch) = 2 × Φ(-B / (σ × √T))
     *
     * @param {number} barrierDistance - Absolute barrier distance in price units
     * @param {number} currentPrice - Current spot price
     * @returns {number|null} probability or null if insufficient data
     */
    theoretical(barrierDistance, currentPrice) {
        // Use 30-tick σ as the per-tick volatility
        const sigma = this.volEngine.getSigma(30);
        if (sigma == null || sigma === 0) return null;

        // Convert barrier to fractional distance (relative to price)
        const B = barrierDistance / currentPrice;
        const sigmaTotal = sigma * Math.sqrt(this.T);

        if (sigmaTotal === 0) return null;
        return 2 * normalCDF(-B / sigmaTotal);
    }

    /**
     * Empirical touch probability from historical MFE dataset.
     * Simple: what fraction of historical 120-tick windows had MFE >= D?
     *
     * @param {number} barrierDistance
     * @param {'up'|'down'} direction
     * @returns {{probability: number, sampleSize: number}|null}
     */
    empirical(barrierDistance, direction) {
        if (!this.hasEmpirical || !this.db) return null;

        const col = direction === 'up' ? 'mfe_up_120' : 'mfe_down_120';
        const result = this.db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN ${col} >= ? THEN 1 ELSE 0 END) as hits
      FROM mfe_dataset WHERE symbol = ?
    `).get(barrierDistance, this.symbol);

        if (!result || result.total === 0) return null;
        return {
            probability: result.hits / result.total,
            sampleSize: result.total
        };
    }

    /**
     * Combined estimate for a specific direction.
     * 0.6 × theoretical + 0.4 × empirical (if available)
     *
     * @param {number} barrierDistance
     * @param {number} currentPrice
     * @param {'up'|'down'} direction
     * @returns {Object}
     */
    estimate(barrierDistance, currentPrice, direction) {
        const theo = this.theoretical(barrierDistance, currentPrice);
        const emp = this.empirical(barrierDistance, direction);

        let combined;
        let sampleSize = 0;

        if (theo != null && emp != null) {
            combined = 0.6 * theo + 0.4 * emp.probability;
            sampleSize = emp.sampleSize;
        } else if (theo != null) {
            combined = theo;
        } else if (emp != null) {
            combined = emp.probability;
            sampleSize = emp.sampleSize;
        } else {
            combined = null;
        }

        return {
            theoretical: theo,
            empirical: emp ? emp.probability : null,
            combined,
            sampleSize
        };
    }

    close() {
        if (this.db) this.db.close();
    }
}

module.exports = ProbabilityEngine;
