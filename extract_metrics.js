const fs = require('fs');

const appPath = 'client/app.js';
const enginePath = 'client/js/engines/SimpleMetricsEngine.js';

let lines = fs.readFileSync(appPath, 'utf8').split('\n');

// We need to extract:
// 1. Lines 224-229 (Simple Mode Sidebar State)
// 2. Lines 894-1014 (processSimpleMetrics)

// Let's locate them by matching their content (more robust than exact line numbers which might shift slightly)
let stateStart = lines.findIndex(l => l.includes('Simple Mode Sidebar State'));
let stateEnd = stateStart + 5; // The 5 lines of state

let metricsStart = lines.findIndex(l => l.includes('function processSimpleMetrics()')) - 1; // -1 for the comment
let metricsEnd = lines.findIndex((l, i) => i > metricsStart && l === '}') + 13;
// We know it ends with the switch statement for UI Update. Let's find it exactly:
for (let i = metricsStart; i < lines.length; i++) {
    if (lines[i] === '}' && lines[i - 1] === '    }') {
        // Find the outer closing brace of function processSimpleMetrics()
        // Wait, looking at lines 1000-1014:
        // 1012:         }
        // 1013:     }
        // 1014: }
        if (lines[i] === '}' && lines[i - 1] === '    }' && lines[i - 2] === '        }') {
            metricsEnd = i + 1;
            break;
        }
    }
}
// fallback exact finder
metricsEnd = lines.findIndex(l => l.includes('// ── Controls')) - 1;

let fileContent = [];
fileContent.push('/* ================================================================');
fileContent.push('   SIMPLE METRICS ENGINE');
fileContent.push('   ================================================================ */');
fileContent.push('');
fileContent.push(lines.slice(stateStart, stateEnd + 1).join('\n'));
fileContent.push('');
fileContent.push(lines.slice(metricsStart, metricsEnd).join('\n'));

fs.writeFileSync(enginePath, fileContent.join('\n'));

// Remove from app.js (bottom up to preserve indices)
lines.splice(metricsStart, metricsEnd - metricsStart);
lines.splice(stateStart, (stateEnd + 1) - stateStart);

fs.writeFileSync(appPath, lines.join('\n'));
console.log('Metrics engine extracted.');
