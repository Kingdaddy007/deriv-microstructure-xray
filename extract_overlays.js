const fs = require('fs');

const appPath = 'client/app.js';
const tbPath = 'client/js/overlays/TimeBlockOverlay.js';
const liqPath = 'client/js/overlays/LiquidityEqOverlay.js';

const lines = fs.readFileSync(appPath, 'utf8').split('\n');

// 1. TimeBlockOverlay: lines 41 to 546 (index 40 to 545 = 506 lines)
const tbLines = lines.slice(40, 546);
fs.writeFileSync(tbPath, tbLines.join('\n'));

// 2. LiquidityEqOverlay: lines 549 to 982 (index 548 to 981 = 434 lines)
const liqLines = lines.slice(548, 982);
fs.writeFileSync(liqPath, liqLines.join('\n'));

// Remove all of it from app.js (lines 41 to 984 => index 40 to 983 = 944 lines)
// Note: line 984 is empty, 985 is LAZY CHART MANAGER comment
lines.splice(40, 944);

fs.writeFileSync(appPath, lines.join('\n'));

console.log(`Successfully extracted overlays.`);
