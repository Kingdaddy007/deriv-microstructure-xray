const { TIMEFRAMES, makeTCandle, updateTCandle, processTick, makeHistoryCandles } = require('./candleAggregator');

describe('Candle Aggregator Logic', () => {

    test('makeTCandle aligns epoch correctly', () => {
        // 5s timeframe, epoch 10002 -> floor(10002 / 5) = 2000 * 5 = 10000
        const c1 = makeTCandle(5, 10002);
        expect(c1.openTime).toBe(10000);
        expect(c1.closeTime).toBe(10005);
        expect(c1.o).toBeNull();

        // 60s timeframe, epoch 3659 -> floor(3659 / 60) = 60 * 60 = 3600
        const c2 = makeTCandle(60, 3659);
        expect(c2.openTime).toBe(3600);
        expect(c2.closeTime).toBe(3660);
    });

    test('updateTCandle updates OHLC correctly', () => {
        const c = makeTCandle(5, 10000);

        // Initial tick sets Open, High, Low, Close
        updateTCandle(c, 100);
        expect(c.o).toBe(100);
        expect(c.h).toBe(100);
        expect(c.l).toBe(100);
        expect(c.c).toBe(100);

        // Tick drops
        updateTCandle(c, 90);
        expect(c.o).toBe(100);
        expect(c.h).toBe(100);
        expect(c.l).toBe(90);
        expect(c.c).toBe(90);

        // Tick spikes
        updateTCandle(c, 110);
        expect(c.o).toBe(100);
        expect(c.h).toBe(110);
        expect(c.l).toBe(90);
        expect(c.c).toBe(110);
    });

    test('processTick correctly handles boundaries and emits closed candles', () => {
        const activeCandles = {};
        for (const [label, secs] of Object.entries(TIMEFRAMES)) {
            activeCandles[label] = makeTCandle(secs, 10000);
        }

        // Tick 1 inside 10000 (0s)
        let closed = processTick(1.23, 10001, activeCandles);
        expect(Object.keys(closed).length).toBe(0); // None closed yet

        // Tick 2 crosses 10005 boundary -> '5s' candle should close
        closed = processTick(1.25, 10006, activeCandles);
        expect(closed['5s']).toBeDefined();
        expect(closed['5s'].time).toBe(10000);
        expect(closed['5s'].open).toBe(1.23);
        expect(closed['5s'].close).toBe(1.23); // Because the new price (1.25) belongs to the new candle
        expect(closed['10s']).toBeUndefined(); // Still in 10s window

        // Verify active candle was reset
        expect(activeCandles['5s'].openTime).toBe(10005);
        expect(activeCandles['5s'].o).toBe(1.25); // New candle opened at new price
    });

    test('makeHistoryCandles bulk builds correctly', () => {
        const ticks = [
            { epoch: 10001, quote: 100 },
            { epoch: 10003, quote: 105 },
            { epoch: 10006, quote: 102 },
            { epoch: 10008, quote: 90 },
            { epoch: 10015, quote: 110 }
        ];

        const history = makeHistoryCandles(ticks);
        // 5s buckets:
        // Bucket 1 (10000-10005): Ticks at 10001(100), 10003(105) 
        // -> O:100, H:105, L:100, C:105
        // Bucket 2 (10005-10010): Ticks at 10006(102), 10008(90)
        // -> O:102, H:102, L:90, C:90

        expect(history['5s'].length).toBe(2);

        const c1 = history['5s'][0];
        expect(c1.time).toBe(10000);
        expect(c1.open).toBe(100);
        expect(c1.high).toBe(105);
        expect(c1.low).toBe(100);
        expect(c1.close).toBe(105);

        const c2 = history['5s'][1];
        expect(c2.time).toBe(10005);
        expect(c2.open).toBe(102);
        expect(c2.high).toBe(102);
        expect(c2.low).toBe(90);
        expect(c2.close).toBe(90);

        // 10s buckets:
        // Bucket 1 (10000-10010): 100, 105, 102, 90
        // -> O:100, H:105, L:90, C:90
        expect(history['10s'].length).toBe(1);
        expect(history['10s'][0].open).toBe(100);
        expect(history['10s'][0].close).toBe(90);
    });

});
