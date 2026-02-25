/**
 * Server Entry Point (v4) — Time-Based Candles + Countdown
 * Changes from v3:
 * - Candle aggregation is now TIME-based (real seconds), not tick-count-based
 * - Broadcasts candle countdown state for each timeframe
 * - History pre-fill uses paginated fetch (3 pages × 5000 = ~4h)
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const config = require('./config');
const DerivClient = require('./derivClient');
const TickStore = require('./tickStore');
const VolatilityEngine = require('./volatilityEngine');
const ProbabilityEngine = require('./probabilityEngine');
const EdgeCalculator = require('./edgeCalculator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/lib', express.static(path.join(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist')));

// --- Core Components ---
const primarySymbol = config.SYMBOLS.V100_1S;
const tickStore = new TickStore(config.MAX_TICK_HISTORY);
const derivClient = new DerivClient(primarySymbol);
const volEngine = new VolatilityEngine(tickStore);
const probEngine = new ProbabilityEngine(primarySymbol, volEngine);
const edgeCalc = new EdgeCalculator(volEngine);

// --- State ---
let tickCount = 0;
let uiConfig = { barrier: 2.0, payoutROI: 109, direction: 'up' };
let historySnapshot = null;

// --- Time-Based Candle Aggregators ---
// Timeframes in seconds
const TIMEFRAMES = { '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '2m': 120, '5m': 300 };

function makeTCandle(tfSec, nowEpoch) {
    // Align open time to the nearest timeframe boundary
    const openTime = Math.floor(nowEpoch / tfSec) * tfSec;
    return { openTime, closeTime: openTime + tfSec, o: null, h: -Infinity, l: Infinity, c: null };
}

// Active candles keyed by timeframe label
const activeCandles = {};
for (const [label, secs] of Object.entries(TIMEFRAMES)) {
    activeCandles[label] = makeTCandle(secs, Math.floor(Date.now() / 1000));
}

function updateTCandle(candle, price) {
    if (candle.o === null) candle.o = price;
    if (price > candle.h) candle.h = price;
    if (price < candle.l) candle.l = price;
    candle.c = price;
}

function processTick(price, epoch) {
    // Closed types to broadcast this tick
    const closed = {};
    for (const [label, secs] of Object.entries(TIMEFRAMES)) {
        const candle = activeCandles[label];
        if (epoch >= candle.closeTime) {
            // Close and broadcast this candle
            if (candle.o !== null) {
                closed[label] = { time: candle.openTime, open: candle.o, high: candle.h, low: candle.l, close: candle.c };
            }
            activeCandles[label] = makeTCandle(secs, epoch);
        }
        updateTCandle(activeCandles[label], price);
    }
    return closed;
}

// Candle helper for history replay
function makeHistoryCandles(ticks) {
    const builders = {};
    const result = {};
    for (const [label, secs] of Object.entries(TIMEFRAMES)) {
        builders[label] = null;
        result[label] = [];
    }
    for (const t of ticks) {
        for (const [label, secs] of Object.entries(TIMEFRAMES)) {
            const bucketTime = Math.floor(t.epoch / secs) * secs;
            if (!builders[label] || builders[label].openTime !== bucketTime) {
                if (builders[label] && builders[label].o !== null) {
                    result[label].push({ time: builders[label].openTime, open: builders[label].o, high: builders[label].h, low: builders[label].l, close: builders[label].c });
                }
                builders[label] = { openTime: bucketTime, o: null, h: -Infinity, l: Infinity, c: null };
            }
            const b = builders[label];
            if (b.o === null) b.o = t.quote;
            if (t.quote > b.h) b.h = t.quote;
            if (t.quote < b.l) b.l = t.quote;
            b.c = t.quote;
        }
    }
    return result;
}

// --- WebSocket ---
wss.on('connection', (ws) => {
    console.log('[UI] Client connected');
    ws.send(JSON.stringify({ type: 'config', data: uiConfig }));
    ws.send(JSON.stringify({ type: 'symbol', data: primarySymbol }));
    if (historySnapshot) {
        ws.send(JSON.stringify({ type: 'history', data: historySnapshot }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'update_config') {
                if (data.barrier != null) uiConfig.barrier = parseFloat(data.barrier);
                if (data.payoutROI != null) uiConfig.payoutROI = parseFloat(data.payoutROI);
                if (data.direction != null) uiConfig.direction = data.direction;
            }
        } catch (e) { /* ignore */ }
    });

    ws.on('close', () => console.log('[UI] Client disconnected'));
});

function broadcast(msg) {
    const str = JSON.stringify(msg);
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

// --- Deriv Stream ---
console.log(`[System] Connecting to Deriv for ${primarySymbol}...`);

derivClient.fetchHistory(3).then(history => {
    if (history.length > 0) {
        console.log(`[System] Pre-filling ${history.length} historical ticks...`);
        for (const t of history) {
            tickStore.addTick(t.epoch, t.quote);
            tickCount++;
        }
        volEngine.update();
        const candles = makeHistoryCandles(history);
        historySnapshot = {
            historicalTicks: history.map(t => ({ time: t.epoch, value: t.quote })),
            historicalC5s: candles['5s'],
            historicalC10s: candles['10s'],
            historicalC15s: candles['15s'],
            historicalC30s: candles['30s'],
            historicalC1m: candles['1m'],
            historicalC2m: candles['2m'],
            historicalC5m: candles['5m'],
        };
        console.log(`[System] History ready — ticks: ${history.length}, 5s: ${candles['5s'].length}, 15s: ${candles['15s'].length}, 1m: ${candles['1m'].length}`);
    }
    derivClient.connect();
});

// --- Live Tick Handler ---
derivClient.on('tick', (tick) => {
    const price = tick.quote;
    const epoch = tick.epoch;
    tickCount++;

    tickStore.addTick(epoch, price);
    volEngine.update();

    broadcast({ type: 'tick', data: { time: epoch, value: price } });

    // Time-based candle processing
    const closed = processTick(price, epoch);
    for (const [label, candleData] of Object.entries(closed)) {
        broadcast({ type: 'candle_closed', timeframe: label, data: candleData });
    }

    // Broadcast countdown state for all timeframes
    const now = epoch;
    const countdowns = {};
    for (const [label, secs] of Object.entries(TIMEFRAMES)) {
        const c = activeCandles[label];
        countdowns[label] = {
            remaining: Math.max(0, c.closeTime - now),
            total: secs,
            pct: Math.max(0, (c.closeTime - now) / secs)
        };
    }
    broadcast({ type: 'countdown', data: countdowns });
});

// --- Analytics Broadcast ---
setInterval(() => {
    const ticks = tickStore.getAll();
    if (ticks.length === 0) return;
    const currentPrice = ticks[ticks.length - 1].quote;

    const probUp = probEngine.estimate(uiConfig.barrier, currentPrice, 'up');
    const probDown = probEngine.estimate(uiConfig.barrier, currentPrice, 'down');
    const edgeUp = edgeCalc.analyze(probUp, uiConfig.payoutROI, tickCount);
    const edgeDown = edgeCalc.analyze(probDown, uiConfig.payoutROI, tickCount);
    const active = uiConfig.direction === 'up' ? edgeUp : edgeDown;

    broadcast({
        type: 'analytics',
        data: {
            symbol: primarySymbol,
            price: currentPrice,
            tickCount,
            warmupProgress: Math.min(tickCount / config.WARMUP_TICKS, 1),
            warmupDone: tickCount >= config.WARMUP_TICKS,
            volatility: volEngine.getSnapshot(),
            direction: uiConfig.direction,
            barrier: uiConfig.barrier,
            payoutROI: uiConfig.payoutROI,
            active
        }
    });
}, config.DASHBOARD_UPDATE_INTERVAL);

server.listen(config.PORT, () => {
    console.log(`[System] Dashboard → http://localhost:${config.PORT}`);
});
