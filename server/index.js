/**
 * Server Entry Point (v3) — Clean Rebuild
 * Fixes: adds 10s candle aggregation
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
let historySnapshot = null; // Set after fetchHistory() completes

// --- Candle Aggregators: 5s, 10s, 15s ---
function makeCandle() {
    return { o: 0, h: -Infinity, l: Infinity, c: 0, time: 0, ticksIn: 0 };
}
function updateCandle(candle, price, epoch) {
    candle.ticksIn++;
    if (candle.ticksIn === 1) { candle.o = price; candle.time = epoch; }
    if (price > candle.h) candle.h = price;
    if (price < candle.l) candle.l = price;
    candle.c = price;
}
function resetCandle(candle, price, epoch) {
    candle.o = price; candle.h = price; candle.l = price; candle.c = price;
    candle.time = epoch; candle.ticksIn = 0;
}
function candlePayload(c) {
    return { time: c.time, open: c.o, high: c.h, low: c.l, close: c.c };
}

const candle5s = makeCandle();
const candle10s = makeCandle();
const candle15s = makeCandle();

// --- WebSocket ---
wss.on('connection', (ws) => {
    console.log('[UI] Client connected');
    ws.send(JSON.stringify({ type: 'config', data: uiConfig }));
    ws.send(JSON.stringify({ type: 'symbol', data: primarySymbol }));

    // Send historical data snapshot so charts pre-fill immediately
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

// Step 1: Pre-fill with historical ticks so charts aren't blank
derivClient.fetchHistory(3600).then(history => {
    if (history.length > 0) {
        console.log(`[System] Pre-filling ${history.length} historical ticks...`);

        // Reset candle state before replaying history
        const hCandle5 = makeCandle();
        const hCandle10 = makeCandle();
        const hCandle15 = makeCandle();
        const historicalTicks = [];
        const historicalC5s = [];
        const historicalC10s = [];
        const historicalC15s = [];

        for (const t of history) {
            tickStore.addTick(t.epoch, t.quote);
            tickCount++;

            // Tick line points
            historicalTicks.push({ time: t.epoch, value: t.quote });

            // 5s candles
            updateCandle(hCandle5, t.quote, t.epoch);
            if (hCandle5.ticksIn >= 5) {
                historicalC5s.push(candlePayload(hCandle5));
                resetCandle(hCandle5, t.quote, t.epoch);
            }

            // 10s candles
            updateCandle(hCandle10, t.quote, t.epoch);
            if (hCandle10.ticksIn >= 10) {
                historicalC10s.push(candlePayload(hCandle10));
                resetCandle(hCandle10, t.quote, t.epoch);
            }

            // 15s candles
            updateCandle(hCandle15, t.quote, t.epoch);
            if (hCandle15.ticksIn >= 15) {
                historicalC15s.push(candlePayload(hCandle15));
                resetCandle(hCandle15, t.quote, t.epoch);
            }
        }

        // Run vol engine on historical data
        volEngine.update();

        // Store for sending to late-joining clients
        historySnapshot = { historicalTicks, historicalC5s, historicalC10s, historicalC15s };
        console.log(`[System] History ready: ${historicalTicks.length} ticks, ${historicalC5s.length} 5s candles, ${historicalC15s.length} 15s candles`);
    }

    // Step 2: Start live stream
    derivClient.connect();
});



derivClient.on('tick', (tick) => {
    const price = tick.quote;
    const epoch = tick.epoch;
    tickCount++;

    tickStore.addTick(epoch, price);
    volEngine.update();

    broadcast({ type: 'tick', data: { time: epoch, value: price } });

    // 5s candle
    updateCandle(candle5s, price, epoch);
    if (candle5s.ticksIn >= 5) {
        broadcast({ type: 'candle5s', data: candlePayload(candle5s) });
        resetCandle(candle5s, price, epoch);
    }

    // 10s candle
    updateCandle(candle10s, price, epoch);
    if (candle10s.ticksIn >= 10) {
        broadcast({ type: 'candle10s', data: candlePayload(candle10s) });
        resetCandle(candle10s, price, epoch);
    }

    // 15s candle
    updateCandle(candle15s, price, epoch);
    if (candle15s.ticksIn >= 15) {
        broadcast({ type: 'candle15s', data: candlePayload(candle15s) });
        resetCandle(candle15s, price, epoch);
    }
});

// --- Analytics Broadcast (every 1s) ---
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
