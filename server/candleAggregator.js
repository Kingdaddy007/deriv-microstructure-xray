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
        let candle = activeCandles[label];

        while (epoch >= candle.closeTime) {
            if (candle.o !== null) {
                if (!closed[label]) closed[label] = [];
                closed[label].push({ time: candle.openTime, open: candle.o, high: candle.h, low: candle.l, close: candle.c });
            }

            const prevClose = candle.c;
            const nextOpenTime = candle.closeTime;
            const nextCloseTime = nextOpenTime + secs;

            if (epoch >= nextCloseTime && prevClose !== null) {
                candle = {
                    openTime: nextOpenTime,
                    closeTime: nextCloseTime,
                    o: prevClose,
                    h: prevClose,
                    l: prevClose,
                    c: prevClose
                };
                continue;
            }

            candle = {
                openTime: nextOpenTime,
                closeTime: nextCloseTime,
                o: null,
                h: -Infinity,
                l: Infinity,
                c: prevClose
            };
        }

        activeCandles[label] = candle;
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

                    // Gap-fill: insert flat candles for any skipped buckets between
                    // the previous candle and the current bucket, mirroring processTick().
                    const prevClose = builders[label].c;
                    let fillTime = builders[label].openTime + secs;
                    while (fillTime < bucketTime) {
                        result[label].push({ time: fillTime, open: prevClose, high: prevClose, low: prevClose, close: prevClose });
                        fillTime += secs;
                    }
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

    // Fix #1: Flush final in-progress historical candles
    for (const [label] of Object.entries(TIMEFRAMES)) {
        const b = builders[label];
        if (b && b.o !== null) {
            result[label].push({ time: b.openTime, open: b.o, high: b.h, low: b.l, close: b.c });
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
