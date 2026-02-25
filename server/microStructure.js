/**
 * Micro-Structure Engine
 * 
 * Analyzes the recent tick stream (from tickStore) to calculate:
 * - Velocity (10, 30, 60 tick windows)
 * - Acceleration 
 * - Compression (60 tick window)
 */

class MicroStructureEngine {
    constructor(tickStore) {
        this.tickStore = tickStore;
    }

    getCurrentFeatures() {
        const ticks = this.tickStore.getAll();
        const count = ticks.length;

        // We need at least 60 ticks to calculate full features
        if (count < 60) {
            return null;
        }

        const currentQuote = ticks[count - 1].quote;

        // --- Velocity (net change) ---
        const p10 = ticks[count - 1 - 10].quote;
        const p30 = ticks[count - 1 - 30].quote;
        const p60 = ticks[count - 1 - 60].quote;

        const vel10 = currentQuote - p10;
        const vel30 = currentQuote - p30;
        const vel60 = currentQuote - p60;

        // --- Acceleration ---
        // Change in short-term velocity vs normalized longer-term velocity
        const accel = vel10 - (vel30 / 3);

        // --- Compression ---
        let max60 = ticks[count - 61].quote;
        let min60 = ticks[count - 61].quote;

        for (let i = count - 60; i < count; i++) {
            const q = ticks[i].quote;
            if (q > max60) max60 = q;
            if (q < min60) min60 = q;
        }
        const comp60 = max60 - min60;

        return {
            vel10,
            vel30,
            vel60,
            accel,
            comp60,
            currentPrice: currentQuote,
            timestamp: ticks[count - 1].epoch
        };
    }
}

module.exports = MicroStructureEngine;
