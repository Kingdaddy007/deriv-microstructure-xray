const fs = require('fs');

const appPath = 'client/app.js';
const dmPath = 'client/js/drawing/DrawingManager.js';

const lines = fs.readFileSync(appPath, 'utf8').split('\n');

// Lines 41 to 684 (1-indexed means index 40 to 683)
const extracted = lines.slice(40, 684);
const prefix = ['// ── Extracted DrawingManager & Chart Helpers ──'];
const dmContent = prefix.concat(extracted).join('\n');

fs.writeFileSync(dmPath, dmContent);

// Remove extracted lines from app.js
lines.splice(40, 684 - 40);

fs.writeFileSync(appPath, lines.join('\n'));

console.log(`Successfully extracted ${extracted.length} lines to ${dmPath}.`);
