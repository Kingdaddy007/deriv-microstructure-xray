/**
 * Core Logic Regression Tests
 * Hardens anchor math and buffer behavior for v1.0.0
 */

const { TIMEFRAMES } = require('../server/candleAggregator');

describe('VIEW Anchor & Offset Logic', () => {

    // Testing the logic from TimeBlockOverlay._getAnchorTime
    function computeAnchor(actualLastT, visibleRightT, firstT) {
        const thresholdSec = 60;
        let mode = 'LIVE';
        let viewRightT = actualLastT;

        if ((actualLastT - visibleRightT) > thresholdSec) {
            viewRightT = visibleRightT;
            mode = 'VIEW';
        }

        const focusT5m = Math.max(firstT, viewRightT - 2 * 300);
        const focusT15m = Math.max(firstT, viewRightT - 1 * 900);

        return { mode, viewRightT, focusT5m, focusT15m };
    }

    test('LIVE mode when scroll is near the tip', () => {
        const lastT = 100000;
        const visibleT = 99950; // Only 50s away (< 60s threshold)
        const firstT = 0;

        const res = computeAnchor(lastT, visibleT, firstT);
        expect(res.mode).toBe('LIVE');
        expect(res.viewRightT).toBe(lastT); // Snaps to live
    });

    test('VIEW mode when scrolled back significantly', () => {
        const lastT = 100000;
        const visibleT = 99000; // 1000s away (> 60s threshold)
        const firstT = 0;

        const res = computeAnchor(lastT, visibleT, firstT);
        expect(res.mode).toBe('VIEW');
        expect(res.viewRightT).toBe(visibleT);
    });

    test('focusT offsets for 5m and 15m in VIEW mode', () => {
        const lastT = 100000;
        const visibleT = 90000;
        const firstT = 0;

        const res = computeAnchor(lastT, visibleT, firstT);
        expect(res.focusT5m).toBe(90000 - 600); // -10 mins
        expect(res.focusT15m).toBe(90000 - 900); // -15 mins
    });

    test('Clamping focusT to first data point', () => {
        const lastT = 1000;
        const visibleT = 500;
        const firstT = 450; // Data only goes back to 450

        const res = computeAnchor(lastT, visibleT, firstT);
        // focusT5m would be 500 - 600 = -100, but clamped to 450
        expect(res.focusT5m).toBe(450);
        expect(res.focusT15m).toBe(450);
    });
});

describe('Buffer Management Hygiene', () => {
    test('MAX_TICK_HISTORY is respected', () => {
        const TickStore = require('../server/tickStore');
        const store = new TickStore(10);
        for (let i = 0; i < 20; i++) {
            store.addTick(1000 + i, 100 + i);
        }
        expect(store.getSize()).toBe(10);
        expect(store.getAll()[0].epoch).toBe(1010); // First 10 discarded
    });

    test('Duplicate ticks are ignored', () => {
        const TickStore = require('../server/tickStore');
        const store = new TickStore(10);
        store.addTick(1000, 100);
        store.addTick(1000, 100); // Exact duplicate
        expect(store.getSize()).toBe(1);
    });

    test('Out of order ticks are ignored', () => {
        const TickStore = require('../server/tickStore');
        const store = new TickStore(10);
        store.addTick(1005, 105);
        store.addTick(1000, 100); // Out of order
        expect(store.getSize()).toBe(1);
        expect(store.getCurrentTick().epoch).toBe(1005);
    });
});
