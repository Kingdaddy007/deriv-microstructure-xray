/**
 * Phase 0 — Research Script: API Connection & Data Collection
 * 
 * PURPOSE:
 *   Test the Deriv WebSocket API, understand data formats, measure tick
 *   arrival rate, download historical ticks, and collect sample data for
 *   statistical analysis.
 * 
 * WHAT THIS SCRIPT DOES:
 *   1. Connects to Deriv WebSocket API (no auth needed for tick streaming)
 *   2. Subscribes to 1HZ75V and 1HZ100V tick streams
 *   3. Logs every tick to console + SQLite database
 *   4. Measures tick arrival rate and reports statistics
 *   5. Downloads historical ticks (as many as the API allows)
 *   6. Tests the 'proposal' endpoint to see if we can get Touch contract payouts
 * 
 * RUN:
 *   node research/01_api_exploration.js
 * 
 * DURATION:
 *   Runs for 5 minutes of live tick collection, then proceeds to historical
 *   download and proposal tests. You can let it run longer by changing LIVE_COLLECTION_MINUTES.
 */

const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../server/config');

// ─── Settings ──────────────────────────────────────────────────────────────────
const LIVE_COLLECTION_MINUTES = 5;
const SYMBOLS_TO_TEST = [config.SYMBOLS.V75_1S, config.SYMBOLS.V100_1S];
const HISTORY_TICKS_TO_REQUEST = 5000; // Max per request (we'll test the limit)

// ─── State ─────────────────────────────────────────────────────────────────────
const ticksBySymbol = {};   // { symbol: [{ epoch, quote, arrivalTime }] }
const tickIntervals = {};   // { symbol: [intervalMs between consecutive ticks] }
let ws = null;
let db = null;

// ─── Database Setup ────────────────────────────────────────────────────────────
function initDatabase() {
    const dataDir = config.DATA_DIR;
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'research.db');
    db = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');

    db.exec(`
    CREATE TABLE IF NOT EXISTS ticks (
      symbol TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      quote REAL NOT NULL,
      source TEXT DEFAULT 'live',
      PRIMARY KEY (symbol, epoch)
    )
  `);

    db.exec(`
    CREATE TABLE IF NOT EXISTS api_tests (
      test_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      request_json TEXT,
      response_json TEXT,
      success INTEGER,
      notes TEXT
    )
  `);

    console.log(`[DB] Database initialized at ${dbPath}`);
    return db;
}

// ─── Logging ───────────────────────────────────────────────────────────────────
function log(category, message) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${category}] ${message}`);
}

// ─── WebSocket Connection ──────────────────────────────────────────────────────
function connectToDerivAPI() {
    return new Promise((resolve, reject) => {
        const url = `${config.DERIV_WS_URL}?app_id=${config.DERIV_APP_ID}`;
        log('WS', `Connecting to ${url}`);

        ws = new WebSocket(url);

        ws.on('open', () => {
            log('WS', '✅ Connected to Deriv WebSocket API');
            resolve(ws);
        });

        ws.on('error', (err) => {
            log('WS', `❌ WebSocket error: ${err.message}`);
            reject(err);
        });

        ws.on('close', (code, reason) => {
            log('WS', `Connection closed. Code: ${code}, Reason: ${reason}`);
        });
    });
}

// ─── Send a WebSocket message and wait for response ────────────────────────────
function sendAndReceive(ws, payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for response to ${JSON.stringify(payload).substring(0, 100)}`));
        }, timeoutMs);

        // One-time listener for the response
        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                // Check if this response matches our request type
                if (msg.msg_type === payload.msg_type ||
                    msg.error ||
                    (payload.ticks_history && msg.msg_type === 'history') ||
                    (payload.ticks && msg.msg_type === 'tick') ||
                    (payload.proposal && msg.msg_type === 'proposal') ||
                    (payload.active_symbols && msg.msg_type === 'active_symbols')) {
                    clearTimeout(timer);
                    ws.removeListener('message', handler);
                    resolve(msg);
                }
            } catch (e) {
                // Not JSON, ignore
            }
        };

        ws.on('message', handler);
        ws.send(JSON.stringify(payload));
    });
}

// ─── Test 1: Active Symbols (verify our symbols exist) ─────────────────────────
async function testActiveSymbols(ws) {
    log('TEST', '── Test 1: Active Symbols ──');
    const request = { active_symbols: 'brief', product_type: 'basic' };

    try {
        const response = await sendAndReceive(ws, request, 15000);

        if (response.error) {
            log('TEST', `❌ Error: ${JSON.stringify(response.error)}`);
            return;
        }

        const symbols = response.active_symbols || [];
        log('TEST', `Total active symbols: ${symbols.length}`);

        // Find our target symbols
        for (const targetSymbol of SYMBOLS_TO_TEST) {
            const found = symbols.find(s => s.symbol === targetSymbol);
            if (found) {
                log('TEST', `✅ ${targetSymbol} found:`);
                log('TEST', `   Display name: ${found.display_name}`);
                log('TEST', `   Market: ${found.market}`);
                log('TEST', `   Submarket: ${found.submarket}`);
                log('TEST', `   Pip: ${found.pip}`);
                log('TEST', `   Spot: ${found.spot}`);
                log('TEST', `   Is trading suspended: ${found.is_trading_suspended}`);
            } else {
                log('TEST', `❌ ${targetSymbol} NOT found in active symbols!`);
            }
        }

        // Save test result
        db.prepare(`INSERT INTO api_tests VALUES (?, ?, ?, ?, ?, ?)`)
            .run('active_symbols', new Date().toISOString(), JSON.stringify(request),
                JSON.stringify({ count: symbols.length, found: SYMBOLS_TO_TEST.map(s => !!symbols.find(x => x.symbol === s)) }),
                1, 'Checked if target symbols exist');

    } catch (err) {
        log('TEST', `❌ Active symbols test failed: ${err.message}`);
    }
}

// ─── Test 2: Live Tick Streaming ───────────────────────────────────────────────
async function testLiveTickStreaming(ws) {
    log('TEST', `── Test 2: Live Tick Streaming (${LIVE_COLLECTION_MINUTES} min) ──`);

    const insertTick = db.prepare('INSERT OR IGNORE INTO ticks (symbol, epoch, quote, source) VALUES (?, ?, ?, ?)');

    for (const symbol of SYMBOLS_TO_TEST) {
        ticksBySymbol[symbol] = [];
        tickIntervals[symbol] = [];
    }

    return new Promise((resolve) => {
        let tickCount = 0;
        const startTime = Date.now();
        const endTime = startTime + (LIVE_COLLECTION_MINUTES * 60 * 1000);

        const tickHandler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.msg_type === 'tick' && msg.tick) {
                    const tick = msg.tick;
                    const arrivalTime = Date.now();

                    // Store tick
                    const symbolTicks = ticksBySymbol[tick.symbol];
                    if (symbolTicks) {
                        // Calculate interval since last tick
                        if (symbolTicks.length > 0) {
                            const lastTick = symbolTicks[symbolTicks.length - 1];
                            const interval = tick.epoch - lastTick.epoch; // seconds
                            tickIntervals[tick.symbol].push(interval);
                        }

                        symbolTicks.push({
                            epoch: tick.epoch,
                            quote: tick.quote,
                            arrivalTime,
                        });

                        // Save to database
                        insertTick.run(tick.symbol, tick.epoch, tick.quote, 'live');

                        tickCount++;
                        if (tickCount % 50 === 0) {
                            const elapsed = Math.round((Date.now() - startTime) / 1000);
                            log('TICK', `Collected ${tickCount} ticks (${elapsed}s elapsed)`);
                        }
                    }
                }
            } catch (e) {
                // ignore parse errors
            }
        };

        ws.on('message', tickHandler);

        // Subscribe to tick streams
        for (const symbol of SYMBOLS_TO_TEST) {
            ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
            log('TICK', `Subscribed to ${symbol} tick stream`);
        }

        // Check if time is up every 5 seconds
        const checker = setInterval(() => {
            if (Date.now() >= endTime) {
                clearInterval(checker);
                ws.removeListener('message', tickHandler);

                // Unsubscribe
                ws.send(JSON.stringify({ forget_all: 'ticks' }));

                // Report results
                log('TEST', '── Tick Collection Results ──');
                for (const symbol of SYMBOLS_TO_TEST) {
                    const ticks = ticksBySymbol[symbol];
                    const intervals = tickIntervals[symbol];
                    log('TEST', `${symbol}:`);
                    log('TEST', `  Total ticks collected: ${ticks.length}`);

                    if (intervals.length > 0) {
                        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                        const minInterval = Math.min(...intervals);
                        const maxInterval = Math.max(...intervals);

                        log('TEST', `  Avg tick interval: ${avgInterval.toFixed(3)}s`);
                        log('TEST', `  Min interval: ${minInterval}s`);
                        log('TEST', `  Max interval: ${maxInterval}s`);
                        log('TEST', `  Expected 1s intervals: ${intervals.filter(i => i === 1).length}/${intervals.length} (${(intervals.filter(i => i === 1).length / intervals.length * 100).toFixed(1)}%)`);

                        // Check for gaps
                        const gaps = intervals.filter(i => i > 2);
                        if (gaps.length > 0) {
                            log('TEST', `  ⚠️ Gaps > 2s: ${gaps.length} occurrences (intervals: ${gaps.join(', ')}s)`);
                        } else {
                            log('TEST', `  ✅ No gaps > 2s detected`);
                        }
                    }

                    if (ticks.length > 0) {
                        log('TEST', `  Price range: ${Math.min(...ticks.map(t => t.quote)).toFixed(2)} - ${Math.max(...ticks.map(t => t.quote)).toFixed(2)}`);
                        log('TEST', `  First tick: epoch=${ticks[0].epoch}, quote=${ticks[0].quote}`);
                        log('TEST', `  Last tick: epoch=${ticks[ticks.length - 1].epoch}, quote=${ticks[ticks.length - 1].quote}`);

                        // Compute basic tick return stats
                        const returns = [];
                        for (let i = 1; i < ticks.length; i++) {
                            returns.push(Math.log(ticks[i].quote / ticks[i - 1].quote));
                        }

                        if (returns.length > 0) {
                            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                            const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
                            const stdev = Math.sqrt(variance);
                            const skewness = returns.reduce((a, r) => a + ((r - mean) / stdev) ** 3, 0) / returns.length;
                            const kurtosis = returns.reduce((a, r) => a + ((r - mean) / stdev) ** 4, 0) / returns.length;

                            log('TEST', `  Log return stats (${returns.length} returns):`);
                            log('TEST', `    Mean: ${mean.toExponential(4)}`);
                            log('TEST', `    StDev: ${stdev.toExponential(4)}`);
                            log('TEST', `    Skewness: ${skewness.toFixed(4)} (0 = symmetric)`);
                            log('TEST', `    Kurtosis: ${kurtosis.toFixed(4)} (3 = normal)`);
                            log('TEST', `    ${kurtosis > 3 ? '⚠️ Fat tails detected (kurtosis > 3)' : '✅ Near-normal tails'}`);
                        }
                    }
                }

                // Save test summary
                db.prepare(`INSERT INTO api_tests VALUES (?, ?, ?, ?, ?, ?)`)
                    .run('live_tick_streaming', new Date().toISOString(),
                        JSON.stringify({ symbols: SYMBOLS_TO_TEST, minutes: LIVE_COLLECTION_MINUTES }),
                        JSON.stringify(Object.fromEntries(SYMBOLS_TO_TEST.map(s => [s, { count: ticksBySymbol[s].length }]))),
                        1, 'Live tick collection test');

                resolve();
            }
        }, 5000);
    });
}

// ─── Test 3: Historical Tick Download ──────────────────────────────────────────
async function testHistoricalDownload(ws) {
    log('TEST', '── Test 3: Historical Tick Download ──');

    const insertTick = db.prepare('INSERT OR IGNORE INTO ticks (symbol, epoch, quote, source) VALUES (?, ?, ?, ?)');

    for (const symbol of SYMBOLS_TO_TEST) {
        log('TEST', `Testing history download for ${symbol}...`);

        // Request 1: Get latest ticks
        const request1 = {
            ticks_history: symbol,
            end: 'latest',
            count: HISTORY_TICKS_TO_REQUEST,
            style: 'ticks',
        };

        try {
            const response = await sendAndReceive(ws, { ...request1, req_id: 100 }, 30000);

            if (response.error) {
                log('TEST', `❌ History error for ${symbol}: ${JSON.stringify(response.error)}`);
                continue;
            }

            const history = response.history;
            if (history && history.prices && history.times) {
                log('TEST', `✅ ${symbol} history received:`);
                log('TEST', `   Prices count: ${history.prices.length}`);
                log('TEST', `   Times count: ${history.times.length}`);

                if (history.times.length > 0) {
                    const firstEpoch = history.times[0];
                    const lastEpoch = history.times[history.times.length - 1];
                    const span = lastEpoch - firstEpoch;
                    const firstDate = new Date(firstEpoch * 1000).toISOString();
                    const lastDate = new Date(lastEpoch * 1000).toISOString();

                    log('TEST', `   Time range: ${firstDate} → ${lastDate}`);
                    log('TEST', `   Span: ${(span / 3600).toFixed(1)} hours (${(span / 86400).toFixed(1)} days)`);
                    log('TEST', `   Avg interval: ${(span / history.times.length).toFixed(3)}s`);

                    // Save to database
                    const insertMany = db.transaction((prices, times) => {
                        for (let i = 0; i < prices.length; i++) {
                            insertTick.run(symbol, times[i], prices[i], 'history');
                        }
                    });
                    insertMany(history.prices, history.times);
                    log('TEST', `   Saved ${history.prices.length} ticks to database`);
                }
            }

            // Request 2: Try to get older data (test pagination)
            if (history && history.times && history.times.length > 0) {
                const oldestEpoch = history.times[0];
                const request2 = {
                    ticks_history: symbol,
                    end: oldestEpoch,
                    count: 1000,
                    style: 'ticks',
                };

                log('TEST', `   Testing pagination (requesting before epoch ${oldestEpoch})...`);
                const response2 = await sendAndReceive(ws, { ...request2, req_id: 101 }, 30000);

                if (response2.error) {
                    log('TEST', `   ❌ Pagination error: ${JSON.stringify(response2.error)}`);
                } else if (response2.history) {
                    log('TEST', `   ✅ Pagination works! Got ${response2.history.prices.length} more ticks`);
                    const paginatedFirst = new Date(response2.history.times[0] * 1000).toISOString();
                    log('TEST', `   Goes back to: ${paginatedFirst}`);
                }
            }

        } catch (err) {
            log('TEST', `❌ History test failed for ${symbol}: ${err.message}`);
        }
    }

    // Count total ticks in DB
    const total = db.prepare('SELECT symbol, COUNT(*) as cnt, MIN(epoch) as earliest, MAX(epoch) as latest FROM ticks GROUP BY symbol').all();
    log('TEST', '── Database Summary ──');
    for (const row of total) {
        const days = ((row.latest - row.earliest) / 86400).toFixed(2);
        log('TEST', `${row.symbol}: ${row.cnt} ticks spanning ${days} days`);
    }
}

// ─── Test 4: Touch Contract Proposal (Payout Fetching) ────────────────────────
async function testProposalEndpoint(ws) {
    log('TEST', '── Test 4: Touch Contract Proposal ──');
    log('TEST', 'Testing if we can fetch Touch contract payouts via API...');

    const symbol = SYMBOLS_TO_TEST[0]; // Test with first symbol

    // Attempt a Touch proposal (no trade execution, just pricing)
    const request = {
        proposal: 1,
        amount: 10,
        basis: 'stake',
        contract_type: 'TOUCHNA',  // TOUCHNA = Touch (Not Available for API trading, but quote might work)
        duration: 2,
        duration_unit: 'm',
        barrier: '+2',
        symbol: symbol,
        currency: 'USD',
        req_id: 200,
    };

    try {
        const response = await sendAndReceive(ws, request, 15000);

        if (response.error) {
            log('TEST', `❌ Proposal error: ${JSON.stringify(response.error)}`);
            log('TEST', '   This means we may need to use manual payout entry instead of auto-fetching');

            // Try different contract types
            const types = ['ONETOUCH', 'NOTOUCH', 'TOUCH'];
            for (const ct of types) {
                log('TEST', `   Trying contract_type="${ct}"...`);
                const altRequest = { ...request, contract_type: ct, req_id: 201 };
                try {
                    const altResponse = await sendAndReceive(ws, altRequest, 10000);
                    if (altResponse.error) {
                        log('TEST', `   ❌ ${ct}: ${altResponse.error.message || JSON.stringify(altResponse.error)}`);
                    } else if (altResponse.proposal) {
                        log('TEST', `   ✅ ${ct} works!`);
                        log('TEST', `      Payout: ${altResponse.proposal.payout}`);
                        log('TEST', `      Ask price: ${altResponse.proposal.ask_price}`);
                        log('TEST', `      Display value: ${altResponse.proposal.display_value}`);
                        log('TEST', `      Spot: ${altResponse.proposal.spot}`);
                    }
                } catch (e) {
                    log('TEST', `   ❌ ${ct} timeout: ${e.message}`);
                }
            }
        } else if (response.proposal) {
            log('TEST', `✅ Touch proposal works!`);
            log('TEST', `   Payout: ${response.proposal.payout}`);
            log('TEST', `   Ask price: ${response.proposal.ask_price}`);
            log('TEST', `   Spot: ${response.proposal.spot}`);
        }

        // Save test result
        db.prepare(`INSERT INTO api_tests VALUES (?, ?, ?, ?, ?, ?)`)
            .run('proposal_test', new Date().toISOString(), JSON.stringify(request),
                JSON.stringify(response), response.error ? 0 : 1,
                'Testing if Touch contract proposals are available via API');

    } catch (err) {
        log('TEST', `❌ Proposal test failed: ${err.message}`);
    }
}

// ─── Main Execution ────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   PHASE 0 — API EXPLORATION & DATA COLLECTION          ║');
    console.log('║   Touch Edge System Research                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    // Step 1: Init database
    initDatabase();

    // Step 2: Connect to Deriv
    try {
        await connectToDerivAPI();
    } catch (err) {
        log('FATAL', `Could not connect to Deriv API: ${err.message}`);
        log('FATAL', 'Check your internet connection and DERIV_APP_ID in .env');
        process.exit(1);
    }

    // Step 3: Test active symbols
    await testActiveSymbols(ws);

    // Step 4: Stream live ticks for analysis
    await testLiveTickStreaming(ws);

    // Step 5: Test historical download
    await testHistoricalDownload(ws);

    // Step 6: Test proposal endpoint
    await testProposalEndpoint(ws);

    // Final summary
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   PHASE 0 EXPLORATION COMPLETE                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    log('DONE', 'All tests completed. Check the output above for results.');
    log('DONE', `Data saved to: ${path.join(config.DATA_DIR, 'research.db')}`);
    log('DONE', 'Next: Run 02_data_analysis.js to analyze the collected data');

    // Close
    if (ws) ws.close();
    if (db) db.close();
    process.exit(0);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    log('EXIT', 'Interrupted by user. Saving data...');
    if (db) db.close();
    if (ws) ws.close();
    process.exit(0);
});

main().catch(err => {
    log('FATAL', `Unhandled error: ${err.message}`);
    console.error(err);
    if (db) db.close();
    if (ws) ws.close();
    process.exit(1);
});
