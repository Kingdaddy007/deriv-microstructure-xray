/**
 * Server Entry Point (v4) — Time-Based Candles + Countdown
 * Changes from v3:
 * - Candle aggregation is now TIME-based (real seconds), not tick-count-based
 * - Broadcasts candle countdown state for each timeframe
 * - History pre-fill uses paginated fetch (3 pages × 5000 = ~4h)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

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
let serverStartTime = Date.now();
let gapEvents = 0;
let lastTickTime = null;

const { TIMEFRAMES, makeTCandle, updateTCandle, processTick, makeHistoryCandles } = require('./candleAggregator');

// Active candles keyed by timeframe label
const activeCandles = {};
for (const [label, secs] of Object.entries(TIMEFRAMES)) {
    activeCandles[label] = makeTCandle(secs, Math.floor(Date.now() / 1000));
}

// --- WebSocket ---
wss.on('connection', (ws) => {
    console.log('[UI] Client connected');
    ws.send(JSON.stringify({ type: 'config', data: uiConfig }));
    ws.send(JSON.stringify({ type: 'symbol', data: primarySymbol }));

    // Build a fresh history snapshot every time a client connects,
    // so there is never a gap between history end and live data start.
    const allTicks = tickStore.getAll();
    if (allTicks.length > 0) {
        const candles = makeHistoryCandles(allTicks);
        const freshSnapshot = {
            historicalTicks: allTicks.map(t => ({ time: t.epoch, value: t.quote })),
            historicalC5s: candles['5s'],
            historicalC10s: candles['10s'],
            historicalC15s: candles['15s'],
            historicalC30s: candles['30s'],
            historicalC1m: candles['1m'],
            historicalC2m: candles['2m'],
            historicalC5m: candles['5m'],
        };
        ws.send(JSON.stringify({ type: 'history', data: freshSnapshot }));
    } else if (historySnapshot) {
        // Fallback: server hasn't warmed up yet, send the initial fetch snapshot
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

    if (lastTickTime !== null && epoch - lastTickTime > 2.5) {
        gapEvents++;
    }
    lastTickTime = epoch;

    tickStore.addTick(epoch, price);
    volEngine.update();

    broadcast({ type: 'tick', data: { time: epoch, value: price } });

    // Time-based candle processing
    const closed = processTick(price, epoch, activeCandles);
    for (const [label, candleData] of Object.entries(closed)) {
        broadcast({ type: 'candle_closed', timeframe: label, data: candleData });
    }

    // Broadcast current forming candle for each timeframe (live candle movement)
    for (const [label] of Object.entries(TIMEFRAMES)) {
        const c = activeCandles[label];
        if (c && c.o !== null) {
            broadcast({
                type: 'candle_update', timeframe: label, data: {
                    time: c.openTime, open: c.o, high: c.h, low: c.l, close: c.c
                }
            });
        }
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
            active,
            serverStats: {
                uptime: Math.floor((Date.now() - serverStartTime) / 1000),
                memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                connections: wss.clients.size,
                gaps: gapEvents
            }
        }
    });
}, config.DASHBOARD_UPDATE_INTERVAL);

server.listen(config.PORT, () => {
    console.log(`[System] Dashboard → http://localhost:${config.PORT}`);
});
