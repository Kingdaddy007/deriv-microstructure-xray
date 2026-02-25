/**
 * Phase 0 — Script 03: Statistical Analysis & Edge Feasibility
 * 
 * PURPOSE:
 *   Analyze the downloaded historical tick data to determine:
 *   1. Tick return distribution (normal vs fat-tailed?)
 *   2. Autocorrelation of returns (independent or correlated?)
 *   3. Maximum Forward Excursion (MFE) distribution for 120-tick windows
 *   4. How MFE varies by volatility regime
 *   5. Compare GBM theoretical touch probability vs empirical touch rate
 *   6. Estimate whether regime-conditioned estimation provides edge over Deriv's pricing
 * 
 * RUN:
 *   node research/03_data_analysis.js
 *   (First run 02_download_history.js to populate the database)
 * 
 * OUTPUT:
 *   Prints comprehensive statistical report to console.
 *   Saves key metrics to the database for later reference.
 */

const Database = require('better-sqlite3');
const config = require('../server/config');

const TOUCH_WINDOW = config.TOUCH_WINDOW_TICKS; // 120 ticks
const BARRIER_DISTANCES = [1.0, 1.5, 1.8, 2.0, 2.2, 2.5, 3.0, 4.0, 5.0]; // Test multiple D values

// ─── Logging ───────────────────────────────────────────────────────────────────
function log(cat, msg) {
    console.log(`[${cat}] ${msg}`);
}

// ─── Standard Normal CDF (Abramowitz & Stegun approximation) ───────────────────
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

// ─── GBM Touch Probability ────────────────────────────────────────────────────
function gbmTouchProb(barrierDist, sigma, T) {
    if (sigma <= 0 || T <= 0 || barrierDist <= 0) return 0;
    const sigmaTotal = sigma * Math.sqrt(T);
    return 2 * normalCDF(-barrierDist / sigmaTotal);
}

// ─── Main Analysis ─────────────────────────────────────────────────────────────
function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   PHASE 0 — STATISTICAL ANALYSIS & EDGE FEASIBILITY    ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    const db = new Database(config.DB_PATH, { readonly: true });

    // ─── Check Available Data ────────────────────────────────────
    const symbolStats = db.prepare(
        'SELECT symbol, COUNT(*) as cnt, MIN(epoch) as earliest, MAX(epoch) as latest FROM ticks GROUP BY symbol'
    ).all();

    if (symbolStats.length === 0) {
        log('ERROR', 'No tick data found. Run 02_download_history.js first.');
        process.exit(1);
    }

    for (const s of symbolStats) {
        const days = ((s.latest - s.earliest) / 86400).toFixed(2);
        log('DATA', `${s.symbol}: ${s.cnt} ticks, ${days} days`);
    }
    console.log('');

    // ─── Analyze Each Symbol ─────────────────────────────────────
    for (const stats of symbolStats) {
        analyzeSymbol(db, stats.symbol, stats.cnt);
        console.log('');
    }

    db.close();
    log('DONE', 'Analysis complete.');
}

function analyzeSymbol(db, symbol, tickCount) {
    console.log(`${'═'.repeat(60)}`);
    console.log(`  ANALYSIS: ${symbol}`);
    console.log(`${'═'.repeat(60)}`);

    // Load all ticks (sorted by epoch)
    const ticks = db.prepare(
        'SELECT epoch, quote FROM ticks WHERE symbol = ? ORDER BY epoch ASC'
    ).all(symbol);

    if (ticks.length < TOUCH_WINDOW * 2) {
        log('SKIP', `Not enough ticks for ${symbol} (need at least ${TOUCH_WINDOW * 2})`);
        return;
    }

    // ─── 1. Return Distribution Analysis ──────────────────────────
    log('STAT', '── 1. Tick Return Distribution ──');

    const logReturns = [];
    for (let i = 1; i < ticks.length; i++) {
        logReturns.push(Math.log(ticks[i].quote / ticks[i - 1].quote));
    }

    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / logReturns.length;
    const stdev = Math.sqrt(variance);
    const skewness = logReturns.reduce((a, r) => a + ((r - mean) / stdev) ** 3, 0) / logReturns.length;
    const kurtosis = logReturns.reduce((a, r) => a + ((r - mean) / stdev) ** 4, 0) / logReturns.length;

    log('STAT', `  N returns: ${logReturns.length}`);
    log('STAT', `  Mean: ${mean.toExponential(6)}`);
    log('STAT', `  StDev (per tick): ${stdev.toExponential(6)}`);
    log('STAT', `  Skewness: ${skewness.toFixed(4)} (0 = symmetric)`);
    log('STAT', `  Kurtosis: ${kurtosis.toFixed(4)} (3 = normal)`);
    log('STAT', `  Excess Kurtosis: ${(kurtosis - 3).toFixed(4)}`);
    log('STAT', `  ${kurtosis > 3.5 ? '⚠️ SIGNIFICANT fat tails' : kurtosis > 3.1 ? '⚠️ Mild fat tails' : '✅ Near-normal tails'}`);

    // ─── 2. Autocorrelation ──────────────────────────────────────
    log('STAT', '── 2. Autocorrelation of Returns ──');

    for (const lag of [1, 2, 5, 10, 30]) {
        if (logReturns.length > lag) {
            let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
            const n = logReturns.length - lag;
            for (let i = 0; i < n; i++) {
                const x = logReturns[i];
                const y = logReturns[i + lag];
                sumXY += x * y;
                sumX += x;
                sumY += y;
                sumX2 += x * x;
                sumY2 += y * y;
            }
            const autocorr = (n * sumXY - sumX * sumY) /
                (Math.sqrt(n * sumX2 - sumX * sumX) * Math.sqrt(n * sumY2 - sumY * sumY));
            const significant = Math.abs(autocorr) > 2 / Math.sqrt(n);
            log('STAT', `  Lag ${lag}: ${autocorr.toFixed(6)} ${significant ? '⚠️ SIGNIFICANT' : '✅ not significant'}`);
        }
    }

    // ─── 3. Rolling Volatility Analysis ──────────────────────────
    log('STAT', '── 3. Rolling Volatility (120-tick window) ──');

    const volValues = [];
    for (let i = TOUCH_WINDOW; i < logReturns.length; i++) {
        const windowReturns = logReturns.slice(i - TOUCH_WINDOW, i);
        const wMean = windowReturns.reduce((a, b) => a + b, 0) / TOUCH_WINDOW;
        const wVar = windowReturns.reduce((a, r) => a + (r - wMean) ** 2, 0) / TOUCH_WINDOW;
        volValues.push(Math.sqrt(wVar));
    }

    if (volValues.length > 0) {
        const sorted = [...volValues].sort((a, b) => a - b);
        const volMean = volValues.reduce((a, b) => a + b, 0) / volValues.length;
        const volMin = sorted[0];
        const volMax = sorted[sorted.length - 1];
        const volP10 = sorted[Math.floor(sorted.length * 0.1)];
        const volP50 = sorted[Math.floor(sorted.length * 0.5)];
        const volP90 = sorted[Math.floor(sorted.length * 0.9)];
        const volRatio = volMax / volMin;

        log('STAT', `  Samples: ${volValues.length}`);
        log('STAT', `  Mean σ: ${volMean.toExponential(4)}`);
        log('STAT', `  Min σ:  ${volMin.toExponential(4)}`);
        log('STAT', `  Max σ:  ${volMax.toExponential(4)}`);
        log('STAT', `  P10:    ${volP10.toExponential(4)}`);
        log('STAT', `  P50:    ${volP50.toExponential(4)}`);
        log('STAT', `  P90:    ${volP90.toExponential(4)}`);
        log('STAT', `  Max/Min ratio: ${volRatio.toFixed(1)}x`);
        log('STAT', `  ${volRatio > 3 ? '✅ Strong volatility variation — regime conditioning IS valuable' : '⚠️ Low volatility variation — regime conditioning may not help much'}`);
    }

    // ─── 4. Maximum Forward Excursion (MFE) ──────────────────────
    log('STAT', '── 4. Maximum Forward Excursion (MFE) — 120-tick windows ──');

    const mfeUp = [];
    const mfeDown = [];
    const mfeMax = [];         // max(up, down) per window
    const windowVols = [];     // volatility at start of each window

    // Step through every 30 ticks (overlapping windows) for more data points
    for (let i = 0; i < ticks.length - TOUCH_WINDOW; i += 30) {
        const startPrice = ticks[i].quote;
        let maxPrice = startPrice;
        let minPrice = startPrice;

        for (let j = 1; j <= TOUCH_WINDOW && (i + j) < ticks.length; j++) {
            const p = ticks[i + j].quote;
            if (p > maxPrice) maxPrice = p;
            if (p < minPrice) minPrice = p;
        }

        const up = maxPrice - startPrice;
        const down = startPrice - minPrice;

        mfeUp.push(up);
        mfeDown.push(down);
        mfeMax.push(Math.max(up, down));

        // Compute volatility at this window's start
        if (i >= TOUCH_WINDOW) {
            const windowReturns = [];
            for (let j = i - TOUCH_WINDOW + 1; j <= i; j++) {
                windowReturns.push(Math.log(ticks[j].quote / ticks[j - 1].quote));
            }
            const wMean = windowReturns.reduce((a, b) => a + b, 0) / TOUCH_WINDOW;
            const wVar = windowReturns.reduce((a, r) => a + (r - wMean) ** 2, 0) / TOUCH_WINDOW;
            windowVols.push(Math.sqrt(wVar));
        } else {
            windowVols.push(null);
        }
    }

    // MFE statistics
    const sortedUp = [...mfeUp].sort((a, b) => a - b);
    const sortedDown = [...mfeDown].sort((a, b) => a - b);
    const sortedMax = [...mfeMax].sort((a, b) => a - b);

    log('STAT', `  Windows analyzed: ${mfeUp.length}`);
    log('STAT', `  MFE Up — Mean: ${(mfeUp.reduce((a, b) => a + b, 0) / mfeUp.length).toFixed(4)}, ` +
        `P50: ${sortedUp[Math.floor(sortedUp.length * 0.5)].toFixed(4)}, ` +
        `P90: ${sortedUp[Math.floor(sortedUp.length * 0.9)].toFixed(4)}, ` +
        `Max: ${sortedUp[sortedUp.length - 1].toFixed(4)}`);
    log('STAT', `  MFE Down — Mean: ${(mfeDown.reduce((a, b) => a + b, 0) / mfeDown.length).toFixed(4)}, ` +
        `P50: ${sortedDown[Math.floor(sortedDown.length * 0.5)].toFixed(4)}, ` +
        `P90: ${sortedDown[Math.floor(sortedDown.length * 0.9)].toFixed(4)}, ` +
        `Max: ${sortedDown[sortedDown.length - 1].toFixed(4)}`);
    log('STAT', `  MFE Max (either dir) — P50: ${sortedMax[Math.floor(sortedMax.length * 0.5)].toFixed(4)}, ` +
        `P90: ${sortedMax[Math.floor(sortedMax.length * 0.9)].toFixed(4)}`);

    // ─── 5. Empirical Touch Probability for Various Barrier Distances ──
    log('STAT', '── 5. Empirical Touch Probability vs GBM ──');

    // Compute overall per-tick volatility for GBM comparison
    const overallSigma = stdev; // per-tick log-return stdev

    console.log('');
    console.log('  D (barrier) | Emp Touch+ | Emp Touch- | Emp Either | GBM P(touch) | Gap');
    console.log('  -----------|-----------|-----------|-----------|-------------|-----');

    for (const D of BARRIER_DISTANCES) {
        const empUp = mfeUp.filter(m => m >= D).length / mfeUp.length;
        const empDown = mfeDown.filter(m => m >= D).length / mfeDown.length;
        const empEither = mfeMax.filter(m => m >= D).length / mfeMax.length;
        const gbm = gbmTouchProb(D, overallSigma, TOUCH_WINDOW);
        const gap = empEither - gbm;

        console.log(`  ${D.toFixed(1).padStart(10)}  | ${(empUp * 100).toFixed(1).padStart(9)}% | ` +
            `${(empDown * 100).toFixed(1).padStart(9)}% | ${(empEither * 100).toFixed(1).padStart(9)}% | ` +
            `${(gbm * 100).toFixed(1).padStart(11)}% | ${gap > 0 ? '+' : ''}${(gap * 100).toFixed(1)}%`);
    }

    // ─── 6. Regime-Conditioned Analysis ──────────────────────────
    log('STAT', '');
    log('STAT', '── 6. Regime-Conditioned Touch Probability ──');
    log('STAT', '   (Does conditioning on volatility regime improve estimates?)');

    // Filter to windows where we have volatility data
    const validIndices = [];
    for (let i = 0; i < windowVols.length; i++) {
        if (windowVols[i] !== null) validIndices.push(i);
    }

    if (validIndices.length < 100) {
        log('STAT', '   Not enough data for regime analysis');
        return;
    }

    // Sort valid vols into terciles (low, medium, high)
    const validVols = validIndices.map(i => windowVols[i]);
    const sortedVols = [...validVols].sort((a, b) => a - b);
    const lowThresh = sortedVols[Math.floor(sortedVols.length / 3)];
    const highThresh = sortedVols[Math.floor(sortedVols.length * 2 / 3)];

    const regimes = { low: [], mid: [], high: [] };
    for (const idx of validIndices) {
        const vol = windowVols[idx];
        if (vol <= lowThresh) regimes.low.push(idx);
        else if (vol >= highThresh) regimes.high.push(idx);
        else regimes.mid.push(idx);
    }

    log('STAT', `   Regime sizes: Low=${regimes.low.length}, Mid=${regimes.mid.length}, High=${regimes.high.length}`);
    log('STAT', `   Vol thresholds: Low ≤ ${lowThresh.toExponential(4)}, High ≥ ${highThresh.toExponential(4)}`);

    // Test key barrier distances by regime
    const testBarriers = [1.5, 2.0, 2.5, 3.0];

    console.log('');
    console.log('   D (barrier) | Low Vol   | Mid Vol   | High Vol  | Overall');
    console.log('   -----------|----------|----------|----------|--------');

    for (const D of testBarriers) {
        const rates = {};
        for (const [regime, indices] of Object.entries(regimes)) {
            const touchCount = indices.filter(i => mfeMax[i] >= D).length;
            rates[regime] = (touchCount / indices.length * 100).toFixed(1);
        }
        const overall = (mfeMax.filter(m => m >= D).length / mfeMax.length * 100).toFixed(1);

        console.log(`   ${D.toFixed(1).padStart(10)}  | ${rates.low.padStart(7)}% | ` +
            `${rates.mid.padStart(7)}% | ${rates.high.padStart(7)}% | ${overall.padStart(6)}%`);
    }

    // Key insight: Does high-vol regime significantly increase touch rate?
    console.log('');
    const D_test = 2.0;
    const lowRate = regimes.low.filter(i => mfeMax[i] >= D_test).length / regimes.low.length;
    const highRate = regimes.high.filter(i => mfeMax[i] >= D_test).length / regimes.high.length;
    const rateRatio = highRate / Math.max(lowRate, 0.001);

    log('STAT', `  KEY INSIGHT for D=${D_test}:`);
    log('STAT', `    Touch rate in LOW vol regime:  ${(lowRate * 100).toFixed(1)}%`);
    log('STAT', `    Touch rate in HIGH vol regime: ${(highRate * 100).toFixed(1)}%`);
    log('STAT', `    Ratio (high/low): ${rateRatio.toFixed(2)}x`);

    if (rateRatio > 1.5) {
        log('STAT', `  ✅ SIGNIFICANT regime effect — volatility conditioning DOES help`);
        log('STAT', `     In high-vol periods, touch is ${rateRatio.toFixed(1)}x more likely than low-vol`);
        log('STAT', `     If Deriv prices using AVERAGE vol, we have edge in high-vol and should SKIP in low-vol`);
    } else {
        log('STAT', `  ⚠️ Weak regime effect — conditioning may not provide enough edge`);
    }

    // ─── 7. Edge Feasibility ─────────────────────────────────────
    console.log('');
    log('STAT', '── 7. Edge Feasibility Summary ──');
    log('STAT', `  Deriv house edge: ~2.4% (ONETOUCH + NOTOUCH probs sum to ~102.4%)`);
    log('STAT', `  To consistently profit, our regime-conditioned estimate must exceed`);
    log('STAT', `  Deriv's implied probability by at least ~2.4% on average.`);

    console.log('');
    log('STAT', `  For barrier D=${D_test}:`);
    log('STAT', `    Overall empirical touch rate: ${(mfeMax.filter(m => m >= D_test).length / mfeMax.length * 100).toFixed(1)}%`);
    log('STAT', `    GBM theoretical (average vol): ${(gbmTouchProb(D_test, overallSigma, TOUCH_WINDOW) * 100).toFixed(1)}%`);
    log('STAT', `    High-vol empirical: ${(highRate * 100).toFixed(1)}%`);
    log('STAT', `    If Deriv implies ~${(gbmTouchProb(D_test, overallSigma, TOUCH_WINDOW) * 100).toFixed(0)}% and our high-vol estimate is ${(highRate * 100).toFixed(0)}%,`);
    log('STAT', `    potential edge = ${((highRate - gbmTouchProb(D_test, overallSigma, TOUCH_WINDOW)) * 100).toFixed(1)}%`);

    const potentialEdge = highRate - gbmTouchProb(D_test, overallSigma, TOUCH_WINDOW);
    if (potentialEdge > 0.024) {
        log('STAT', `  ✅ POTENTIAL EDGE EXISTS — exceeds house edge of 2.4%`);
        log('STAT', `     RECOMMENDATION: Proceed to Phase 1 (Data Infrastructure)`);
    } else if (potentialEdge > 0) {
        log('STAT', `  ⚠️ MARGINAL — edge exists but may not overcome house edge after commission`);
        log('STAT', `     RECOMMENDATION: Proceed with caution, more data needed`);
    } else {
        log('STAT', `  ❌ NO CLEAR EDGE — regime conditioning doesn't sufficiently beat Deriv's pricing`);
        log('STAT', `     RECOMMENDATION: Investigate other features or strategies`);
    }
}

main();
