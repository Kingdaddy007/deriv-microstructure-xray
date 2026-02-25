const TIMEFRAMES = { '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '2m': 120, '5m': 300 };

function makeTCandle(tfSec, nowEpoch) {
    const openTime = Math.floor(nowEpoch / tfSec) * tfSec;
    return { openTime, closeTime: openTime + tfSec, o: null, h: -Infinity, l: Infinity, c: null };
}

function updateTCandle(candle, price) {
    if (candle.o === null) candle.o = price;
    if (price > candle.h) candle.h = price;
    if (price < candle.l) candle.l = price;
    candle.c = price;
}

function processTick(price, epoch, activeCandles) {
    const closed = {};
    for (const [label, secs] of Object.entries(TIMEFRAMES)) {
        if (!activeCandles[label]) {
            activeCandles[label] = makeTCandle(secs, epoch);
        }
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
    for (const [label] of Object.entries(TIMEFRAMES)) {
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

module.exports = {
    TIMEFRAMES,
    makeTCandle,
    updateTCandle,
    processTick,
    makeHistoryCandles
};
