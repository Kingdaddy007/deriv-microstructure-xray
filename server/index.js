/**
 * Server Entry Point (v1.0.1 Stable)
 * - Fixed Engine Integration (Class-based)
 * - Restored Analytics, Probability, Edge, and Reach Grid
 * - Cleaned up Record/Replay bloat
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/lib', express.static(path.join(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist')));

// --- Shared State ---
const symbol = config.SYMBOLS.V100_1S;
const deriv = new DerivClient(symbol);
const store = new TickStore(config.MAX_TICK_HISTORY);
const activeCandles = {};

// Engine Instances
const volEngine = new VolatilityEngine(store);
const probEngine = new ProbabilityEngine(symbol, volEngine);
const edgeCalc = new EdgeCalculator(volEngine);

let lastTickTime = null;
let gapEvents = 0;
let historyReady = false;
let serverStartTime = Date.now();

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

// --- WebSocket Connection ---
wss.on('connection', (ws) => {
    console.log(`[WS] Client connected (${wss.clients.size} total)`);

    ws.send(JSON.stringify({ type: 'symbol', data: symbol }));
    ws.send(JSON.stringify({ type: 'config', data: uiConfig }));

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
    for (const [tf, c] of Object.entries(closed)) {
        broadcast('candle_closed', { timeframe: tf, data: c });
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

deriv.fetchHistory(5).then(history => {
    if (history.length > 0) {
        console.log(`[System] Pre-filling ${history.length} historical ticks...`);
        for (const t of history) {
            store.addTick(t.epoch, t.quote);
        }
        volEngine.update(); // Initialize vol engine with historical data
    }
    historyReady = true;
    console.log(`[System] Starting live stream...`);
    deriv.connect();
}).catch(err => {
    console.error(`[System] Init failed:`, err);
});

server.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[Server] Stable v1.0.1 running on http://localhost:${config.PORT}`);
});
