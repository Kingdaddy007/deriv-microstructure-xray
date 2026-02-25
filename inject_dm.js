const fs = require('fs');

const appJs = fs.readFileSync('client/app.js', 'utf8');
const newDm = fs.readFileSync('DrawingManager.js', 'utf8');

// The DrawingManager block starts around line 31
const startRegex = /\/\* =+\s+DRAWING MANAGER[\s\S]*?(?=class DrawingManager)/;
const startMatch = appJs.match(startRegex);

if (!startMatch) {
    console.error("Could not find start of DrawingManager");
    process.exit(1);
}

const endRegex = /}\s*\/\* =+\s+LAZY CHART MANAGER/;
const endMatch = appJs.match(endRegex);

if (!endMatch) {
    console.error("Could not find end of DrawingManager");
    process.exit(1);
}

const startIndex = startMatch.index;
const endIndex = endMatch.index + 1; // include the '}'

const before = appJs.substring(0, startIndex);
const after = appJs.substring(endIndex);

const finalCode = before + newDm + '\n\n' + after;

fs.writeFileSync('client/app.js', finalCode);
console.log("Successfully replaced DrawingManager in app.js");
