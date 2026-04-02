/**
 * Block Tracker — Phase 0 of Cipher Swarm Bot + Quadrant Break Data Layer
 *
 * Divides time into 5-minute blocks with 4 quadrants.
 * Tracks: block OHLC, per-quadrant OHLC (Q1/Q2/Q3/Q4), quadrant timing,
 *         discount, Q1 sweep, macro trend, trade count.
 *
 * V3: Added per-quadrant OHLC tracking for the Quadrant Break strategy.
 *     Existing Cipher Swarm consumers are unaffected — getState() returns
 *     everything it did before, plus the new quadrant data.
 */

class BlockTracker {
    constructor() {
        this.BLOCK_DURATION = 300; // 5 minutes = 300 seconds

        // Current block state
        this.blockStart = null;       // epoch of current block start
        this.blockOpen = null;        // price at first tick of block
        this.blockHigh = -Infinity;
        this.blockLow = Infinity;
        this.elapsed = 0;             // seconds into block
        this.quadrant = 'Q1';
        this.prevQuadrant = null;     // previous tick's quadrant (for transition detection)
        this.inSweetZone = false;
        this.tradeCount = 0;
        this.q4Low = Infinity;        // lowest price seen during Q4 only

        // Per-quadrant OHLC (for Quadrant Break strategy)
        this._resetQuadrantData();

        // Previous block state
        this.prevBlock = null;        // { open, high, low, close, q4Low }

        // Direction tracking (V2: micro-candle based)
        this.microCandles = [];       // {open, close, time}[] — last 5 one-minute candle closes
        this.microCandleDuration = 60; // 60 seconds = 1 minute
        this._microCandleStart = null;
        this._microCandleOpen = null;
        this._microCandleClose = null;
        this.macroTrend = 'NONE';     // 'UP', 'DOWN', 'NONE'

        // Legacy: keep blockCloses for reference but no longer drives trend
        this.blockCloses = [];        // last 3 block close prices

        // Events
        this.discountOccurred = false; // price went below block open
        this.q1SweepOccurred = false;  // Q1 took out prev block high

        // Internal
        this._lastPrice = null;        // last seen price (for accurate block close)
    }

    /**
     * Initialize/reset per-quadrant OHLC structures.
     * Called on every new block.
     */
    _resetQuadrantData() {
        const emptyQuadrant = () => ({
            open: null,
            high: -Infinity,
            low: Infinity,
            close: null,
            tickCount: 0
        });

        this.q1 = emptyQuadrant();
        this.q2 = { ...emptyQuadrant(), tickAtQ1HighClear: null, tickAtQ1LowClear: null };
        this.q3 = { ...emptyQuadrant(), highTick: 0, lowTick: 0, reversalCount: 0 };
        this.q4 = emptyQuadrant();

        // Internal Q3 reversal tracking
        this._q3LastDirection = null;     // 'up' or 'down' — last significant move direction
        this._q3LastSignificantPrice = null; // price at last direction change
        this._q3ReversalThreshold = 0.05;    // minimum price change to count as a reversal (tunable)
    }

    update(epoch, price) {
        const currentBlockStart = Math.floor(epoch / this.BLOCK_DURATION) * this.BLOCK_DURATION;

        // --- NEW BLOCK? ---
        if (this.blockStart !== null && this.blockStart !== currentBlockStart) {
            this._closeBlock(this._lastPrice); // close old block with its actual last tick
            this._openBlock(currentBlockStart, price);
        }

        // First ever tick — open the first block
        if (this.blockStart === null) {
            this._openBlock(currentBlockStart, price);
        }

        // --- UPDATE CURRENT BLOCK ---
        this.elapsed = epoch - this.blockStart;
        const newQuadrant = this._getQuadrant(this.elapsed);

        // Detect quadrant transition (for downstream consumers)
        this.prevQuadrant = this.quadrant;
        this.quadrant = newQuadrant;
        this.inSweetZone = (this.elapsed >= 150);

        if (price > this.blockHigh) this.blockHigh = price;
        if (price < this.blockLow) this.blockLow = price;

        // Q4-only low tracking
        if (this.quadrant === 'Q4') {
            if (price < this.q4Low) this.q4Low = price;
        }

        // Discount detection
        if (price < this.blockOpen) {
            this.discountOccurred = true;
        }

        // Q1 sweep detection: took out prev block high in Q1
        if (this.quadrant === 'Q1' && this.prevBlock) {
            if (price > this.prevBlock.high) {
                this.q1SweepOccurred = true;
            }
        }

        // --- PER-QUADRANT OHLC UPDATE ---
        this._updateQuadrantOHLC(price);

        // V2: Update micro-candles (1-minute) and macro trend
        this._updateMicroCandle(epoch, price);
        this._updateMacroTrend();

        this._lastPrice = price;
    }

    /**
     * Update the current quadrant's OHLC data.
     * Also tracks Q2 clearance of Q1 extremes and Q3 structural metadata.
     */
    _updateQuadrantOHLC(price) {
        let qData;
        switch (this.quadrant) {
            case 'Q1': qData = this.q1; break;
            case 'Q2': qData = this.q2; break;
            case 'Q3': qData = this.q3; break;
            case 'Q4': qData = this.q4; break;
        }

        // First tick in this quadrant — set open
        if (qData.open === null) {
            qData.open = price;
        }

        // Update high/low
        if (price > qData.high) {
            qData.high = price;
            // Q3: track which tick made the high
            if (this.quadrant === 'Q3') {
                this.q3.highTick = qData.tickCount;
            }
        }
        if (price < qData.low) {
            qData.low = price;
            // Q3: track which tick made the low
            if (this.quadrant === 'Q3') {
                this.q3.lowTick = qData.tickCount;
            }
        }

        // Always update close to latest price
        qData.close = price;
        qData.tickCount++;

        // --- Q2-SPECIFIC: Track clearance of Q1 extremes ---
        if (this.quadrant === 'Q2' && this.q1.tickCount > 0) {
            // Did Q2 clear Q1's high?
            if (this.q2.tickAtQ1HighClear === null && price > this.q1.high) {
                this.q2.tickAtQ1HighClear = this.q2.tickCount - 1; // 0-indexed tick within Q2
            }
            // Did Q2 clear Q1's low?
            if (this.q2.tickAtQ1LowClear === null && price < this.q1.low) {
                this.q2.tickAtQ1LowClear = this.q2.tickCount - 1;
            }
        }

        // --- Q3-SPECIFIC: Track reversal count ---
        if (this.quadrant === 'Q3') {
            this._trackQ3Reversals(price);
        }
    }

    /**
     * Count direction changes (reversals) in Q3's tick sequence.
     * Uses a minimum movement threshold to filter noise.
     */
    _trackQ3Reversals(price) {
        if (this._q3LastSignificantPrice === null) {
            this._q3LastSignificantPrice = price;
            return;
        }

        const move = price - this._q3LastSignificantPrice;
        const absMoveSize = Math.abs(move);

        // Only count moves above the noise threshold
        if (absMoveSize < this._q3ReversalThreshold) return;

        const currentDirection = move > 0 ? 'up' : 'down';

        if (this._q3LastDirection !== null && currentDirection !== this._q3LastDirection) {
            this.q3.reversalCount++;
        }

        this._q3LastDirection = currentDirection;
        this._q3LastSignificantPrice = price;
    }

    _getQuadrant(elapsed) {
        if (elapsed < 75)  return 'Q1';  // 0:00 - 1:15
        if (elapsed < 150) return 'Q2';  // 1:15 - 2:30
        if (elapsed < 225) return 'Q3';  // 2:30 - 3:45
        return 'Q4';                      // 3:45 - 5:00
    }

    _closeBlock(lastPrice) {
        if (this.blockStart === null) return;

        this.prevBlock = {
            open: this.blockOpen,
            high: this.blockHigh,
            low: this.blockLow,
            close: lastPrice,
            q4Low: this.q4Low === Infinity ? this.blockLow : this.q4Low
        };

        // Track closes for reference (V2: no longer drives trend)
        this.blockCloses.push(lastPrice);
        if (this.blockCloses.length > 3) this.blockCloses.shift();

        // V2: Show last 2 micro candles that drove trend decision
        const lastMicro = this.microCandles.slice(-2).map(c => 
            c.close > c.open ? '↑' : c.close < c.open ? '↓' : '='
        ).join('');

        console.log(`[Block] Closed at ${new Date(this.blockStart * 1000).toISOString().substr(11, 8)} | ` +
            `O:${this.blockOpen} H:${this.blockHigh} L:${this.blockLow} C:${lastPrice} | ` +
            `Q4Low:${this.prevBlock.q4Low} | Trend:${this.macroTrend} (micro:${lastMicro || 'n/a'})`);
    }

    _openBlock(start, price) {
        this.blockStart = start;
        this.blockOpen = price;
        this.blockHigh = price;
        this.blockLow = price;
        this.elapsed = 0;
        this.quadrant = 'Q1';
        this.prevQuadrant = null;
        this.inSweetZone = false;
        this.tradeCount = 0;
        this.q4Low = Infinity;
        this.discountOccurred = false;
        this.q1SweepOccurred = false;

        // Reset per-quadrant OHLC for the new block
        this._resetQuadrantData();

        console.log(`[Block] Opened at ${new Date(start * 1000).toISOString().substr(11, 8)} | Open: ${price}`);
    }

    /**
     * V2: Track 1-minute candles independently of the 5-min block cycle.
     * On candle close, push to microCandles buffer (max 5).
     */
    _updateMicroCandle(epoch, price) {
        const candleStart = Math.floor(epoch / this.microCandleDuration) * this.microCandleDuration;

        // New candle? Close the previous one first
        if (this._microCandleStart !== null && this._microCandleStart !== candleStart) {
            const closedCandle = {
                open: this._microCandleOpen,
                close: this._microCandleClose,
                time: this._microCandleStart
            };
            this.microCandles.push(closedCandle);
            if (this.microCandles.length > 5) this.microCandles.shift();

            // Log micro-candle close
            const dir = closedCandle.close > closedCandle.open ? '↑' 
                      : closedCandle.close < closedCandle.open ? '↓' : '=';
            console.log(`[Micro] ${dir} 1m candle closed | O:${closedCandle.open.toFixed(2)} C:${closedCandle.close.toFixed(2)}`);
        }

        // First ever tick or new candle — initialize
        if (this._microCandleStart === null || this._microCandleStart !== candleStart) {
            this._microCandleStart = candleStart;
            this._microCandleOpen = price;
        }

        // Always update close to latest price
        this._microCandleClose = price;
    }

    /**
     * V2: Macro trend from 2 consecutive 1-min candles closing in same direction.
     * Bullish candle = close > open
     * Bearish candle = close < open
     */
    _updateMacroTrend() {
        if (this.microCandles.length < 2) {
            this.macroTrend = 'NONE';
            return;
        }

        const recent = this.microCandles.slice(-2); // last 2 closed candles
        const allBullish = recent.every(c => c.close > c.open);
        const allBearish = recent.every(c => c.close < c.open);

        if (allBullish) this.macroTrend = 'UP';
        else if (allBearish) this.macroTrend = 'DOWN';
        else this.macroTrend = 'NONE';
    }

    getState() {
        return {
            // --- Existing block-level state (Cipher Swarm consumers unchanged) ---
            blockStart: this.blockStart,
            blockOpen: this.blockOpen,
            blockHigh: this.blockHigh,
            blockLow: this.blockLow,
            elapsed: this.elapsed,
            quadrant: this.quadrant,
            prevQuadrant: this.prevQuadrant,
            inSweetZone: this.inSweetZone,
            tradeCount: this.tradeCount,
            macroTrend: this.macroTrend,
            microCandles: this.microCandles.slice(-3), // V2: last 3 for logging
            prevBlock: this.prevBlock,
            discountOccurred: this.discountOccurred,
            q1SweepOccurred: this.q1SweepOccurred,
            q4Low: this.q4Low === Infinity ? null : this.q4Low,

            // --- Per-quadrant OHLC (Quadrant Break strategy consumers) ---
            q1: {
                open: this.q1.open,
                high: this.q1.high === -Infinity ? null : this.q1.high,
                low: this.q1.low === Infinity ? null : this.q1.low,
                close: this.q1.close,
                tickCount: this.q1.tickCount
            },
            q2: {
                open: this.q2.open,
                high: this.q2.high === -Infinity ? null : this.q2.high,
                low: this.q2.low === Infinity ? null : this.q2.low,
                close: this.q2.close,
                tickCount: this.q2.tickCount,
                tickAtQ1HighClear: this.q2.tickAtQ1HighClear,
                tickAtQ1LowClear: this.q2.tickAtQ1LowClear
            },
            q3: {
                open: this.q3.open,
                high: this.q3.high === -Infinity ? null : this.q3.high,
                low: this.q3.low === Infinity ? null : this.q3.low,
                close: this.q3.close,
                tickCount: this.q3.tickCount,
                highTick: this.q3.highTick,
                lowTick: this.q3.lowTick,
                reversalCount: this.q3.reversalCount
            },
            q4: {
                open: this.q4.open,
                high: this.q4.high === -Infinity ? null : this.q4.high,
                low: this.q4.low === Infinity ? null : this.q4.low,
                close: this.q4.close,
                tickCount: this.q4.tickCount
            }
        };
    }
}

module.exports = BlockTracker;
