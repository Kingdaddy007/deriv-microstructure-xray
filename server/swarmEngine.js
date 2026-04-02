/**
 * Swarm Engine — Phase 2 of Cipher Swarm Bot
 *
 * 4 agents, each answers one question with YES/NO.
 * Collects votes. 3/4 = green light.
 * Returns diagnostic values for trade logging (Phase 4).
 */

const config = require('./config');

// Standard normal CDF — Abramowitz & Stegun approximation
function normalCDF(x) {
    if (x <= -8) return 0;
    if (x >= 8) return 1;
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.SQRT2;
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return 0.5 * (1.0 + sign * y);
}

// Theoretical touch probability using GBM reflection formula
// P(touch) = 2 * Φ(-B / σ√T)
function touchProb(sigma, barrierDistance, currentPrice, T) {
    if (!sigma || sigma === 0 || !currentPrice || currentPrice === 0) return null;
    const B = barrierDistance / currentPrice;
    const sigmaTotal = sigma * Math.sqrt(T);
    if (sigmaTotal === 0) return null;
    return 2 * normalCDF(-B / sigmaTotal);
}

class SwarmEngine {
    constructor(volEngine) {
        this.vol = volEngine;
        this.T = config.TOUCH_WINDOW_TICKS;  // 120
        this.EDGE_MIN = config.EDGE_MINIMUM;  // 0.03

        // Consensus tracking
        this.consensusHistory = [];
        this.consensusTrend = 'STEADY';
    }

    vote(barrierDistance, currentPrice, impliedProb, direction) {
        const votes = {
            fastReader: this._agentFastReader(barrierDistance, currentPrice, impliedProb),
            steadyHand: this._agentSteadyHand(barrierDistance, currentPrice, impliedProb),
            trendSurfer: this._agentTrendSurfer(direction),
            climateCheck: this._agentClimateCheck()
        };

        const consensus = Object.values(votes).filter(v => v.vote).length;

        // Track consensus trend
        this.consensusHistory.push(consensus);
        if (this.consensusHistory.length > 10) this.consensusHistory.shift();
        this._updateConsensusTrend();

        return {
            votes,
            consensus,
            consensusTrend: this.consensusTrend,
            greenLight: consensus >= 3
        };
    }

    // ─────────────────────────────────────────
    // AGENT 1: Fast Reader (7-second energy)
    // ─────────────────────────────────────────
    // "Right NOW, is there enough energy to reach the barrier?"
    // V2: Uses 7-tick sigma (was 10) → GBM formula → edge vs implied prob

    _agentFastReader(barrierDistance, currentPrice, impliedProb) {
        const sigma = this.vol.getSigma(7);   // V2: 7 ticks — more immediate "right now" energy
        const prob = touchProb(sigma, barrierDistance, currentPrice, this.T);
        if (prob === null) return { vote: false, edge: null, sigma: sigma };
        const edge = prob - impliedProb;
        return { vote: edge >= this.EDGE_MIN, edge: Math.round(edge * 10000) / 10000, sigma };
    }

    // ─────────────────────────────────────────
    // AGENT 2: Steady Hand (60-second energy)
    // ─────────────────────────────────────────
    // "Is that energy SUSTAINED, not a blip?"
    // Uses 60-tick sigma → same check

    _agentSteadyHand(barrierDistance, currentPrice, impliedProb) {
        const sigma = this.vol.getSigma(60);
        const prob = touchProb(sigma, barrierDistance, currentPrice, this.T);
        if (prob === null) return { vote: false, edge: null, sigma: sigma };
        const edge = prob - impliedProb;
        return { vote: edge >= this.EDGE_MIN, edge: Math.round(edge * 10000) / 10000, sigma };
    }

    // ─────────────────────────────────────────
    // AGENT 3: Trend Surfer (directional flow)
    // ─────────────────────────────────────────
    // "Are the last 10 ticks flowing in my direction?"
    // Uses momentumScore from volEngine

    _agentTrendSurfer(direction) {
        const score = this.vol.momentumScore;
        let vote = false;
        if (direction === 'UP') vote = score > 0.3;
        else if (direction === 'DOWN') vote = score < -0.3;
        return { vote, score };
    }

    // ─────────────────────────────────────────
    // AGENT 4: Climate Check (market liveliness)
    // ─────────────────────────────────────────
    // "Is the market even alive?"
    // Uses volRatio + volTrend
    // V2: threshold lowered from 0.9 to 0.75

    _agentClimateCheck() {
        const volRatio = this.vol.volRatio;
        const volTrend = this.vol.volTrend;

        if (volRatio === null) return { vote: false, volRatio, volTrend };
        if (volRatio < 0.75) return { vote: false, volRatio, volTrend }; // V2: was 0.9
        if (volTrend === 'CONTRACTING') return { vote: false, volRatio, volTrend };

        return { vote: true, volRatio, volTrend };
    }

    _updateConsensusTrend() {
        if (this.consensusHistory.length < 5) {
            this.consensusTrend = 'STEADY';
            return;
        }
        const recent = this.consensusHistory.slice(-5);
        const first = recent[0], last = recent[4];
        if (last > first) this.consensusTrend = 'RISING';
        else if (last < first) this.consensusTrend = 'FALLING';
        else this.consensusTrend = 'STEADY';
    }
}

// Export class + helpers for testing
module.exports = SwarmEngine;
module.exports.normalCDF = normalCDF;
module.exports.touchProb = touchProb;
