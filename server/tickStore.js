/**
 * TickStore
 *
 * A high-performance circular buffer for storing recent tick data in-memory.
 * It holds the last N ticks (configured in config.js) allowing fast access
 * for real-time micro-structure calculations (velocity, acceleration, compression).
 *
 * Implementation: fixed-size circular buffer backed by two Float64Arrays (epochs
 * and quotes). All operations are O(1). `getAll()` returns a plain array in
 * chronological insertion order — same contract as before, but without the O(N)
 * Array.shift() cost on every tick.
 */

class TickStore {
    constructor(maxSize) {
        this.maxSize = maxSize;

        // Circular buffer storage — pre-allocated, no GC pressure per tick
        this._epochs  = new Float64Array(maxSize);
        this._quotes  = new Float64Array(maxSize);
        this._head    = 0;   // Index of the oldest entry (write position wraps here)
        this._count   = 0;   // Number of valid entries (0 … maxSize)

        // Diagnostic counters (retained for compatibility with server diagnostics)
        this.totalRejectedTicks         = 0;
        this.equalEpochRejectedTicks    = 0;
        this.olderThanLastRejectedTicks = 0;
        this.recentRejectedTicks        = 0;
        global.__tickStoreCounters      = this;
    }

    // ── Internal helpers ──

    /** Index of the most-recently written slot */
    _tailIndex() {
        if (this._count === 0) return -1;
        return (this._head + this._count - 1) % this.maxSize;
    }

    /** Convert a logical offset (0 = oldest) to a physical buffer index */
    _physIdx(logicalOffset) {
        return (this._head + logicalOffset) % this.maxSize;
    }

    // ── Public API ──

    /**
     * Adds a new tick to the store, maintaining the maximum size.
     * O(1) — no array resizing or shifting.
     * @param {number} epoch - Unix timestamp
     * @param {number} quote - Price value
     */
    addTick(epoch, quote) {
        // Out-of-order / duplicate rejection
        if (this._count > 0) {
            const tailIdx  = this._tailIndex();
            const lastEpoch = this._epochs[tailIdx];

            if (epoch <= lastEpoch) {
                const diffSec  = lastEpoch - epoch;
                const isRecent = diffSec <= 10;
                this.totalRejectedTicks++;
                if (isRecent) this.recentRejectedTicks++;

                if (epoch === lastEpoch) {
                    this.equalEpochRejectedTicks++;
                    console.warn(`[TickStore Diagnostic] REJECTED (equal_epoch):`, {
                        rejectedEpoch: epoch, lastEpoch,
                        quote, lastStoredQuote: this._quotes[tailIdx],
                        diffSec, wallClockTime: new Date().toISOString()
                    });
                } else {
                    this.olderThanLastRejectedTicks++;
                    console.warn(`[TickStore Diagnostic] REJECTED (older_than_last):`, {
                        rejectedEpoch: epoch, lastEpoch,
                        quote, lastStoredQuote: this._quotes[tailIdx],
                        diffSec, wallClockTime: new Date().toISOString()
                    });
                }
                return;
            }
        }

        if (this._count < this.maxSize) {
            // Buffer not yet full — write at (head + count)
            const writeIdx = this._physIdx(this._count);
            this._epochs[writeIdx] = epoch;
            this._quotes[writeIdx] = quote;
            this._count++;
        } else {
            // Buffer full — overwrite the oldest slot (head) and advance head
            this._epochs[this._head] = epoch;
            this._quotes[this._head] = quote;
            this._head = (this._head + 1) % this.maxSize;
        }
    }

    /**
     * Clears the tick history (useful on reconnects to avoid gaps).
     */
    clear() {
        this._head  = 0;
        this._count = 0;
    }

    /**
     * Gets all stored ticks in chronological order.
     * Returns a plain Array of { epoch, quote } objects — same shape as before.
     * O(N) — only pay this cost when the caller actually needs all data.
     * @returns {Array<{epoch: number, quote: number}>}
     */
    getAll() {
        const result = new Array(this._count);
        for (let i = 0; i < this._count; i++) {
            const idx = this._physIdx(i);
            result[i] = { epoch: this._epochs[idx], quote: this._quotes[idx] };
        }
        return result;
    }

    /**
     * Gets the last N ticks in chronological order.
     * @param {number} count - Number of recent ticks to retrieve
     * @returns {Array<{epoch: number, quote: number}>}
     */
    getLastN(count) {
        const n      = Math.min(count, this._count);
        const start  = this._count - n;          // logical offset of first tick to include
        const result = new Array(n);
        for (let i = 0; i < n; i++) {
            const idx    = this._physIdx(start + i);
            result[i]    = { epoch: this._epochs[idx], quote: this._quotes[idx] };
        }
        return result;
    }

    /**
     * Gets the most recent tick.
     * O(1).
     * @returns {{epoch: number, quote: number}|null}
     */
    getCurrentTick() {
        if (this._count === 0) return null;
        const idx = this._tailIndex();
        return { epoch: this._epochs[idx], quote: this._quotes[idx] };
    }

    /**
     * Gets the current number of ticks stored.
     * @returns {number}
     */
    getSize() {
        return this._count;
    }
}

module.exports = TickStore;
