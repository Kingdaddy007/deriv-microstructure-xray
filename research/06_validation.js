/**
 * Micro-Structure Validation Script
 * 
 * Takes the generated MFE labeled dataset and tests if our features 
 * (velocity, acceleration, compression) actually separate/improve 
 * Touch probability outcomes compared to the baseline.
 */

const Database = require('better-sqlite3');
const config = require('../server/config');

const db = new Database(config.DB_PATH, { readonly: true });

function analyzeSymbol(symbol, targetD) {
    console.log(`\n======================================================`);
    console.log(`   VALIDATION: ${symbol} at Barrier D=${targetD}`);
    console.log(`======================================================`);

    const rows = db.prepare('SELECT * FROM mfe_dataset WHERE symbol = ?').all(symbol);
    if (rows.length === 0) {
        console.log(`No data for ${symbol}`);
        return;
    }

    // 1. Establish Baseline Probability
    const total = rows.length;
    let hitsUp = 0;
    let hitsDown = 0;

    for (const r of rows) {
        if (r.mfe_up_120 >= targetD) hitsUp++;
        if (r.mfe_down_120 >= targetD) hitsDown++;
    }

    const baseUpRate = hitsUp / total;
    const baseDownRate = hitsDown / total;

    console.log(`Total Samples: ${total}`);
    console.log(`Baseline UP Touch Rate: ${(baseUpRate * 100).toFixed(2)}%`);
    console.log(`Baseline DOWN Touch Rate: ${(baseDownRate * 100).toFixed(2)}%\n`);

    // 2. Helper to analyze a single feature using quantiles (Terciles: Low/Mid/High)
    function analyzeFeature(featureName, isDirectional = false) {
        // Sort rows by feature value
        const sorted = [...rows].sort((a, b) => a[featureName] - b[featureName]);

        // Split into 3 buckets (terciles)
        const t1Limit = Math.floor(sorted.length * 0.33);
        const t2Limit = Math.floor(sorted.length * 0.66);

        const calcBucket = (bucketRows, name) => {
            let bUp = 0;
            let bDown = 0;
            for (const r of bucketRows) {
                if (r.mfe_up_120 >= targetD) bUp++;
                if (r.mfe_down_120 >= targetD) bDown++;
            }
            const upRate = bUp / bucketRows.length;
            const downRate = bDown / bucketRows.length;
            console.log(`  ${name.padEnd(8)} | UP Prob: ${(upRate * 100).toFixed(2)}% (Edge vs base: ${((upRate - baseUpRate) * 100).toFixed(2)}%) | DOWN Prob: ${(downRate * 100).toFixed(2)}% (Edge: ${((downRate - baseDownRate) * 100).toFixed(2)}%) `);
        };

        console.log(`--- Feature: ${featureName} ---`);
        calcBucket(sorted.slice(0, t1Limit), isDirectional ? 'Low/Neg' : 'Low');
        calcBucket(sorted.slice(t1Limit, t2Limit), 'Mid');
        calcBucket(sorted.slice(t2Limit), isDirectional ? 'High/Pos' : 'High');
        console.log('');
    }

    // 3. Analyze our features independently
    // Velocity is directional (negative = moving down, positive = moving up)
    analyzeFeature('vel10', true);
    analyzeFeature('vel30', true);
    analyzeFeature('vel60', true);

    // Acceleration is also directional
    analyzeFeature('accel', true);

    // Compression is absolute magnitude (Low = tight range, High = wide range)
    analyzeFeature('comp60', false);

    // 4. Combined Strategy Test: High Velocity + Low Compression (Breakout)
    console.log(`--- Combined: Top 10% Vel30 + Bottom 30% Comp60 (Breakout UP) ---`);
    // Breakout UP
    const sortedVel = [...rows].sort((a, b) => b.vel30 - a.vel30); // Descending (highest positive first)
    const top10Vel = sortedVel.slice(0, Math.floor(total * 0.1));
    // Sort top 10% vel by compression (ascending)
    const sortedComp = top10Vel.sort((a, b) => a.comp60 - b.comp60);
    const breakoutUpSet = sortedComp.slice(0, Math.floor(top10Vel.length * 0.3));

    let bUpHits = 0;
    for (const r of breakoutUpSet) { if (r.mfe_up_120 >= targetD) bUpHits++; }
    if (breakoutUpSet.length > 0) {
        const p = bUpHits / breakoutUpSet.length;
        console.log(`  Hits: ${bUpHits}/${breakoutUpSet.length} | UP Prob: ${(p * 100).toFixed(2)}% | Edge vs base: ${((p - baseUpRate) * 100).toFixed(2)}%`);
    } else {
        console.log('  Not enough samples for this combination.');
    }

    // Breakout DOWN
    console.log(`\n--- Combined: Bottom 10% Vel30 + Bottom 30% Comp60 (Breakout DOWN) ---`);
    const sortedVelDown = [...rows].sort((a, b) => a.vel30 - b.vel30); // Ascending (lowest negative first)
    const bot10Vel = sortedVelDown.slice(0, Math.floor(total * 0.1));
    const sortedCompDown = bot10Vel.sort((a, b) => a.comp60 - b.comp60);
    const breakoutDownSet = sortedCompDown.slice(0, Math.floor(bot10Vel.length * 0.3));

    let bDownHits = 0;
    for (const r of breakoutDownSet) { if (r.mfe_down_120 >= targetD) bDownHits++; }
    if (breakoutDownSet.length > 0) {
        const p = bDownHits / breakoutDownSet.length;
        console.log(`  Hits: ${bDownHits}/${breakoutDownSet.length} | DOWN Prob: ${(p * 100).toFixed(2)}% | Edge vs base: ${((p - baseDownRate) * 100).toFixed(2)}%`);
    }
}

analyzeSymbol(config.SYMBOLS.V100_1S, 2.0);
console.log('');
analyzeSymbol(config.SYMBOLS.V100_1S, 4.0);

db.close();
