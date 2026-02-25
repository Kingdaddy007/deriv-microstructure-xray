/**
 * Edge Calculator (v3) — Neutral, Decision-Free
 * Returns warnings[] instead of prescriptive signal/blocked.
 * The UI displays data; the trader decides.
 */

const config = require('./config');

class EdgeCalculator {
    constructor(volEngine) {
        this.volEngine = volEngine;
    }

    analyze(probEstimate, payoutROI, tickCount) {
        const impliedProb = 1 / (1 + payoutROI / 100);
        const ourProb = probEstimate.combined;
        const edge = ourProb != null ? ourProb - impliedProb : null;

        // Collect neutral warnings — not directives, just context
        const warnings = [];
        if (tickCount < config.WARMUP_TICKS) {
            warnings.push(`Warmup: ${tickCount}/${config.WARMUP_TICKS} ticks`);
        }
        if (this.volEngine.volRatio != null && this.volEngine.volRatio < 0.7) {
            warnings.push('Vol Ratio below 0.7 — market quiet');
        }
        if (this.volEngine.volTrend === 'CONTRACTING' && this.volEngine.volRatio < 0.9) {
            warnings.push('Vol contracting & below average');
        }
        if (ourProb == null) {
            warnings.push('Probability unavailable — insufficient data');
        }
        if (probEstimate.sampleSize < 500) {
            warnings.push(`Low sample size: ${probEstimate.sampleSize}`);
        }

        return {
            impliedProb,
            ourProb: ourProb ?? 0,
            theoretical: probEstimate.theoretical,
            empirical: probEstimate.empirical,
            edge: edge ?? 0,
            warnings,
            sampleSize: probEstimate.sampleSize
        };
    }
}

module.exports = EdgeCalculator;
