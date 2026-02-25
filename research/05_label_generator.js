/**
 * Label Generator & Feature Extractor
 * 
 * Processes the raw historical ticks database to create a labeled dataset for ML/Validation.
 * For each tick `t`, it calculates:
 * 1. FEATURES (past-only): Velocity, Acceleration, Compression
 * 2. LABELS (future-only): mfe_up_120, mfe_down_120
 * 
 * Saves the enriched data to `mfe_dataset` table.
 */

const Database = require('better-sqlite3');
const config = require('../server/config');
const fs = require('fs');

if (!fs.existsSync(config.DB_PATH)) {
    console.error('Tick database not found. Run download script first.');
    process.exit(1);
}

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');

// We create a new table for the labeled features
db.exec(`
  CREATE TABLE IF NOT EXISTS mfe_dataset (
    symbol TEXT,
    epoch INTEGER,
    quote REAL,
    vel10 REAL,
    vel30 REAL,
    vel60 REAL,
    accel REAL,
    comp60 REAL,
    mfe_up_120 REAL,
    mfe_down_120 REAL,
    PRIMARY KEY (symbol, epoch)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_mfe_symbol_epoch ON mfe_dataset(symbol, epoch)');

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO mfe_dataset (symbol, epoch, quote, vel10, vel30, vel60, accel, comp60, mfe_up_120, mfe_down_120)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((rows) => {
    for (const r of rows) {
        insertStmt.run(r.symbol, r.epoch, r.quote, r.vel10, r.vel30, r.vel60, r.accel, r.comp60, r.mfe_up_120, r.mfe_down_120);
    }
});

function processSymbol(symbol) {
    console.log(`\n=== Processing ${symbol} ===`);

    // Load ticks into memory. Be careful if it's 5 days (432,000 ticks) - this is fine for Node.js (a few MB)
    const ticks = db.prepare('SELECT epoch, quote FROM ticks WHERE symbol = ? ORDER BY epoch ASC').all(symbol);

    if (ticks.length < 200) {
        console.log(`Not enough ticks for ${symbol}`);
        return;
    }

    console.log(`Loaded ${ticks.length} ticks into memory. Calculating features and labels...`);

    const F_WINDOW_MAX = 60; // Max lookback for features
    const L_WINDOW_MAX = 120; // Max lookforward for labels

    const dataset = [];

    // We can only calculate full features and labels for ticks that have enough past and future data
    for (let i = F_WINDOW_MAX; i < ticks.length - L_WINDOW_MAX; i++) {
        const t = ticks[i];
        const quote = t.quote;

        // --- FEATURES (Past 60 ticks) ---
        const p10 = ticks[i - 10].quote;
        const p30 = ticks[i - 30].quote;
        const p60 = ticks[i - 60].quote;

        // Net change points
        const vel10 = quote - p10;
        const vel30 = quote - p30;
        const vel60 = quote - p60;

        // Acceleration: difference between recent velocity (10-tick) and normalized older velocity (30-tick)
        // vel30 covers 3x the time, so divided by 3 it's the comparable "baseline" speed
        const accel = vel10 - (vel30 / 3);

        // Compression: Highest high minus lowest low over last 60 ticks
        let max60 = quote;
        let min60 = quote;
        for (let j = i - 60; j <= i; j++) {
            const p = ticks[j].quote;
            if (p > max60) max60 = p;
            if (p < min60) min60 = p;
        }
        const comp60 = max60 - min60;

        // --- LABELS (Future 120 ticks) ---
        let maxF = quote;
        let minF = quote;
        for (let j = i + 1; j <= i + L_WINDOW_MAX; j++) {
            const p = ticks[j].quote;
            if (p > maxF) maxF = p;
            if (p < minF) minF = p;
        }

        const mfe_up_120 = maxF - quote;
        const mfe_down_120 = quote - minF;

        dataset.push({
            symbol,
            epoch: t.epoch,
            quote,
            vel10,
            vel30,
            vel60,
            accel,
            comp60,
            mfe_up_120,
            mfe_down_120
        });

        if (dataset.length >= 10000) {
            insertMany(dataset);
            dataset.length = 0; // Clear array
            process.stdout.write('.');
        }
    }

    if (dataset.length > 0) {
        insertMany(dataset);
    }

    console.log(`\nFinished ${symbol}. Total labeled rows stored.`);
}

console.log('Generating Labeled Dataset...');
processSymbol(config.SYMBOLS.V75_1S);
processSymbol(config.SYMBOLS.V100_1S);
db.close();
console.log('Done.');
