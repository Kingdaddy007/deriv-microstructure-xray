/**
 * Config — Central configuration for the Touch Edge System
 */
const path = require('path');

module.exports = {
    // Deriv API Configuration
    DERIV_APP_ID: process.env.DERIV_APP_ID || 1089,
    DERIV_API_TOKEN: process.env.DERIV_API_TOKEN || '',
    DERIV_WS_URL: 'wss://ws.derivws.com/websockets/v3',

    // Target Symbols
    SYMBOLS: {
        V75_1S: '1HZ75V',
        V100_1S: '1HZ100V'
    },

    // Tick Buffer Size (~50 minutes of 1-second ticks)
    MAX_TICK_HISTORY: 3000,

    // Volatility calculation windows (in ticks = seconds for 1s indices)
    VOL_WINDOWS: [10, 30, 60, 120, 300],

    // Baseline reference window for vol ratio
    VOL_BASELINE_WINDOW: 300,

    // Short-term window for vol ratio numerator
    VOL_SHORT_WINDOW: 30,

    // Touch option window (120 ticks = 2 minutes)
    TOUCH_WINDOW_TICKS: 120,

    // Edge signal thresholds
    EDGE_STRONG: 0.10,    // >= 10% edge
    EDGE_MODERATE: 0.05,  // >= 5% edge
    EDGE_MINIMUM: 0.03,   // >= 3% edge

    // Momentum window
    MOMENTUM_WINDOW: 10,

    // Warmup: need at least 300 ticks before signals are valid
    WARMUP_TICKS: 300,

    // Server Settings
    PORT: process.env.PORT || 8080,

    // Dashboard update interval (ms)
    DASHBOARD_UPDATE_INTERVAL: 1000,

    // Data Storage
    DATA_DIR: path.join(__dirname, '..', 'data'),
    DB_PATH: path.join(__dirname, '..', 'data', 'ticks.db')
};
