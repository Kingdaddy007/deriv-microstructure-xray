/**
 * Robust Historical Downloader
 * 
 * Downloads 5 days of historical ticks for V75(1s) and V100(1s).
 * Avoids timeouts by managing the WebSocket promises and handling rate limits cleanly.
 */

const WebSocket = require('ws');
const Database = require('better-sqlite3');
const config = require('../server/config');
const fs = require('fs');

if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

// Set up SQLite
const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS ticks (symbol TEXT NOT NULL, epoch INTEGER NOT NULL, quote REAL NOT NULL, PRIMARY KEY (symbol, epoch))');
db.exec('CREATE INDEX IF NOT EXISTS idx_ticks_symbol_epoch ON ticks(symbol, epoch)');
db.exec('CREATE INDEX IF NOT EXISTS idx_ticks_epoch ON ticks(epoch)');

const insertTick = db.prepare('INSERT OR IGNORE INTO ticks (symbol, epoch, quote) VALUES (?, ?, ?)');
const insertMany = db.transaction((arr) => {
    for (const t of arr) insertTick.run(t.s, t.e, t.q);
});

const CHUNK_SIZE = 5000;
const DAYS_TO_DOWNLOAD = 1;
const SECONDS_PER_DAY = 86400;
const nowEpoch = Math.floor(Date.now() / 1000);
const targetEpoch = nowEpoch - (DAYS_TO_DOWNLOAD * SECONDS_PER_DAY);

const symbols = [config.SYMBOLS.V75_1S, config.SYMBOLS.V100_1S];

async function downloadSymbol(ws, symbol) {
    console.log(`\n=== Downloading ${DAYS_TO_DOWNLOAD} days of ${symbol} ===`);
    console.log(`Target oldest date: ${new Date(targetEpoch * 1000).toISOString()}`);

    let endEpoch = nowEpoch;
    let totalDownloaded = 0;
    let reqId = 0;

    while (endEpoch > targetEpoch) {
        reqId++;
        const payload = {
            ticks_history: symbol,
            end: endEpoch,
            count: CHUNK_SIZE,
            style: 'ticks',
            req_id: reqId
        };

        try {
            const response = await sendAndReceive(ws, payload);

            if (response.error) {
                console.error(`API Error: ${response.error.message}`);
                break;
            }

            if (!response.history || !response.history.prices || response.history.prices.length === 0) {
                console.log(`No more data returned from Deriv for ${symbol}.`);
                break;
            }

            const h = response.history;
            const batch = [];
            for (let i = 0; i < h.prices.length; i++) {
                batch.push({ s: symbol, e: h.times[i], q: h.prices[i] });
            }

            insertMany(batch);
            totalDownloaded += batch.length;

            const oldestEpoch = h.times[0];
            const daysBack = (nowEpoch - oldestEpoch) / SECONDS_PER_DAY;

            if (reqId % 10 === 0) {
                console.log(`[Req ${reqId}] Stored ${totalDownloaded} total. Currently at ${daysBack.toFixed(2)} days back (${new Date(oldestEpoch * 1000).toISOString()}).`);
            }

            // Loop prevention: if the returned oldest epoch is newer than or very close to our requested end epoch,
            // it means the API hit its history limit and wrapped around to the present.
            if (oldestEpoch >= endEpoch - 100) {
                console.log(`Deriv API hit history limit and looped back to present. Stopping download for ${symbol}.`);
                break;
            }

            if (oldestEpoch <= targetEpoch) {
                console.log(`Reached target date of ${DAYS_TO_DOWNLOAD} days back.`);
                break;
            }

            // Prepare next request window (shift backwards)
            endEpoch = oldestEpoch - 1;

            // Rate limiting: sleep between requests
            await sleep(350);

        } catch (err) {
            console.error(`Request timeout or error: ${err.message}. Retrying in 2 seconds...`);
            await sleep(2000);
            // We don't advance endEpoch, so it will retry the same window
        }
    }

    const stats = db.prepare('SELECT COUNT(*) as count, MIN(epoch) as minE, MAX(epoch) as maxE FROM ticks WHERE symbol = ?').get(symbol);
    console.log(`\nDONE ${symbol}:`);
    console.log(`Total ticks in DB: ${stats.count}`);
    console.log(`Date range: ${new Date(stats.minE * 1000).toISOString()} to ${new Date(stats.maxE * 1000).toISOString()}`);
}

function sendAndReceive(ws, payload, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        console.log('Sending: ', payload);
        const timer = setTimeout(() => {
            ws.removeListener('message', messageHandler);
            reject(new Error(`Timeout on req_id ${payload.req_id}`));
        }, timeoutMs);

        const messageHandler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                // Only resolve if it matches our req_id, or if there's an error not tied to req_id
                if (msg.req_id === payload.req_id || msg.error) {
                    clearTimeout(timer);
                    ws.removeListener('message', messageHandler);
                    resolve(msg);
                }
            } catch (e) {
                // Ignore JSON parse errors here
            }
        };

        ws.on('message', messageHandler);
        ws.send(JSON.stringify(payload));
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const ws = new WebSocket(`${config.DERIV_WS_URL}?app_id=${config.DERIV_APP_ID}`);

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    console.log('Connected to Deriv API.');

    for (const sym of symbols) {
        await downloadSymbol(ws, sym);
    }

    ws.close();
    db.close();
    console.log('\nAll downloads complete.');
    process.exit(0);
}

main().catch(console.error);
