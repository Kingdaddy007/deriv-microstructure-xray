const fs = require('fs');
const DerivClient = require('./server/derivClient');
const { computeReachGrid } = require('./server/reachGridEngine');
const cli = new DerivClient('1HZ100V');

cli.fetchHistory(3).then(history => {
    console.log(`Fetched ${history.length} ticks`);
    if (history.length < 120) return;

    console.log("=== 10 MINUTE LOOKBACK (600s) ===");
    let res10 = computeReachGrid(history, { lookbackSec: 600, stride: 10 });
    console.log("UP mode:");
    res10.matrix.forEach(row => console.log(row.map(c => Math.round(c.up * 100) + '%').join('\t')));
    console.log("DOWN mode:");
    res10.matrix.forEach(row => console.log(row.map(c => Math.round(c.down * 100) + '%').join('\t')));

    console.log("\n=== 30 MINUTE LOOKBACK (1800s) ===");
    let res30 = computeReachGrid(history, { lookbackSec: 1800, stride: 10 });
    console.log("UP mode:");
    res30.matrix.forEach(row => console.log(row.map(c => Math.round(c.up * 100) + '%').join('\t')));
    console.log("DOWN mode:");
    res30.matrix.forEach(row => console.log(row.map(c => Math.round(c.down * 100) + '%').join('\t')));

    process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
