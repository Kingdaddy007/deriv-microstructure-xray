/**
 * Swarm Engine Tests — Jest format
 *
 * Run: npm test -- swarmEngine
 *
 * Tests each agent's vote logic and diagnostic values.
 * Uses mock volEngine — no live data needed.
 */

const SwarmEngine = require('./swarmEngine');
const { normalCDF, touchProb } = SwarmEngine;

// ── Helper math tests ─────────────────────────────────────────

describe('normalCDF', () => {
    test('normalCDF(0) ≈ 0.5', () => {
        expect(Math.abs(normalCDF(0) - 0.5)).toBeLessThan(0.001);
    });
    test('normalCDF(-1.96) ≈ 0.025', () => {
        expect(Math.abs(normalCDF(-1.96) - 0.025)).toBeLessThan(0.005);
    });
    test('normalCDF(-8) = 0', () => {
        expect(normalCDF(-8)).toBe(0);
    });
    test('normalCDF(8) = 1', () => {
        expect(normalCDF(8)).toBe(1);
    });
    test('normalCDF(-100) = 0', () => {
        expect(normalCDF(-100)).toBe(0);
    });
    test('normalCDF(100) = 1', () => {
        expect(normalCDF(100)).toBe(1);
    });
});

describe('touchProb', () => {
    test('High vol, tiny barrier → near certainty', () => {
        const p = touchProb(0.003, 2.0, 56000, 120);
        expect(p).not.toBeNull();
        expect(p).toBeGreaterThan(0.95);
    });
    test('Low vol, wide barrier → near zero', () => {
        const p = touchProb(0.00005, 500.0, 56000, 120);
        expect(p).not.toBeNull();
        expect(p).toBeLessThan(0.1);
    });
    test('null sigma → null', () => {
        expect(touchProb(null, 2.0, 56000, 120)).toBeNull();
    });
    test('zero sigma → null', () => {
        expect(touchProb(0, 2.0, 56000, 120)).toBeNull();
    });
    test('zero price → null', () => {
        expect(touchProb(0.001, 2.0, 0, 120)).toBeNull();
    });
});

// ── Mock factories ────────────────────────────────────────────

function makeVolEngine(overrides = {}) {
    return {
        getSigma: (window) => overrides[`sigma${window}`] !== undefined ? overrides[`sigma${window}`] : null,
        momentumScore: overrides.momentumScore !== undefined ? overrides.momentumScore : 0,
        momentumDirection: overrides.momentumDirection || 'NEUTRAL',
        volRatio: overrides.volRatio !== undefined ? overrides.volRatio : null,
        volTrend: overrides.volTrend || 'N/A'
    };
}

// ── Agent 1: Fast Reader ──────────────────────────────────────

describe('Agent 1: Fast Reader', () => {
    test('High vol → YES with numeric edge and sigma', () => {
        const vol = makeVolEngine({ sigma7: 0.003 });
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentFastReader(2.0, 56000, 0.5);
        expect(r.vote).toBe(true);
        expect(typeof r.edge).toBe('number');
        expect(typeof r.sigma).toBe('number');
    });

    test('High implied prob (bad payout) → edge negative → NO', () => {
        const vol = makeVolEngine({ sigma7: 0.003 });
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentFastReader(2.0, 56000, 0.99);
        expect(r.vote).toBe(false);
    });

    test('Null sigma (warmup) → NO with null edge', () => {
        const vol = makeVolEngine({});
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentFastReader(2.0, 56000, 0.5);
        expect(r.vote).toBe(false);
        expect(r.edge).toBeNull();
    });
});

// ── Agent 2: Steady Hand ──────────────────────────────────────

describe('Agent 2: Steady Hand', () => {
    test('High 60-tick sigma → YES', () => {
        const vol = makeVolEngine({ sigma60: 0.003 });
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentSteadyHand(2.0, 56000, 0.5);
        expect(r.vote).toBe(true);
    });

    test('Null 60-tick sigma → NO', () => {
        const vol = makeVolEngine({});
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentSteadyHand(2.0, 56000, 0.5);
        expect(r.vote).toBe(false);
    });

    test('Spike: FastReader YES, SteadyHand NO', () => {
        const vol = makeVolEngine({ sigma7: 0.003 });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentFastReader(2.0, 56000, 0.5).vote).toBe(true);
        expect(swarm._agentSteadyHand(2.0, 56000, 0.5).vote).toBe(false);
    });
});

// ── Agent 3: Trend Surfer ─────────────────────────────────────

describe('Agent 3: Trend Surfer', () => {
    test('Strong UP momentum, UP trade → YES', () => {
        const vol = makeVolEngine({ momentumScore: 0.5 });
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentTrendSurfer('UP');
        expect(r.vote).toBe(true);
        expect(r.score).toBe(0.5);
    });

    test('Strong DOWN momentum, DOWN trade → YES', () => {
        const vol = makeVolEngine({ momentumScore: -0.6 });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentTrendSurfer('DOWN').vote).toBe(true);
    });

    test('UP momentum but DOWN trade → NO', () => {
        const vol = makeVolEngine({ momentumScore: 0.5 });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentTrendSurfer('DOWN').vote).toBe(false);
    });

    test('Weak momentum → NO (below 0.3 threshold)', () => {
        const vol = makeVolEngine({ momentumScore: 0.2 });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentTrendSurfer('UP').vote).toBe(false);
    });

    test('Neutral (0) → NO for both directions', () => {
        const vol = makeVolEngine({ momentumScore: 0 });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentTrendSurfer('UP').vote).toBe(false);
        expect(swarm._agentTrendSurfer('DOWN').vote).toBe(false);
    });
});

// ── Agent 4: Climate Check ────────────────────────────────────

describe('Agent 4: Climate Check', () => {
    test('Healthy market → YES', () => {
        const vol = makeVolEngine({ volRatio: 1.2, volTrend: 'EXPANDING' });
        const swarm = new SwarmEngine(vol);
        const r = swarm._agentClimateCheck();
        expect(r.vote).toBe(true);
        expect(r.volRatio).toBe(1.2);
        expect(r.volTrend).toBe('EXPANDING');
    });

    test('Normal but stable → YES', () => {
        const vol = makeVolEngine({ volRatio: 0.95, volTrend: 'STABLE' });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentClimateCheck().vote).toBe(true);
    });

    test('Exactly at threshold (0.75) → YES', () => {
        const vol = makeVolEngine({ volRatio: 0.75, volTrend: 'STABLE' });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentClimateCheck().vote).toBe(true);
    });

    test('Low ratio (below 0.75) → NO', () => {
        const vol = makeVolEngine({ volRatio: 0.6, volTrend: 'STABLE' });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentClimateCheck().vote).toBe(false);
    });

    test('CONTRACTING → NO (even with good ratio)', () => {
        const vol = makeVolEngine({ volRatio: 1.5, volTrend: 'CONTRACTING' });
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentClimateCheck().vote).toBe(false);
    });

    test('Null volRatio (warmup) → NO', () => {
        const vol = makeVolEngine({});
        const swarm = new SwarmEngine(vol);
        expect(swarm._agentClimateCheck().vote).toBe(false);
    });
});

// ── Full vote tests ───────────────────────────────────────────

describe('Full Vote', () => {
    test('4/4 green light', () => {
        const vol = makeVolEngine({
            sigma7: 0.003, sigma60: 0.003,
            momentumScore: 0.5, volRatio: 1.1, volTrend: 'STABLE'
        });
        const swarm = new SwarmEngine(vol);
        const r = swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(r.consensus).toBe(4);
        expect(r.greenLight).toBe(true);
        expect(r.votes.fastReader.vote).toBe(true);
        expect(r.votes.steadyHand.vote).toBe(true);
        expect(r.votes.trendSurfer.vote).toBe(true);
        expect(r.votes.climateCheck.vote).toBe(true);
    });

    test('3/4 green light (ClimateCheck fails)', () => {
        const vol = makeVolEngine({
            sigma7: 0.003, sigma60: 0.003,
            momentumScore: 0.5, volRatio: 0.7, volTrend: 'CONTRACTING'
        });
        const swarm = new SwarmEngine(vol);
        const r = swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(r.consensus).toBe(3);
        expect(r.greenLight).toBe(true);
        expect(r.votes.climateCheck.vote).toBe(false);
    });

    test('2/4 no green light', () => {
        const vol = makeVolEngine({
            sigma7: null, sigma60: null,
            momentumScore: 0.5, volRatio: 1.1, volTrend: 'STABLE'
        });
        const swarm = new SwarmEngine(vol);
        const r = swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(r.consensus).toBe(2);
        expect(r.greenLight).toBe(false);
    });

    test('0/4 warmup', () => {
        const vol = makeVolEngine({});
        const swarm = new SwarmEngine(vol);
        const r = swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(r.consensus).toBe(0);
        expect(r.greenLight).toBe(false);
    });
});

// ── Diagnostic values ─────────────────────────────────────────

describe('Diagnostic Values', () => {
    test('all diagnostic fields present in vote result', () => {
        const vol = makeVolEngine({
            sigma7: 0.003, sigma60: 0.002,
            momentumScore: 0.5, volRatio: 1.2, volTrend: 'EXPANDING'
        });
        const swarm = new SwarmEngine(vol);
        const r = swarm.vote(2.0, 56000, 0.5, 'UP');

        expect(typeof r.votes.fastReader.edge).toBe('number');
        expect(typeof r.votes.fastReader.sigma).toBe('number');
        expect(typeof r.votes.steadyHand.edge).toBe('number');
        expect(typeof r.votes.steadyHand.sigma).toBe('number');
        expect(typeof r.votes.trendSurfer.score).toBe('number');
        expect(typeof r.votes.climateCheck.volRatio).toBe('number');
        expect(typeof r.votes.climateCheck.volTrend).toBe('string');
    });
});

// ── Consensus trend ───────────────────────────────────────────

describe('Consensus Trend', () => {
    test('trend tracks rising and falling consensus', () => {
        const vol = makeVolEngine({
            sigma10: 0.003, sigma60: 0.003,
            momentumScore: 0.5, volRatio: 1.1, volTrend: 'STABLE'
        });
        const swarm = new SwarmEngine(vol);

        // Build history at 4/4
        for (let i = 0; i < 5; i++) swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(swarm.consensusTrend).toBe('STEADY');

        // Degrade → ClimateCheck fails → 3/4
        vol.volRatio = 0.6;
        swarm.vote(2.0, 56000, 0.5, 'UP');
        swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(swarm.consensusTrend).toBe('FALLING');

        // Restore → back to 4/4
        vol.volRatio = 1.2;
        for (let i = 0; i < 3; i++) swarm.vote(2.0, 56000, 0.5, 'UP');
        expect(swarm.consensusTrend).toBe('RISING');
    });
});
