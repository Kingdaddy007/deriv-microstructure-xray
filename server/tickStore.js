/**
 * TickStore
 * 
 * A high-performance circular buffer for storing recent tick data in-memory.
 * It holds the last N ticks (configured in config.js) allowing fast access
 * for real-time micro-structure calculations (velocity, acceleration, compression).
 */

class TickStore {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.ticks = []; // Array of { epoch, quote }
    }

    /**
     * Adds a new tick to the store, maintaining the maximum size.
     * Discards older ticks if they exceed maxSize.
     * @param {number} epoch - Unix timestamp
     * @param {number} quote - Price value
     */
    addTick(epoch, quote) {
        // Basic validation to prevent out-of-order ticks if any
        if (this.ticks.length > 0 && epoch <= this.ticks[this.ticks.length - 1].epoch) {
            if (epoch === this.ticks[this.ticks.length - 1].epoch) {
                return; // Exact duplicate
            }
            // Out of order ticks: usually rare with Deriv API, but we'll ignore to maintain order
            return;
        }

        this.ticks.push({ epoch, quote });
        if (this.ticks.length > this.maxSize) {
            this.ticks.shift(); // Remove the oldest
        }
    }

    /**
     * Clears the tick history (useful on reconnects to avoid gaps)
     */
    clear() {
        this.ticks = [];
    }

    /**
     * Gets the entire array of stored ticks.
     * @returns {Array<{epoch: number, quote: number}>}
     */
    getAll() {
        return this.ticks;
    }

    /**
     * Gets the last N ticks.
     * @param {number} count - Number of recent ticks to retrieve
     * @returns {Array<{epoch: number, quote: number}>}
     */
    getLastN(count) {
        if (count >= this.ticks.length) return this.ticks;
        return this.ticks.slice(this.ticks.length - count);
    }

    /**
     * Gets the most recent tick.
     * @returns {Object|null} { epoch, quote } or null if empty
     */
    getCurrentTick() {
        if (this.ticks.length === 0) return null;
        return this.ticks[this.ticks.length - 1];
    }

    /**
     * Gets the current number of ticks stored.
     * @returns {number}
     */
    getSize() {
        return this.ticks.length;
    }
}

module.exports = TickStore;
