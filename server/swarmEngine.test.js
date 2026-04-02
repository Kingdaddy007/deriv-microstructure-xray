/**
 * Swarm Engine Tests
 *
 * Run: node server/swarmEngine.test.js
 *
 * Tests each agent's vote logic and diagnostic values.
 * Uses mock volEngine — no live data needed.
 */

const SwarmEngine = require('./swarmEngine');
const { normalCDF, touchProb } = SwarmEngine;

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        console.log(`  ❌ ${testName}`);
    }
}

// ── Helper math tests ─────────────────────────────────────────

console.log('\n--- normalCDF ---');
assert(Math.abs(normalCDF(0) - 0.5) < 0.001, 'normalCDF(0) ≈ 0.5');
assert(Math.abs(normalCDF(-1.96) - 0.025) < 0.005, 'normalCDF(-1.96) ≈ 0.025');
assert(normalCDF(-8) === 0, 'normalCDF(-8) = 0');
assert(normalCDF(8) === 1, 'normalCDF(8) = 1');
assert(normalCDF(-100) === 0, 'normalCDF(-100) = 0');
assert(normalCDF(100) === 1, 'normalCDF(100) = 1');

console.log('\n--- touchProb ---');
// High sigma + tiny barrier → near certainty
const p1 = touchProb(0.003, 2.0, 56000, 120);
assert(p1 !== null && p1 > 0.95, `High vol, tiny barrier = ${p1?.toFixed(4)} > 0.95`);

// Low sigma + wide barrier → near zero
const p2 = touchProb(0.00005, 500.0, 56000, 120);
assert(p2 !== null && p2 < 0.1, `Low vol, wide barrier = ${p2?.toFixed(4)} < 0.1`);

// Null inputs
assert(touchProb(null, 2.0, 56000, 120) === null, 'touchProb(null sigma) = null');
assert(touchProb(0, 2.0, 56000, 120) === null, 'touchProb(zero sigma) = null');
assert(touchProb(0.001, 2.0, 0, 120) === null, 'touchProb(zero price) = null');

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

console.log('\n--- Agent 1: Fast Reader ---');

// High sigma → high edge → YES
{
    const vol = makeVolEngine({ sigma10: 0.003 });
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentFastReader(2.0, 56000, 0.5);
    assert(r.vote === true, `High vol → YES (edge=${r.edge})`);
    assert(typeof r.edge === 'number', 'Edge is a number');
    assert(typeof r.sigma === 'number', 'Sigma is a number');
}

// High implied prob (bad payout) → edge negative → NO
{
    const vol = makeVolEngine({ sigma10: 0.003 });
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentFastReader(2.0, 56000, 0.99);
    assert(r.vote === false, `High implied prob → NO (edge=${r.edge})`);
}

// Null sigma (warmup) → NO
{
    const vol = makeVolEngine({});
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentFastReader(2.0, 56000, 0.5);
    assert(r.vote === false, 'Null sigma → NO');
    assert(r.edge === null, 'Edge null when sigma null');
}

// ── Agent 2: Steady Hand ──────────────────────────────────────

console.log('\n--- Agent 2: Steady Hand ---');

// High 60-tick sigma → YES
{
    const vol = makeVolEngine({ sigma60: 0.003 });
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentSteadyHand(2.0, 56000, 0.5);
    assert(r.vote === true, `High sustained vol → YES (edge=${r.edge})`);
}

// Null 60-tick sigma → NO
{
    const vol = makeVolEngine({});
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentSteadyHand(2.0, 56000, 0.5);
    assert(r.vote === false, 'Null sigma → NO');
}

// FastReader YES but SteadyHand NO (spike, not sustained)
{
    const vol = makeVolEngine({ sigma10: 0.003 });
    const swarm = new SwarmEngine(vol);
    const fr = swarm._agentFastReader(2.0, 56000, 0.5);
    const sh = swarm._agentSteadyHand(2.0, 56000, 0.5);
    assert(fr.vote === true && sh.vote === false, 'Spike: FastReader YES, SteadyHand NO');
}

// ── Agent 3: Trend Surfer ─────────────────────────────────────

console.log('\n--- Agent 3: Trend Surfer ---');

// Strong UP momentum, UP trade → YES
{
    const vol = makeVolEngine({ momentumScore: 0.5 });
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentTrendSurfer('UP');
    assert(r.vote === true, 'Score 0.5, UP trade → YES');
    assert(r.score === 0.5, 'Score diagnostic correct');
}

// Strong DOWN momentum, DOWN trade → YES
{
    const vol = makeVolEngine({ momentumScore: -0.6 });
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentTrendSurfer('DOWN');
    assert(r.vote === true, 'Score -0.6, DOWN trade → YES');
}

// UP momentum but DOWN trade → NO
{
    const vol = makeVolEngine({ momentumScore: 0.5 });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentTrendSurfer('DOWN').vote === false, 'Score 0.5, DOWN trade → NO');
}

// Weak momentum → NO (below 0.3 threshold)
{
    const vol = makeVolEngine({ momentumScore: 0.2 });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentTrendSurfer('UP').vote === false, 'Score 0.2, UP → NO (below 0.3)');
}

// Neutral (0) → NO for both directions
{
    const vol = makeVolEngine({ momentumScore: 0 });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentTrendSurfer('UP').vote === false, 'Score 0, UP → NO');
    assert(swarm._agentTrendSurfer('DOWN').vote === false, 'Score 0, DOWN → NO');
}

// ── Agent 4: Climate Check ────────────────────────────────────

console.log('\n--- Agent 4: Climate Check ---');

// Healthy market → YES
{
    const vol = makeVolEngine({ volRatio: 1.2, volTrend: 'EXPANDING' });
    const swarm = new SwarmEngine(vol);
    const r = swarm._agentClimateCheck();
    assert(r.vote === true, 'Ratio 1.2, EXPANDING → YES');
    assert(r.volRatio === 1.2, 'volRatio diagnostic correct');
    assert(r.volTrend === 'EXPANDING', 'volTrend diagnostic correct');
}

// Normal but stable → YES
{
    const vol = makeVolEngine({ volRatio: 0.95, volTrend: 'STABLE' });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentClimateCheck().vote === true, 'Ratio 0.95, STABLE → YES');
}

// Exactly at threshold (0.9) → YES
{
    const vol = makeVolEngine({ volRatio: 0.9, volTrend: 'STABLE' });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentClimateCheck().vote === true, 'Ratio 0.9, STABLE → YES');
}

// Low ratio → NO
{
    const vol = makeVolEngine({ volRatio: 0.7, volTrend: 'STABLE' });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentClimateCheck().vote === false, 'Ratio 0.7 → NO');
}

// Contracting → NO (even with good ratio)
{
    const vol = makeVolEngine({ volRatio: 1.5, volTrend: 'CONTRACTING' });
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentClimateCheck().vote === false, 'CONTRACTING → NO');
}

// Null ratio (warmup) → NO
{
    const vol = makeVolEngine({});
    const swarm = new SwarmEngine(vol);
    assert(swarm._agentClimateCheck().vote === false, 'Null volRatio → NO');
}

// ── Full vote tests ───────────────────────────────────────────

console.log('\n--- Full Vote ---');

// 4/4 green light
{
    const vol = makeVolEngine({
        sigma10: 0.003, sigma60: 0.003,
        momentumScore: 0.5, volRatio: 1.1, volTrend: 'STABLE'
    });
    const swarm = new SwarmEngine(vol);
    const r = swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(r.consensus === 4, '4/4 consensus');
    assert(r.greenLight === true, 'Green light ON');
    assert(r.votes.fastReader.vote === true, 'FastReader YES');
    assert(r.votes.steadyHand.vote === true, 'SteadyHand YES');
    assert(r.votes.trendSurfer.vote === true, 'TrendSurfer YES');
    assert(r.votes.climateCheck.vote === true, 'ClimateCheck YES');
}

// 3/4 green light (ClimateCheck fails)
{
    const vol = makeVolEngine({
        sigma10: 0.003, sigma60: 0.003,
        momentumScore: 0.5, volRatio: 0.7, volTrend: 'CONTRACTING'
    });
    const swarm = new SwarmEngine(vol);
    const r = swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(r.consensus === 3, '3/4 consensus');
    assert(r.greenLight === true, 'Green light ON at 3/4');
    assert(r.votes.climateCheck.vote === false, 'ClimateCheck NO');
}

// 2/4 no green light (only TrendSurfer + ClimateCheck pass)
{
    const vol = makeVolEngine({
        sigma10: null, sigma60: null,
        momentumScore: 0.5, volRatio: 1.1, volTrend: 'STABLE'
    });
    const swarm = new SwarmEngine(vol);
    const r = swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(r.consensus === 2, `2/4 consensus`);
    assert(r.greenLight === false, 'Green light OFF at 2/4');
    assert(r.votes.fastReader.vote === false, 'FastReader NO (null sigma)');
    assert(r.votes.steadyHand.vote === false, 'SteadyHand NO (null sigma)');
}

// 0/4 warmup (everything null)
{
    const vol = makeVolEngine({});
    const swarm = new SwarmEngine(vol);
    const r = swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(r.consensus === 0, '0/4 consensus (warmup)');
    assert(r.greenLight === false, 'Green light OFF during warmup');
}

// ── Diagnostic values in vote result ──────────────────────────

console.log('\n--- Diagnostic Values ---');

{
    const vol = makeVolEngine({
        sigma10: 0.003, sigma60: 0.002,
        momentumScore: 0.5, volRatio: 1.2, volTrend: 'EXPANDING'
    });
    const swarm = new SwarmEngine(vol);
    const r = swarm.vote(2.0, 56000, 0.5, 'UP');

    assert(typeof r.votes.fastReader.edge === 'number', 'FastReader has edge');
    assert(typeof r.votes.fastReader.sigma === 'number', 'FastReader has sigma');
    assert(typeof r.votes.steadyHand.edge === 'number', 'SteadyHand has edge');
    assert(typeof r.votes.steadyHand.sigma === 'number', 'SteadyHand has sigma');
    assert(typeof r.votes.trendSurfer.score === 'number', 'TrendSurfer has score');
    assert(typeof r.votes.climateCheck.volRatio === 'number', 'ClimateCheck has volRatio');
    assert(typeof r.votes.climateCheck.volTrend === 'string', 'ClimateCheck has volTrend');
}

// ── Consensus trend tests ─────────────────────────────────────

console.log('\n--- Consensus Trend ---');

{
    const vol = makeVolEngine({
        sigma10: 0.003, sigma60: 0.003,
        momentumScore: 0.5, volRatio: 1.1, volTrend: 'STABLE'
    });
    const swarm = new SwarmEngine(vol);

    // First 4 votes at consensus=4 → STEADY (not enough history)
    for (let i = 0; i < 4; i++) swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(swarm.consensusTrend === 'STEADY', 'First 4 votes → STEADY');

    // 5th vote → STEADY
    swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(swarm.consensusTrend === 'STEADY', '5th vote → STEADY');

    // Now degrade volRatio → consensus drops to 3 → FALLING
    vol.volRatio = 0.7; // ClimateCheck now votes NO
    // After 2 votes at 3: history = [4,4,4,4,4,4,3,3]
    // Last 5: [4,4,4,3,3] → 4 > 3 → FALLING
    swarm.vote(2.0, 56000, 0.5, 'UP');
    swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(swarm.consensusTrend === 'FALLING', 'Consensus dropping → FALLING');

    // Restore → consensus back to 4 → RISING
    vol.volRatio = 1.2;
    // Push 3 votes at consensus=4 to shift last-5 window
    // History before: [4,4,4,4,4,4,3,3]
    // After 3 pushes: [4,4,4,4,4,6,3,3,4,4,4] → shifted to [4,4,4,4,6,3,3,4,4,4]
    // Wait, that's not right. Let me trace:
    // After degraded: history = [4,4,4,4,4,4,3,3], len=8
    // Push 4: len=9 → [4,4,4,4,4,4,3,3,4]
    // Push 4: len=10 → [4,4,4,4,4,4,3,3,4,4]
    // Push 4: len=11 → shift → [4,4,4,4,4,3,3,4,4,4]
    // Last 5: [3,3,4,4,4] → 3 < 4 → RISING
    for (let i = 0; i < 3; i++) swarm.vote(2.0, 56000, 0.5, 'UP');
    assert(swarm.consensusTrend === 'RISING', 'Consensus recovering → RISING');
}

// ── Summary ───────────────────────────────────────────────────

console.log('\n══════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
