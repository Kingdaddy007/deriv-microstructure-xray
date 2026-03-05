const fs = require('fs');

const appPath = 'client/app.js';
const helpersPath = 'client/js/utils/ChartHelpers.js';

let lines = fs.readFileSync(appPath, 'utf8').split('\n');

// We extract:
// lines 14 to 29 (index 13 to 28) exactly.
// 13: const $ = id => document.getElementById(id);
// ...
// 28: const CANDLE_OPTS = { ... }

let startIdx = 13;
let endIdx = 28;

let fileContent = [];
fileContent.push('/* ================================================================');
fileContent.push('   CHART HELPERS & UI UTILS');
fileContent.push('   ================================================================ */');
fileContent.push('');
fileContent.push(lines.slice(startIdx, endIdx + 1).join('\n'));

// Add the 'pct' helper from line 892 (which we will grep or find)
let pctIdx = lines.findIndex(l => l.includes('function pct(v) {'));
if (pctIdx !== -1) {
    fileContent.push('');
    fileContent.push(lines[pctIdx]);
    lines.splice(pctIdx, 1); // remove from app.js
}

fs.writeFileSync(helpersPath, fileContent.join('\n'));

// Remove lines from app.js
lines.splice(startIdx, (endIdx + 1) - startIdx);

fs.writeFileSync(appPath, lines.join('\n'));
console.log('ChartHelpers extracted.');
