const { computeReachGrid } = require('./reachGridEngine');

describe('Barrier Reach Grid Engine', () => {
    test('Correctly computes reach rates for a specific path (Correctness Spot-Check)', () => {
        // Create a synthetic tick path where 1 tick = 1 second
        // Path starts at 100, goes up to 102.5, drops to 98, ends at 100
        const ticks = [];
        let price = 100;
        let epoch = 10000;
        for (let i = 0; i <= 120; i++) {
            if (i <= 30) price += (2.5 / 30); // Reach 102.5 at t=30
            else if (i <= 90) price -= (4.5 / 60); // Drop to 98.0 at t=90
            else price += (2.0 / 30); // Recover to 100.0 at t=120

            ticks.push({ epoch, quote: price });
            epoch++;
        }

        // Test Options
        const opts = {
            lookbackSec: 300,
            stride: 1, // Evaluate every single tick for easier mental math
            distances: [1.0, 2.0, 3.0],
            horizons: [30, 60, 120]
        };

        const result = computeReachGrid(ticks, opts);

        // Let's spot check start tick 0 (epoch 10000, price 100)
        // At horizon 30s: it reaches price 102.5. 
        // maxUp = +2.5, maxDown = 0

        // Just check the general layout first
        expect(result.matrix.length).toBe(3); // 3 distances
        expect(result.matrix[0].length).toBe(3); // 3 horizons

        // We only have 1 evaluated window for Horizon 120s if length is 121 and stride is 1
        expect(result.samplesPerHorizon[120]).toBe(1);

        // For that single 120s window (starting at t=0):
        // max price attained is 102.5 (maxUp = +2.5)
        // min price attained is 98.0 (maxDown = +2.0)
        // D=1.0: Both up and down hit.
        // D=2.0: Both up and down hit.
        // D=3.0: Neither hit.

        // Get D=2.0 (index 1), H=120 (index 2)
        const cell_2_120 = result.matrix[1][2];
        expect(cell_2_120.up).toBe(1);     // Hit 102.5 (>= +2.0)
        expect(cell_2_120.down).toBe(1);   // Hit 98.0 (>= +2.0 down)
        expect(cell_2_120.either).toBe(1); // Obviously 1

        // Get D=3.0 (index 2), H=120 (index 2)
        const cell_3_120 = result.matrix[2][2];
        expect(cell_3_120.up).toBe(0);     // Never hit 103
        expect(cell_3_120.down).toBe(0);   // Never hit 97
        expect(cell_3_120.either).toBe(0); // Never hit either
    });

    test('Ignores incomplete windows', () => {
        const ticks = [];
        let epoch = 10000;
        for (let i = 0; i < 50; i++) {
            ticks.push({ epoch, quote: 100 });
            epoch++;
        }

        const opts = { lookbackSec: 100, stride: 1, distances: [1], horizons: [30, 60] };
        const result = computeReachGrid(ticks, opts);

        // We have 50 ticks (49 seconds of data).
        // H=30s should have windows evaluated (starts from t=0 to t=19) -> 20 windows
        expect(result.samplesPerHorizon[30]).toBe(20);

        // H=60s should have NO windows evaluated because the total dataset is only 49 seconds long!
        expect(result.samplesPerHorizon[60]).toBe(0);
    });
});
