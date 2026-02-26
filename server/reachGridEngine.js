/**
 * Barrier Reach Grid Engine
 * Computes empirical reach rates from a tick array based on the external reviewer spec.
 */

const DEFAULT_DISTANCES = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
const DEFAULT_HORIZONS = [30, 60, 90, 120];

/**
 * Computes the reach matrix.
 * @param {Array} ticks - Array of tick objects: [{epoch, quote}, ...] (sorted oldest to newest)
 * @param {Object} opts - Compute options
 * @returns {Object} { matrix, samplesPerHorizon }
 */
function computeReachGrid(ticks, opts = {}) {
    const {
        lookbackSec = 30 * 60, // Default 30 minutes
        stride = 10,           // Evaluate windows starting every 10 ticks
        distances = DEFAULT_DISTANCES,
        horizons = DEFAULT_HORIZONS
    } = opts;

    if (!ticks || ticks.length === 0) {
        return { matrix: [], samplesPerHorizon: {} };
    }

    const latestEpoch = ticks[ticks.length - 1].epoch;
    const cutoffEpoch = latestEpoch - lookbackSec;

    // Find the starting index for the lookback period
    let startIndex = 0;
    while (startIndex < ticks.length && ticks[startIndex].epoch < cutoffEpoch) {
        startIndex++;
    }

    const relevantTicks = ticks.slice(startIndex);
    if (relevantTicks.length === 0) return { matrix: [], samplesPerHorizon: {} };

    // Initialize tracking structures
    // matrix[dIndex][hIndex] = { up: {reached, total}, down: {reached, total}, either: {reached, total} }
    const matrixStats = distances.map(() =>
        horizons.map(() => ({
            up: { reached: 0, total: 0 },
            down: { reached: 0, total: 0 },
            either: { reached: 0, total: 0 }
        }))
    );

    const samplesPerHorizon = {};
    for (const h of horizons) samplesPerHorizon[h] = 0;

    // Evaluate windows
    for (let i = 0; i < relevantTicks.length; i += stride) {
        const startTick = relevantTicks[i];

        for (let hIndex = 0; hIndex < horizons.length; hIndex++) {
            const hSec = horizons[hIndex];
            const windowEndEpoch = startTick.epoch + hSec;

            // Only evaluate if the window has fully concluded within the available data bounds
            if (windowEndEpoch > latestEpoch) {
                continue;
            }

            samplesPerHorizon[hSec]++;

            // Find max/min within [startTick.epoch, windowEndEpoch]
            let maxPrice = startTick.quote;
            let minPrice = startTick.quote;

            // Scan forward
            for (let j = i; j < relevantTicks.length; j++) {
                if (relevantTicks[j].epoch > windowEndEpoch) break;
                const p = relevantTicks[j].quote;
                if (p > maxPrice) maxPrice = p;
                if (p < minPrice) minPrice = p;
            }

            const maxUp = maxPrice - startTick.quote;
            const maxDown = startTick.quote - minPrice;

            // Update stats for all distances
            for (let dIndex = 0; dIndex < distances.length; dIndex++) {
                const D = distances[dIndex];
                const stats = matrixStats[dIndex][hIndex];

                const reachedUp = maxUp >= D;
                const reachedDown = maxDown >= D;
                const reachedEither = reachedUp || reachedDown;

                stats.up.total++;
                stats.down.total++;
                stats.either.total++;

                if (reachedUp) stats.up.reached++;
                if (reachedDown) stats.down.reached++;
                if (reachedEither) stats.either.reached++;
            }
        }
    }

    // Convert raw counts to decimal rates (0.0 to 1.0)
    const finalMatrix = distances.map((_, dIndex) =>
        horizons.map((_, hIndex) => {
            const stats = matrixStats[dIndex][hIndex];
            return {
                up: stats.up.total > 0 ? stats.up.reached / stats.up.total : 0,
                down: stats.down.total > 0 ? stats.down.reached / stats.down.total : 0,
                either: stats.either.total > 0 ? stats.either.reached / stats.either.total : 0
            };
        })
    );

    return {
        matrix: finalMatrix,
        samplesPerHorizon,
        lookbackApplied: lookbackSec,
        distances,
        horizons,
        stride
    };
}

module.exports = {
    computeReachGrid,
    DEFAULT_DISTANCES,
    DEFAULT_HORIZONS
};
