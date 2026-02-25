/**
 * Phase 0 — Script 02: Download 7 Days of Historical Ticks
 * 
 * PURPOSE:
 *   Download a complete 7-day tick history for both V75 and V100 (1s),
 *   stored in SQLite for statistical analysis and MFE computation.
 *
 * HOW IT WORKS:
 *   1. Connects to Deriv WebSocket API
 *   2. For each symbol, requests ticks in backward-paginated chunks of 5000
 *   3. Continues until we have 7 days of data
 *   4. Deduplicates by (symbol, epoch) primary key
 *   5. Reports download progress and final statistics
 *
 * RUN:
 *   node research/02_download_history.js
 *
 * ESTIMATED TIME:
 *   ~604,800 ticks per symbol (7 days × 86,400 seconds/day)
 *   At 5000 ticks/request → ~121 requests per symbol
 *   With rate limiting → approximately 5-10 minutes per symbol
 */

const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../server/config');

// ─── Settings ──────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 5000;          // Ticks per API request (max seems to be 5000)
const REQUEST_DELAY_MS = 500;     // Delay between requests to avoid rate limiting
const HISTORY_DAYS = config.HISTORY_DAYS; // 7 days

// ─── Logging ───────────────────────────────────────────────────────────────────
function log(category, message) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${category}] ${message}`);
}

// ─── Database Setup ────────────────────────────────────────────────────────────
function initDatabase() {
    const dataDir = config.DATA_DIR;
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
    CREATE TABLE IF NOT EXISTS ticks (
      symbol TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      quote REAL NOT NULL,
      PRIMARY KEY (symbol, epoch)
    )
  `);

    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ticks_symbol_epoch ON ticks(symbol, epoch)
  `);

    log('DB', `Database at ${config.DB_PATH}`);
    return db;
}

// ─── WebSocket Connection ──────────────────────────────────────────────────────
function connectToDerivAPI() {
    return new Promise((resolve, reject) => {
        const url = `${config.DERIV_WS_URL}?app_id=${config.DERIV_APP_ID}`;
        log('WS', `Connecting to ${url}`);

        const ws = new WebSocket(url);

        ws.on('open', () => {
            log('WS', '✅ Connected');
            resolve(ws);
        });

        ws.on('error', (err) => {
            log('WS', `❌ Error: ${err.message}`);
            reject(err);
        });

        // Keep alive with pings
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ ping: 1 }));
            }
        }, 30000);

        ws.on('close', () => {
            clearInterval(pingInterval);
        });
    });
}

// ─── Send/Receive with timeout ─────────────────────────────────────────────────
function sendAndReceive(ws, payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout for request`));
        }, timeoutMs);

        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                // Match by req_id if present, or by msg_type
                if (msg.req_id === payload.req_id || msg.msg_type === 'history') {
                    clearTimeout(timer);
                    ws.removeListener('message', handler);
                    resolve(msg);
                }
            } catch (e) {
                // ignore
            }
        };

        ws.on('message', handler);
        ws.send(JSON.stringify(payload));
    });
}

// ─── Utility: sleep ────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Download ticks for one symbol ─────────────────────────────────────────────
async function downloadSymbolHistory(ws, db, symbol) {
    const insertTick = db.prepare(
        'INSERT OR IGNORE INTO ticks (symbol, epoch, quote) VALUES (?, ?, ?)'
    );

    const insertMany = db.transaction((ticks) => {
        for (const t of ticks) {
            insertTick.run(t.symbol, t.epoch, t.quote);
        }
    });

    const nowEpoch = Math.floor(Date.now() / 1000);
    const targetEpoch = nowEpoch - (HISTORY_DAYS * 86400);

    let endEpoch = nowEpoch;
    let totalDownloaded = 0;
    let requestCount = 0;
    let consecutiveErrors = 0;

    log('DL', `Downloading ${HISTORY_DAYS} days of ${symbol} ticks...`);
    log('DL', `Target: epoch ${targetEpoch} (${new Date(targetEpoch * 1000).toISOString()})`);

    while (endEpoch > targetEpoch) {
        requestCount++;

        try {
            const response = await sendAndReceive(ws, {
                ticks_history: symbol,
                end: endEpoch,
                count: CHUNK_SIZE,
                style: 'ticks',
                req_id: requestCount,
            }, 30000);

            if (response.error) {
                log('DL', `❌ Error at request ${requestCount}: ${JSON.stringify(response.error)}`);
                consecutiveErrors++;
                if (consecutiveErrors >= 3) {
                    log('DL', 'Too many consecutive errors, stopping');
                    break;
                }
                await sleep(2000);
                continue;
            }

            consecutiveErrors = 0;
            const history = response.history;

            if (!history || !history.prices || history.prices.length === 0) {
                log('DL', 'No more data available');
                break;
            }

            // Store ticks
            const ticks = [];
            for (let i = 0; i < history.prices.length; i++) {
                ticks.push({
                    symbol,
                    epoch: history.times[i],
                    quote: history.prices[i],
                });
            }
            insertMany(ticks);
            totalDownloaded += ticks.length;

            // Move end cursor back
            const oldestInChunk = history.times[0];

            // Progress report
            const daysBack = (nowEpoch - oldestInChunk) / 86400;
            const progress = Math.min(100, (daysBack / HISTORY_DAYS) * 100);

            if (requestCount % 10 === 0 || history.prices.length < CHUNK_SIZE) {
                log('DL', `Request ${requestCount}: ${totalDownloaded} ticks total, ${daysBack.toFixed(1)} days back (${progress.toFixed(0)}%)`);
            }

            // Check if we've gone far enough back
            if (oldestInChunk <= targetEpoch) {
                log('DL', `✅ Reached target date`);
                break;
            }

            // Set next request to end before the oldest tick we received
            endEpoch = oldestInChunk - 1;

            // Rate limiting
            await sleep(REQUEST_DELAY_MS);

        } catch (err) {
            log('DL', `❌ Request ${requestCount} failed: ${err.message}`);
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
                log('DL', 'Too many consecutive errors, stopping');
                break;
            }
            await sleep(2000);
        }
    }

    // Summary
    const dbStats = db.prepare(
        'SELECT COUNT(*) as cnt, MIN(epoch) as earliest, MAX(epoch) as latest FROM ticks WHERE symbol = ?'
    ).get(symbol);

    const days = ((dbStats.latest - dbStats.earliest) / 86400).toFixed(2);
    log('DL', `─── ${symbol} Download Complete ───`);
    log('DL', `  Total ticks in DB: ${dbStats.cnt}`);
    log('DL', `  Date range: ${new Date(dbStats.earliest * 1000).toISOString()} → ${new Date(dbStats.latest * 1000).toISOString()}`);
    log('DL', `  Span: ${days} days`);
    log('DL', `  Requests made: ${requestCount}`);

    return dbStats;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   PHASE 0 — HISTORICAL TICK DOWNLOAD (7 DAYS)          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    const db = initDatabase();

    // Check if we already have data
    const existing = db.prepare(
        'SELECT symbol, COUNT(*) as cnt FROM ticks GROUP BY symbol'
    ).all();
    if (existing.length > 0) {
        log('DB', 'Existing data in database:');
        for (const row of existing) {
            log('DB', `  ${row.symbol}: ${row.cnt} ticks`);
        }
        log('DB', 'New data will be merged (deduplicated by epoch)');
    }

    let ws;
    try {
        ws = await connectToDerivAPI();
    } catch (err) {
        log('FATAL', `Cannot connect: ${err.message}`);
        process.exit(1);
    }

    // Download both symbols
    const symbols = [config.SYMBOLS.V75_1S, config.SYMBOLS.V100_1S];
    for (const symbol of symbols) {
        await downloadSymbolHistory(ws, db, symbol);
        await sleep(1000); // Brief pause between symbols
    }

    // Final database stats
    console.log('');
    log('DONE', '─── Final Database Summary ───');
    const finalStats = db.prepare(
        'SELECT symbol, COUNT(*) as cnt, MIN(epoch) as earliest, MAX(epoch) as latest FROM ticks GROUP BY symbol'
    ).all();
    for (const row of finalStats) {
        const days = ((row.latest - row.earliest) / 86400).toFixed(2);
        log('DONE', `${row.symbol}: ${row.cnt} ticks spanning ${days} days`);
    }

    const totalTicks = finalStats.reduce((sum, r) => sum + r.cnt, 0);
    log('DONE', `Total: ${totalTicks} ticks`);
    log('DONE', `Database: ${config.DB_PATH}`);

    ws.close();
    db.close();
}

process.on('SIGINT', () => {
    log('EXIT', 'Interrupted. Data saved so far is persisted in SQLite.');
    process.exit(0);
});

main().catch(err => {
    log('FATAL', err.message);
    console.error(err);
    process.exit(1);
});
