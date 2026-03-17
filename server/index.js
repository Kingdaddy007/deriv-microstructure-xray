/**
 * Server Entry Point (v1.0.1 Stable)
 * - Fixed Engine Integration (Class-based)
 * - Restored Analytics, Probability, Edge, and Reach Grid
 * - Cleaned up Record/Replay bloat
 * - Added Diagnostic Handlers for Tick Store rejection and divergence
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const config = require('./config');
const DerivClient = require('./derivClient');
const TickStore = require('./tickStore');
const { processTick, makeHistoryCandles, TIMEFRAMES } = require('./candleAggregator');

// Engines (Classes)
const VolatilityEngine = require('./volatilityEngine');
const ProbabilityEngine = require('./probabilityEngine');
const EdgeCalculator = require('./edgeCalculator');
const { computeReachGrid } = require('./reachGridEngine');
const TradingEngine = require('./tradingEngine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/lib', express.static(path.join(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist')));

// --- Shared State ---
const symbol = config.SYMBOLS.V100_1S;
const deriv = new DerivClient(symbol, config.DERIV_DEMO_TOKEN);
const derivReal = new DerivClient(symbol, config.DERIV_REAL_TOKEN, { subscribeTicks: false });
const store = new TickStore(config.MAX_TICK_HISTORY);
const activeCandles = {};

// Engine Instances
const volEngine = new VolatilityEngine(store);
const probEngine = new ProbabilityEngine(symbol, volEngine);
const edgeCalc = new EdgeCalculator(volEngine);
const tradingDemo = new TradingEngine(deriv);
const tradingReal = new TradingEngine(derivReal);

// Helper: pick the correct trading engine by mode
function getTradingEngine(mode) {
    return mode === 'real' ? tradingReal : tradingDemo;
}

// Track account info for broadcasting to new clients
let accountInfo = { demo: null, real: null };
deriv.on('authorize', (info) => {
    accountInfo.demo = info;
    broadcast('account_info', { ...info, mode: 'demo' });
});
derivReal.on('authorize', (info) => {
    accountInfo.real = info;
    broadcast('account_info', { ...info, mode: 'real' });
});

// Live balance updates — broadcast to all clients and keep cached info in sync
deriv.on('balance', (balData) => {
    if (accountInfo.demo) accountInfo.demo.balance = balData.balance;
    broadcast('balance', { balance: balData.balance, currency: balData.currency || accountInfo.demo?.currency, mode: 'demo' });
});
derivReal.on('balance', (balData) => {
    if (accountInfo.real) accountInfo.real.balance = balData.balance;
    broadcast('balance', { balance: balData.balance, currency: balData.currency || accountInfo.real?.currency, mode: 'real' });
});

let lastTickTime = null;
let gapEvents = 0;
let historyReady = false;
let serverStartTime = Date.now();
let nextClientId = 1;

// Configs
let uiConfig = { barrier: 2.0, payoutROI: 109, direction: 'up' };
let reachGridConfig = {
    lookbackSec: 1800, // 30m default
    stride: 10,
    mode: 'either'
};

// --- WebSocket Utilities ---
function broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

function sendToClient(clientId, type, data) {
    const msg = JSON.stringify({ type, data });
    let delivered = false;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client._clientId === clientId) {
            client.send(msg);
            delivered = true;
        }
    });

    return delivered;
}

tradingDemo.on('trade_outcome', (outcome) => {
    outcome.mode = 'demo';
    const delivered = outcome.ownerId !== null && outcome.ownerId !== undefined
        ? sendToClient(outcome.ownerId, 'trade_outcome', outcome)
        : false;
    if (!delivered) broadcast('trade_outcome', outcome);
});
tradingReal.on('trade_outcome', (outcome) => {
    outcome.mode = 'real';
    const delivered = outcome.ownerId !== null && outcome.ownerId !== undefined
        ? sendToClient(outcome.ownerId, 'trade_outcome', outcome)
        : false;
    if (!delivered) broadcast('trade_outcome', outcome);
});

tradingDemo.on('contract_update', (update) => {
    update.mode = 'demo';
    const delivered = update.ownerId !== null && update.ownerId !== undefined
        ? sendToClient(update.ownerId, 'contract_update', update)
        : false;
    if (!delivered) broadcast('contract_update', update);
});
tradingReal.on('contract_update', (update) => {
    update.mode = 'real';
    const delivered = update.ownerId !== null && update.ownerId !== undefined
        ? sendToClient(update.ownerId, 'contract_update', update)
        : false;
    if (!delivered) broadcast('contract_update', update);
});

// --- WebSocket Connection ---
wss.on('connection', (ws) => {
    ws._clientId = nextClientId++;
    console.log(`[WS] Client connected (${wss.clients.size} total)`);

    ws.send(JSON.stringify({ type: 'symbol', data: symbol }));
    ws.send(JSON.stringify({ type: 'config', data: uiConfig }));
    // Send account info if already authorized
    if (accountInfo.demo) {
        ws.send(JSON.stringify({ type: 'account_info', data: { ...accountInfo.demo, mode: 'demo' } }));
    }
    if (accountInfo.real) {
        ws.send(JSON.stringify({ type: 'account_info', data: { ...accountInfo.real, mode: 'real' } }));
    }

    if (store.getSize() > 0) {
        const allTicks = store.getAll();
        const candles = makeHistoryCandles(allTicks);
        const snapshot = {
            historicalTicks: allTicks.map(t => ({ time: t.epoch, value: t.quote })),
            historicalC5s: candles['5s'],
            historicalC10s: candles['10s'],
            historicalC15s: candles['15s'],
            historicalC30s: candles['30s'],
            historicalC1m: candles['1m'],
            historicalC2m: candles['2m'],
            historicalC5m: candles['5m'],
        };
        ws.send(JSON.stringify({ type: 'history', data: snapshot }));
    }

    ws.on('message', (msg) => {
        try {
            const packet = JSON.parse(msg);
            if (packet.type === 'update_config') {
                if (packet.barrier !== undefined) uiConfig.barrier = packet.barrier;
                if (packet.payoutROI !== undefined) uiConfig.payoutROI = packet.payoutROI;
                if (packet.direction !== undefined) uiConfig.direction = packet.direction;
            }
            if (packet.type === 'update_reach_config') {
                if (packet.mode) reachGridConfig.mode = packet.mode;
                if (packet.horizon) reachGridConfig.lookbackSec = packet.horizon;
            }

            // ── TRADING HANDLERS (routed by mode: demo or real) ──
            if (packet.type === 'get_proposal') {
                const engine = getTradingEngine(packet.mode);
                // Server-side sanity validation — no upper cap, just ensure valid input
                const amount = parseFloat(packet.amount);
                if (!Number.isFinite(amount) || amount < 0.35) {
                    ws.send(JSON.stringify({ type: 'proposal_result', data: { error: 'Invalid stake amount. Must be a number >= $0.35.' } }));
                    return;
                }
                const duration = parseInt(packet.duration);
                if (!Number.isFinite(duration) || duration < 1) {
                    ws.send(JSON.stringify({ type: 'proposal_result', data: { error: 'Invalid duration.' } }));
                    return;
                }

                engine.getProposal({
                    amount,
                    contract_type: packet.contract_type,
                    barrier: packet.barrier,
                    duration,
                    duration_unit: packet.duration_unit,
                    basis: packet.basis,
                    currency: accountInfo?.currency
                }).then(result => {
                    ws.send(JSON.stringify({ type: 'proposal_result', data: result }));
                }).catch(err => {
                    ws.send(JSON.stringify({ type: 'proposal_result', data: { error: err.message || err.code || 'Proposal failed' } }));
                });
            }

            if (packet.type === 'execute_trade') {
                const engine = getTradingEngine(packet.mode);
                engine.executeBuy(packet.proposalId, packet.maxPrice, ws._clientId)
                    .then(result => {
                        ws.send(JSON.stringify({ type: 'trade_result', data: result }));
                    }).catch(err => {
                        ws.send(JSON.stringify({ type: 'trade_error', data: { message: err.message || err.code || 'Trade execution failed' } }));
                    });
            }

            // ── BALANCE SUBSCRIBE ──
            if (packet.type === 'subscribe_balance') {
                const mode = packet.mode || 'demo';
                const info = mode === 'real' ? accountInfo.real : accountInfo.demo;
                if (info) {
                    ws.send(JSON.stringify({ type: 'balance', data: { balance: info.balance, currency: info.currency, mode } }));
                }
            }

            // --- DIAGNOSTIC START ---
            if (packet.type === 'debug_snapshot') {
                const { blockStart } = packet;
                const windowTicks = store.getAll().filter(t => t.epoch >= blockStart - 15 && t.epoch <= blockStart + 315);
                global.__debugSnapshot = {
                    blockStart,
                    ticks: JSON.parse(JSON.stringify(windowTicks)), // deep copy
                    timestamp: Date.now()
                };
                console.log(`[Diagnostic] Snapshot block ${blockStart}: ${windowTicks.length} ticks.`);
                ws.send(JSON.stringify({ type: 'debug_info', data: `Snapshot captured: ${windowTicks.length} ticks.` }));
            }

            if (packet.type === 'debug_compare') {
                if (!global.__debugSnapshot) {
                    ws.send(JSON.stringify({ type: 'debug_info', data: 'No snapshot. Run debugSnapshot(time) before refresh.' }));
                    return;
                }
                const snap = global.__debugSnapshot;
                console.log(`[Diagnostic] Comparing block ${snap.blockStart} with history...`);

                // Fetch window from history (blockStart-15 to blockStart+315)
                // fetchHistoryPage returns up to 5000, we only need ~330
                deriv._fetchHistoryPage(snap.blockStart + 315, 600).then(hist => {
                    const official = hist.filter(t => t.epoch >= snap.blockStart - 15 && t.epoch <= snap.blockStart + 315)
                        .sort((a, b) => a.epoch - b.epoch);

                    const report = {
                        blockStart: snap.blockStart,
                        liveCount: snap.ticks.length,
                        officialCount: official.length,
                        totalRejectedInStore: store.totalRejectedTicks || 0,
                        mismatches: []
                    };

                    const liveMap = new Map(snap.ticks.map(t => [`${t.epoch}_${t.quote}`, t]));
                    const officialMap = new Map(official.map(t => [`${t.epoch}_${t.quote}`, t]));

                    official.forEach(t => {
                        if (!liveMap.has(`${t.epoch}_${t.quote}`)) {
                            report.mismatches.push({ type: 'MISSING_IN_LIVE', tick: t, b: Math.floor(t.epoch / 300) * 300 });
                        }
                    });

                    snap.ticks.forEach(t => {
                        if (!officialMap.has(`${t.epoch}_${t.quote}`)) {
                            report.mismatches.push({ type: 'GHOST_IN_LIVE', tick: t, b: Math.floor(t.epoch / 300) * 300 });
                        }
                    });

                    ws.send(JSON.stringify({ type: 'debug_report', data: report }));
                }).catch(err => {
                    ws.send(JSON.stringify({ type: 'debug_info', data: `Comparison error: ${err.message}` }));
                });
            }

            if (packet.type === 'debug_counters') {
                ws.send(JSON.stringify({
                    type: 'debug_counters', data: {
                        total: store.totalRejectedTicks || 0,
                        equal: store.equalEpochRejectedTicks || 0,
                        older: store.olderThanLastRejectedTicks || 0,
                        recent: store.recentRejectedTicks || 0
                    }
                }));
            }
            // --- DIAGNOSTIC END ---

        } catch (e) {
            console.error("[WS] Error parsing message:", e);
        }
    });

    ws.on('close', () => console.log('[WS] Client disconnected'));
});

// --- Deriv Tick Handler ---
deriv.on('tick', (t) => {
    if (!historyReady) return;

    if (lastTickTime !== null && t.epoch - lastTickTime > 2.5) {
        gapEvents++;
    }
    lastTickTime = t.epoch;

    store.addTick(t.epoch, t.quote);

    // Process closed candles
    const closed = processTick(t.quote, t.epoch, activeCandles);
    for (const [tf, candles] of Object.entries(closed)) {
        for (const c of candles) {
            broadcast('candle_closed', { timeframe: tf, data: c });
        }
    }

    // Update forming candles
    for (const label of Object.keys(TIMEFRAMES)) {
        const c = activeCandles[label];
        if (c && c.o !== null) {
            broadcast('candle_update', {
                timeframe: label, data: {
                    time: c.openTime, open: c.o, high: c.h, low: c.l, close: c.c
                }
            });
        }
    }

    // Basic tick broadcast
    broadcast('tick', { time: t.epoch, value: t.quote });

    // Broadcast countdown state for all timeframes
    const now = t.epoch;
    const countdowns = {};
    for (const [label, secs] of Object.entries(TIMEFRAMES)) {
        const c = activeCandles[label];
        if (c) {
            countdowns[label] = {
                remaining: Math.max(0, c.closeTime - now),
                total: secs,
                pct: Math.max(0, (c.closeTime - now) / secs)
            };
        }
    }
    broadcast('countdown', countdowns);

    // Update Engines
    volEngine.update();

    // Broadcast Analytics
    const probData = probEngine.estimate(uiConfig.barrier, t.quote, uiConfig.direction);
    const edgeData = edgeCalc.analyze(probData, uiConfig.payoutROI, store.getSize());

    broadcast('analytics', {
        price: t.quote,
        tickCount: store.getSize(),
        volatility: volEngine.getSnapshot(),
        active: edgeData,
        warmupProgress: Math.min(1, store.getSize() / config.WARMUP_TICKS),
        serverStats: {
            uptime: Math.round((Date.now() - serverStartTime) / 1000),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            connections: wss.clients.size,
            gaps: gapEvents
        }
    });
});

// --- Reach Grid Broadcast (5s interval) ---
setInterval(() => {
    if (!historyReady) return;
    const ticks = store.getAll();
    if (ticks.length === 0) return;

    const results = computeReachGrid(ticks, {
        lookbackSec: reachGridConfig.lookbackSec,
        stride: reachGridConfig.stride
    });

    broadcast('reach_grid', {
        symbol,
        ...reachGridConfig,
        matrix: results.matrix,
        samplesPerHorizon: results.samplesPerHorizon,
        distances: results.distances,
        horizons: results.horizons,
        timestamp: Math.floor(Date.now() / 1000)
    });
}, 5000);

// --- Bootstrap ---
console.log(`[System] Initializing for ${symbol}...`);

deriv.fetchHistory(5)
    .then(history => {
        if (history.length > 0) {
            console.log(`[System] Pre-filling ${history.length} historical ticks...`);
            for (const t of history) {
                store.addTick(t.epoch, t.quote);
                processTick(t.quote, t.epoch, activeCandles);
            }
            volEngine.update(); // Initialize vol engine with historical data
        }
    })
    .catch(err => {
        console.error(`[System] History fetch failed:`, err);
    })
    .finally(() => {
        // Ensure we attempt to connect to live stream even if history fetch fails
        historyReady = true;
        console.log(`[System] Starting live streams...`);
        deriv.connect();
        // Connect real account client for trading (does not subscribe to ticks, only auth)
        if (config.DERIV_REAL_TOKEN) {
            derivReal.connect();
        }
    });

server.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[Server] Stable v1.0.1 running on http://localhost:${config.PORT}`);
});

// --- Graceful Shutdown ---
function shutdown(signal) {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

    // 1. Stop accepting new connections
    server.close(() => {
        console.log('[Server] HTTP server closed.');
    });

    // 2. Close all WebSocket clients
    wss.clients.forEach(client => {
        try { client.terminate(); } catch (_) { /* ignore */ }
    });

    // 3. Disconnect Deriv WebSockets
    try { deriv.disconnect(); } catch (_) { /* ignore */ }
    try { derivReal.disconnect(); } catch (_) { /* ignore */ }

    // 4. Close SQLite database
    try { probEngine.close(); } catch (_) { /* ignore */ }

    console.log('[Server] Cleanup complete. Exiting.');
    process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
