const fs = require('fs');
const content = fs.readFileSync('client/app.js', 'utf8');

// The DrawingManager block starts around line 305 and ends before "TOOLBAR WIRING"
const dmRegex = /\/\* =+\s+DRAWING MANAGER[\s\S]*?(?=\/\* =+\s+TOOLBAR WIRING)/;
const dmMatch = content.match(dmRegex);

if (!dmMatch) {
    console.error("Could not find DrawingManager block.");
    process.exit(1);
}

const drawingManagerCode = dmMatch[0];

// Remove the DrawingManager from its original location
let newContent = content.replace(drawingManagerCode, '');

// The Lazy Chart Manager block starts around line 33
const chartManagerRegex = /(\/\* =+\s+LAZY CHART MANAGER)/;
const chartManagerMatch = newContent.match(chartManagerRegex);

if (!chartManagerMatch) {
    console.error("Could not find ChartSlot block.");
    process.exit(1);
}

// Insert DrawingManager right before ChartSlot
newContent = newContent.replace(
    chartManagerMatch[1],
    drawingManagerCode + '\n' + chartManagerMatch[1]
);

fs.writeFileSync('client/app.js', newContent);
console.log("Successfully reordered classes in app.js");
