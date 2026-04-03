/**
 * Quadrant Break Strategy Tests
 *
 * Run: npm test -- quadrantBreakStrategy
 *
 * Tests all 5 gates with known OHLC inputs.
 * No live data, no side effects — pure logic validation.
 */

const QuadrantBreakStrategy = require('./quadrantBreakStrategy');

// ── Test Data Factories ───────────────────────────────────────

function makeBlockState(overrides = {}) {
    return {
        blockOpen: 1000.00,
        blockHigh: 1002.00,
        blockLow: 998.00,
        quadrant: 'Q4',
        prevQuadrant: 'Q3',
        q1: {
            open: 1000.00, high: 1001.00, low: 999.50, close: 1000.20,
            tickCount: 20,
            ...(overrides.q1 || {})
        },
        q2: {
            open: 1000.20, high: 1001.50, low: 999.00, close: 1001.30,
            tickCount: 20,
            tickAtQ1HighClear: 2,   // Cleared Q1 high at tick 2 (early)
            tickAtQ1LowClear: 3,    // Cleared Q1 low at tick 3
            ...(overrides.q2 || {})
        },
        q3: {
            open: 1001.30, high: 1002.00, low: 999.80, close: 1001.80,
            tickCount: 20,
            highTick: 15,           // High made late (SPRING for BUY)
            lowTick: 5,             // Low made early
            reversalCount: 2,
            ...(overrides.q3 || {})
        },
        ...(overrides.root || {})
    };
}

// ── Gate 0: Q1 Structure ──────────────────────────────────────

describe('Gate 0: Q1 Structure', () => {
    const strategy = new QuadrantBreakStrategy();

    test('Ranging Q1 passes (low body/range ratio)', () => {
        // open≈close, wide range → low ratio → ranging
        const state = makeBlockState({
            q1: { open: 1000.00, high: 1001.50, low: 999.00, close: 1000.10, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate0.passed).toBe(true);
    });

    test('Trending Q1 fails (high body/range ratio)', () => {
        // open far from close, tight range → high ratio → trending
        const state = makeBlockState({
            q1: { open: 999.00, high: 1001.50, low: 998.90, close: 1001.40, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate0.passed).toBe(false);
        expect(result.gates.gate0.value).toBeGreaterThan(0.80);
    });

    test('Tight consolidation passes regardless of ratio', () => {
        const state = makeBlockState({
            q1: { open: 1000.00, high: 1000.04, low: 1000.00, close: 1000.04, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate0.passed).toBe(true);
    });
});

// ── Gate 1: Q1 Clearance ──────────────────────────────────────

describe('Gate 1: Q1 Clearance', () => {
    const strategy = new QuadrantBreakStrategy();

    test('Early clearance passes (BUY direction)', () => {
        const state = makeBlockState({
            q2: { tickAtQ1HighClear: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate1.passed).toBe(true);
    });

    test('Late clearance fails', () => {
        const state = makeBlockState({
            q2: { tickAtQ1HighClear: 15, tickAtQ1LowClear: 15, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate1.passed).toBe(false);
    });

    test('No clearance at all fails', () => {
        const state = makeBlockState({
            q2: { tickAtQ1HighClear: null, tickAtQ1LowClear: null, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate1.passed).toBe(false);
    });
});

// ── Gate 2: Q3 Rejection ──────────────────────────────────────

describe('Gate 2: Q3 Rejection', () => {
    const strategy = new QuadrantBreakStrategy();

    test('Clean breakout with low snap-back passes', () => {
        // BUY: Q3 high above Q2 high, close near high → low snap-back
        const state = makeBlockState({
            q2: { high: 1001.50 },
            q3: { high: 1002.50, close: 1002.30, low: 1000.50, highTick: 15, lowTick: 5, reversalCount: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate2.passed).toBe(true);
    });

    test('Violent snap-back fails', () => {
        // BUY: Q3 high above Q2 high, but close drops back below → huge snap-back
        const state = makeBlockState({
            q2: { high: 1001.50 },
            q3: { high: 1002.50, close: 1000.80, low: 1000.50, highTick: 15, lowTick: 5, reversalCount: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate2.passed).toBe(false);
    });
});

// ── Gate 3: Q3 Energy ─────────────────────────────────────────

describe('Gate 3: Q3 Energy', () => {
    const strategy = new QuadrantBreakStrategy();

    test('Clean directional energy passes', () => {
        const state = makeBlockState({
            q3: { reversalCount: 2, high: 1002.00, low: 999.80, close: 1001.50,
                  highTick: 15, lowTick: 5, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate3.passed).toBe(true);
    });

    test('Too many reversals fails', () => {
        const state = makeBlockState({
            q3: { reversalCount: 6, high: 1002.00, low: 999.80, close: 1001.50,
                  highTick: 15, lowTick: 5, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate3.passed).toBe(false);
    });

    test('Close on wrong side of midpoint fails', () => {
        // BUY direction but Q3 close below midpoint
        const state = makeBlockState({
            q3: { reversalCount: 2, high: 1002.00, low: 999.80, close: 1000.50,
                  highTick: 15, lowTick: 5, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate3.passed).toBe(false);
    });
});

// ── Gate 4: Exhaustion ────────────────────────────────────────

describe('Gate 4: Exhaustion', () => {
    const strategy = new QuadrantBreakStrategy();

    test('Normal displacement passes', () => {
        const state = makeBlockState({
            root: { blockOpen: 1000.00 },
            q3: { close: 1002.00 }
        });
        // displacement = 2.0, limit = 1.6 * 5 = 8.0 → passes
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate4.passed).toBe(true);
    });

    test('Over-extended market fails', () => {
        const state = makeBlockState({
            root: { blockOpen: 1000.00 },
            q3: { close: 1010.00 }
        });
        // displacement = 10.0, limit = 1.6 * 5 = 8.0 → fails
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate4.passed).toBe(false);
    });
});

// ── Direction Determination ───────────────────────────────────

describe('Direction Determination', () => {
    const strategy = new QuadrantBreakStrategy();

    test('Q3 broke Q2 high → BUY', () => {
        const state = makeBlockState({
            q2: { high: 1001.50, low: 999.50 },
            q3: { high: 1002.50, low: 999.80, close: 1002.00, highTick: 15, lowTick: 5, reversalCount: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.direction).toBe('BUY');
    });

    test('Q3 broke Q2 low → SELL', () => {
        const state = makeBlockState({
            q2: { high: 1001.50, low: 999.50, tickAtQ1HighClear: 2, tickAtQ1LowClear: 2, tickCount: 20 },
            q3: { high: 1001.00, low: 998.50, close: 998.80, highTick: 5, lowTick: 15, reversalCount: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.direction).toBe('SELL');
    });

    test('Q3 broke neither → null direction, SKIP', () => {
        const state = makeBlockState({
            q2: { high: 1001.50, low: 999.50 },
            q3: { high: 1001.00, low: 999.80, close: 1000.50, highTick: 10, lowTick: 10, reversalCount: 1, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.direction).toBeNull();
        expect(result.signal).toBe('SKIP');
    });
});

// ── Full Signal Tests ─────────────────────────────────────────

describe('Full Signal', () => {
    test('All gates pass → FIRE', () => {
        const strategy = new QuadrantBreakStrategy();
        // Default makeBlockState is designed to pass all gates
        const state = makeBlockState();
        const result = strategy.evaluate(state, 1.6);
        expect(result.signal).toBe('FIRE');
        expect(result.direction).toBe('BUY');
        expect(result.gates.gate0.passed).toBe(true);
        expect(result.gates.gate1.passed).toBe(true);
        expect(result.gates.gate2.passed).toBe(true);
        expect(result.gates.gate3.passed).toBe(true);
        expect(result.gates.gate4.passed).toBe(true);
    });

    test('Incomplete data → SKIP', () => {
        const strategy = new QuadrantBreakStrategy();
        const state = { q1: null, q2: null, q3: null, blockOpen: 1000 };
        const result = strategy.evaluate(state, 1.6);
        expect(result.signal).toBe('SKIP');
        expect(result.reason).toContain('Incomplete');
    });

    test('Config override changes gate behavior', () => {
        // Set q1BodyRatioMax very low so a normal Q1 fails
        const strategy = new QuadrantBreakStrategy({ q1BodyRatioMax: 0.01 });
        const state = makeBlockState({
            q1: { open: 1000.00, high: 1001.00, low: 999.50, close: 1000.20, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.signal).toBe('SKIP');
        expect(result.gates.gate0.passed).toBe(false);
    });
});

// ── q3CloseSideThreshold (Fix #8 verification) ───────────────

describe('q3CloseSideThreshold config', () => {
    test('Default threshold (0.50) = midpoint check', () => {
        const strategy = new QuadrantBreakStrategy();
        // Q3 close slightly above midpoint → should pass for BUY
        const state = makeBlockState({
            q3: { high: 1002.00, low: 999.00, close: 1000.60,
                  highTick: 15, lowTick: 5, reversalCount: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate3.passed).toBe(true);
    });

    test('Higher threshold (0.70) requires close further toward extreme', () => {
        const strategy = new QuadrantBreakStrategy({ q3CloseSideThreshold: 0.70 });
        // Q3 close at 1000.60 → 53.3% of range from low → below 70% threshold → FAIL
        const state = makeBlockState({
            q3: { high: 1002.00, low: 999.00, close: 1000.60,
                  highTick: 15, lowTick: 5, reversalCount: 2, tickCount: 20 }
        });
        const result = strategy.evaluate(state, 1.6);
        expect(result.gates.gate3.passed).toBe(false);
    });
});
