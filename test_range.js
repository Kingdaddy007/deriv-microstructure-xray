const fs = require('fs');
const DerivClient = require('./server/derivClient');
const cli = new DerivClient('1HZ100V');

cli.fetchHistory(1).then(history => {
    if (history.length < 120) return;
    let maxRange = 0;
    let avgRange = 0;
    let count = 0;
    for (let i = 0; i < history.length - 120; i++) {
        let start = history[i].quote;
        let maxP = start, minP = start;
        for (let j = 1; j <= 120; j++) {
            let p = history[i + j].quote;
            if (p > maxP) maxP = p;
            if (p < minP) minP = p;
        }
        let range = Math.max(maxP - start, start - minP);
        if (range > maxRange) maxRange = range;
        avgRange += range;
        count++;
    }
    avgRange /= count;
    console.log('Max 120s reach:', maxRange.toFixed(3));
    console.log('Avg 120s reach:', avgRange.toFixed(3));
    process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
