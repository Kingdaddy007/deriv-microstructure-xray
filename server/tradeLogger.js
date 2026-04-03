/**
 * Trade Logger — Phase 4 of Cipher Swarm Bot + Quadrant Break
 *
 * Logs every trade to SQLite with full context:
 * - Block state (blockStart, quadrant, elapsed, blockOpen, macroTrend)
 * - Gate results (which passed/failed)
 * - Swarm votes (which agents voted YES, their diagnostic values)
 * - Trade execution (direction, barrier, stake, impliedProb)
 * - Outcome (won/lost, profit)
 *
 * V2: Added `strategy` column ('swarm' | 'quadrant') and `strategy_data`
 * for strategy-specific diagnostics stored as JSON.
 *
 * This is the "black box" for post-trade analysis.
 * When you lose, query here to see exactly WHY the bot entered.
 */

const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const DB_PATH = path.join(config.DATA_DIR, 'cipher_trades.db');

class TradeLogger {
    constructor() {
        this.db = new Database(DB_PATH);
        this._initSchema();
        this._prepareStatements();
    }

    _initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                
                -- Timing
                timestamp INTEGER NOT NULL,
                block_start INTEGER NOT NULL,
                quadrant TEXT NOT NULL,
                elapsed INTEGER NOT NULL,
                
                -- Block context
                block_open REAL NOT NULL,
                block_high REAL NOT NULL,
                block_low REAL NOT NULL,
                macro_trend TEXT NOT NULL,
                discount_occurred INTEGER NOT NULL,
                q1_sweep_occurred INTEGER NOT NULL,
                
                -- Previous block reference
                prev_block_high REAL,
                prev_block_low REAL,
                prev_block_q4_low REAL,
                
                -- Gate results (all true at trade time, but store for debugging)
                gate_trend INTEGER NOT NULL,
                gate_temporal INTEGER NOT NULL,
                gate_discount INTEGER NOT NULL,
                gate_killswitch INTEGER NOT NULL,
                gate_killswitch_value TEXT,
                gate_trade_limit INTEGER NOT NULL,
                
                -- Swarm votes
                vote_fast_reader INTEGER NOT NULL,
                vote_fast_reader_edge REAL,
                vote_fast_reader_sigma REAL,
                vote_steady_hand INTEGER NOT NULL,
                vote_steady_hand_edge REAL,
                vote_steady_hand_sigma REAL,
                vote_trend_surfer INTEGER NOT NULL,
                vote_trend_surfer_score REAL,
                vote_climate_check INTEGER NOT NULL,
                vote_climate_vol_ratio REAL,
                vote_climate_vol_trend TEXT,
                consensus INTEGER NOT NULL,
                consensus_trend TEXT,
                
                -- Trade execution
                direction TEXT NOT NULL,
                barrier REAL NOT NULL,
                stake REAL NOT NULL,
                implied_prob REAL NOT NULL,
                contract_id TEXT,
                buy_price REAL,
                potential_payout REAL,
                
                -- Outcome (filled in later when contract settles)
                outcome TEXT,
                payout REAL,
                profit REAL,
                settled_at INTEGER,
                
                -- Observation story (human-readable summary)
                observation TEXT,
                
                -- Index for queries
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );
            
                CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
                CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome);
                CREATE INDEX IF NOT EXISTS idx_trades_block_start ON trades(block_start);
                CREATE INDEX IF NOT EXISTS idx_trades_contract_id ON trades(contract_id);
            `);
        
        // Migration: Add account_mode column if it doesn't exist
        this._migrateAccountMode();
    }

    _migrateAccountMode() {
        // Check if column exists
        const columns = this.db.prepare("PRAGMA table_info(trades)").all();
        const hasAccountMode = columns.some(c => c.name === 'account_mode');
        
        if (!hasAccountMode) {
            console.log('[TradeLogger] Migrating: adding account_mode column...');
            this.db.exec(`
                ALTER TABLE trades ADD COLUMN account_mode TEXT DEFAULT 'demo';
            `);
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_trades_account_mode ON trades(account_mode);
            `);
            console.log('[TradeLogger] Migration complete: account_mode column added');
        }

        // V2: Add strategy column
        const hasStrategy = columns.some(c => c.name === 'strategy');
        if (!hasStrategy) {
            console.log('[TradeLogger] Migrating: adding strategy + strategy_data columns...');
            this.db.exec(`
                ALTER TABLE trades ADD COLUMN strategy TEXT DEFAULT 'swarm';
            `);
            this.db.exec(`
                ALTER TABLE trades ADD COLUMN strategy_data TEXT;
            `);
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
            `);
            console.log('[TradeLogger] Migration complete: strategy columns added');
        }

        // V3: Create evaluations table for QB SKIP/FIRE decisions
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS qb_evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                block_start INTEGER NOT NULL,
                signal TEXT NOT NULL,          -- 'FIRE' or 'SKIP'
                direction TEXT,                -- 'BUY', 'SELL', or null
                reason TEXT,
                gate_data TEXT,                -- JSON: full gate pass/fail details
                block_snapshot TEXT,           -- JSON: q1/q2/q3 OHLC snapshot
                barrier_distance REAL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );
            CREATE INDEX IF NOT EXISTS idx_qb_eval_timestamp ON qb_evaluations(timestamp);
            CREATE INDEX IF NOT EXISTS idx_qb_eval_signal ON qb_evaluations(signal);
            CREATE INDEX IF NOT EXISTS idx_qb_eval_block ON qb_evaluations(block_start);
        `);
    }

    _prepareStatements() {
        this._insertStmt = this.db.prepare(`
            INSERT INTO trades (
                timestamp, block_start, quadrant, elapsed,
                block_open, block_high, block_low, macro_trend,
                discount_occurred, q1_sweep_occurred,
                prev_block_high, prev_block_low, prev_block_q4_low,
                gate_trend, gate_temporal, gate_discount,
                gate_killswitch, gate_killswitch_value, gate_trade_limit,
                vote_fast_reader, vote_fast_reader_edge, vote_fast_reader_sigma,
                vote_steady_hand, vote_steady_hand_edge, vote_steady_hand_sigma,
                vote_trend_surfer, vote_trend_surfer_score,
                vote_climate_check, vote_climate_vol_ratio, vote_climate_vol_trend,
                consensus, consensus_trend,
                direction, barrier, stake, implied_prob,
                contract_id, buy_price, potential_payout,
                observation, account_mode
            ) VALUES (
                @timestamp, @block_start, @quadrant, @elapsed,
                @block_open, @block_high, @block_low, @macro_trend,
                @discount_occurred, @q1_sweep_occurred,
                @prev_block_high, @prev_block_low, @prev_block_q4_low,
                @gate_trend, @gate_temporal, @gate_discount,
                @gate_killswitch, @gate_killswitch_value, @gate_trade_limit,
                @vote_fast_reader, @vote_fast_reader_edge, @vote_fast_reader_sigma,
                @vote_steady_hand, @vote_steady_hand_edge, @vote_steady_hand_sigma,
                @vote_trend_surfer, @vote_trend_surfer_score,
                @vote_climate_check, @vote_climate_vol_ratio, @vote_climate_vol_trend,
                @consensus, @consensus_trend,
                @direction, @barrier, @stake, @implied_prob,
                @contract_id, @buy_price, @potential_payout,
                @observation, @account_mode
            )
        `);

        this._updateOutcomeStmt = this.db.prepare(`
            UPDATE trades
            SET outcome = @outcome,
                payout = @payout,
                profit = @profit,
                settled_at = @settled_at
            WHERE contract_id = @contract_id
        `);

        this._getByContractIdStmt = this.db.prepare(`
            SELECT * FROM trades WHERE contract_id = ?
        `);

        this._getRecentStmt = this.db.prepare(`
            SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?
        `);

        this._getLossesStmt = this.db.prepare(`
            SELECT * FROM trades WHERE outcome = 'lost' ORDER BY timestamp DESC LIMIT ?
        `);

        this._getSettledOnlyStmt = this.db.prepare(`
            SELECT * FROM trades WHERE outcome IS NOT NULL ORDER BY timestamp DESC LIMIT ?
        `);

        this._getPendingOnlyStmt = this.db.prepare(`
            SELECT * FROM trades WHERE outcome IS NULL ORDER BY timestamp DESC LIMIT ?
        `);

        this._getStatsStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END), 0) as wins,
                COALESCE(SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END), 0) as losses,
                COALESCE(SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END), 0) as pending,
                COALESCE(SUM(stake), 0) as total_staked,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN payout ELSE 0 END), 0) as total_payout,
                COALESCE(SUM(profit), 0) as net_profit,
                AVG(CASE WHEN outcome = 'won' THEN implied_prob ELSE NULL END) as avg_implied_wins,
                AVG(CASE WHEN outcome = 'lost' THEN implied_prob ELSE NULL END) as avg_implied_losses
            FROM trades
        `);

        // Date range queries (timestamps are in epoch seconds)
        this._getByDateRangeStmt = this.db.prepare(`
            SELECT * FROM trades 
            WHERE timestamp >= ? AND timestamp < ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        this._getByDateRangeAndModeStmt = this.db.prepare(`
            SELECT * FROM trades 
            WHERE timestamp >= ? AND timestamp < ? AND account_mode = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        this._getByModeStmt = this.db.prepare(`
            SELECT * FROM trades 
            WHERE account_mode = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);

        this._getStatsByDateRangeStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END), 0) as wins,
                COALESCE(SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END), 0) as losses,
                COALESCE(SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END), 0) as pending,
                COALESCE(SUM(stake), 0) as total_staked,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN payout ELSE 0 END), 0) as total_payout,
                COALESCE(SUM(profit), 0) as net_profit,
                AVG(CASE WHEN outcome = 'won' THEN implied_prob ELSE NULL END) as avg_implied_wins,
                AVG(CASE WHEN outcome = 'lost' THEN implied_prob ELSE NULL END) as avg_implied_losses
            FROM trades
            WHERE timestamp >= ? AND timestamp < ?
        `);

        this._getStatsByModeStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END), 0) as wins,
                COALESCE(SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END), 0) as losses,
                COALESCE(SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END), 0) as pending,
                COALESCE(SUM(stake), 0) as total_staked,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN payout ELSE 0 END), 0) as total_payout,
                COALESCE(SUM(profit), 0) as net_profit,
                AVG(CASE WHEN outcome = 'won' THEN implied_prob ELSE NULL END) as avg_implied_wins,
                AVG(CASE WHEN outcome = 'lost' THEN implied_prob ELSE NULL END) as avg_implied_losses
            FROM trades
            WHERE account_mode = ?
        `);
    }

    /**
     * DYNAMIC QUERY: Get trades with combined filters.
     * This is the main query method that properly combines all filters.
     * 
     * @param {Object} filters
     * @param {number} filters.from - Start epoch (seconds)
     * @param {number} filters.to - End epoch (seconds)  
     * @param {string} filters.accountMode - 'demo' or 'real'
     * @param {string} filters.status - 'settled', 'pending', or 'all'
     * @param {number} filters.limit - Max results
     */
    query(filters = {}) {
        const { from, to, accountMode, status, limit = 50 } = filters;
        
        const conditions = [];
        const params = [];
        
        // Date filter
        if (from && to) {
            conditions.push('timestamp >= ? AND timestamp < ?');
            params.push(from, to);
        }
        
        // Account mode filter
        if (accountMode && accountMode !== 'all') {
            conditions.push('account_mode = ?');
            params.push(accountMode);
        }
        
        // Strategy filter
        if (filters.strategy && filters.strategy !== 'all') {
            conditions.push('strategy = ?');
            params.push(filters.strategy);
        }

        // Status filter
        if (status === 'settled') {
            conditions.push('outcome IS NOT NULL');
        } else if (status === 'pending') {
            conditions.push('outcome IS NULL');
        }
        // 'all' means no status filter
        
        const whereClause = conditions.length > 0 
            ? `WHERE ${conditions.join(' AND ')}` 
            : '';
        
        const sql = `SELECT * FROM trades ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
        params.push(limit);
        
        return this.db.prepare(sql).all(...params);
    }

    /**
     * DYNAMIC STATS: Get stats with combined filters.
     */
    queryStats(filters = {}) {
        const { from, to, accountMode, status } = filters;
        
        const conditions = [];
        const params = [];
        
        // Date filter
        if (from && to) {
            conditions.push('timestamp >= ? AND timestamp < ?');
            params.push(from, to);
        }
        
        // Account mode filter
        if (accountMode && accountMode !== 'all') {
            conditions.push('account_mode = ?');
            params.push(accountMode);
        }
        
        // Strategy filter
        if (filters.strategy && filters.strategy !== 'all') {
            conditions.push('strategy = ?');
            params.push(filters.strategy);
        }

        // Status filter
        if (status === 'settled') {
            conditions.push('outcome IS NOT NULL');
        } else if (status === 'pending') {
            conditions.push('outcome IS NULL');
        }
        
        const whereClause = conditions.length > 0 
            ? `WHERE ${conditions.join(' AND ')}` 
            : '';
        
        const sql = `
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END), 0) as wins,
                COALESCE(SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END), 0) as losses,
                COALESCE(SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END), 0) as pending,
                COALESCE(SUM(stake), 0) as total_staked,
                COALESCE(SUM(CASE WHEN outcome = 'won' THEN payout ELSE 0 END), 0) as total_payout,
                COALESCE(SUM(profit), 0) as net_profit,
                AVG(CASE WHEN outcome = 'won' THEN implied_prob ELSE NULL END) as avg_implied_wins,
                AVG(CASE WHEN outcome = 'lost' THEN implied_prob ELSE NULL END) as avg_implied_losses
            FROM trades
            ${whereClause}
        `;
        
        return this.db.prepare(sql).get(...params);
    }

    /**
     * Helper: Get epoch range for a specific date string (YYYY-MM-DD)
     */
    static getDateRange(dateStr) {
        const date = new Date(dateStr + 'T00:00:00');
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
        return {
            from: Math.floor(startOfDay.getTime() / 1000),
            to: Math.floor(endOfDay.getTime() / 1000)
        };
    }

    /**
     * Log a trade at execution time.
     * Returns the inserted row ID.
     */
    logTrade(data) {
        const {
            timestamp,
            blockState,
            gateResult,
            swarmResult,
            direction,
            barrier,
            stake,
            impliedProb,
            contractId,
            buyPrice,
            potentialPayout,
            accountMode = 'demo'  // Default to 'demo' for backwards compatibility
        } = data;

        const observation = this._generateObservation(data);

        const params = {
            timestamp,
            block_start: blockState.blockStart,
            quadrant: blockState.quadrant,
            elapsed: blockState.elapsed,
            block_open: blockState.blockOpen,
            block_high: blockState.blockHigh,
            block_low: blockState.blockLow,
            macro_trend: blockState.macroTrend,
            discount_occurred: blockState.discountOccurred ? 1 : 0,
            q1_sweep_occurred: blockState.q1SweepOccurred ? 1 : 0,

            prev_block_high: blockState.prevBlock?.high ?? null,
            prev_block_low: blockState.prevBlock?.low ?? null,
            prev_block_q4_low: blockState.prevBlock?.q4Low ?? null,

            gate_trend: gateResult.gates.trend.pass ? 1 : 0,
            gate_temporal: gateResult.gates.temporal.pass ? 1 : 0,
            gate_discount: gateResult.gates.discount.pass ? 1 : 0,
            gate_killswitch: gateResult.gates.killSwitch.pass ? 1 : 0,
            gate_killswitch_value: gateResult.gates.killSwitch.value || null,
            gate_trade_limit: gateResult.gates.tradeLimit.pass ? 1 : 0,

            vote_fast_reader: swarmResult.votes.fastReader.vote ? 1 : 0,
            vote_fast_reader_edge: swarmResult.votes.fastReader.edge ?? null,
            vote_fast_reader_sigma: swarmResult.votes.fastReader.sigma ?? null,
            vote_steady_hand: swarmResult.votes.steadyHand.vote ? 1 : 0,
            vote_steady_hand_edge: swarmResult.votes.steadyHand.edge ?? null,
            vote_steady_hand_sigma: swarmResult.votes.steadyHand.sigma ?? null,
            vote_trend_surfer: swarmResult.votes.trendSurfer.vote ? 1 : 0,
            vote_trend_surfer_score: swarmResult.votes.trendSurfer.score ?? null,
            vote_climate_check: swarmResult.votes.climateCheck.vote ? 1 : 0,
            vote_climate_vol_ratio: swarmResult.votes.climateCheck.volRatio ?? null,
            vote_climate_vol_trend: swarmResult.votes.climateCheck.volTrend ?? null,
            consensus: swarmResult.consensus,
            consensus_trend: swarmResult.consensusTrend,

            direction,
            barrier,
            stake,
            implied_prob: impliedProb,
            contract_id: contractId,
            buy_price: buyPrice,
            potential_payout: potentialPayout,

            observation,
            account_mode: accountMode
        };

        const result = this._insertStmt.run(params);
        return result.lastInsertRowid;
    }

    /**
     * Log a Quadrant Break trade at execution time.
     * Stores gate results as JSON in strategy_data column.
     * Uses the same table with strategy='quadrant'.
     */
    logQuadrantTrade(data) {
        const {
            timestamp,
            blockState,
            direction,
            barrier,
            stake,
            contractId,
            buyPrice,
            potentialPayout,
            gates,
            signal,
            reason,
            accountMode = 'demo'
        } = data;

        // Build strategy-specific data payload
        const strategyData = JSON.stringify({
            signal,
            reason,
            gates: gates || {},
            q1: blockState.q1 || null,
            q2: blockState.q2 || null,
            q3: blockState.q3 || null
        });

        const observation = `QB ${direction} | ${reason}`;

        // Re-use the same insert — fill Cipher Swarm columns with defaults
        const params = {
            timestamp,
            block_start: blockState.blockStart,
            quadrant: blockState.quadrant,
            elapsed: blockState.elapsed,
            block_open: blockState.blockOpen,
            block_high: blockState.blockHigh,
            block_low: blockState.blockLow,
            macro_trend: blockState.macroTrend || 'NONE',
            discount_occurred: blockState.discountOccurred ? 1 : 0,
            q1_sweep_occurred: blockState.q1SweepOccurred ? 1 : 0,

            prev_block_high: blockState.prevBlock?.high ?? null,
            prev_block_low: blockState.prevBlock?.low ?? null,
            prev_block_q4_low: blockState.prevBlock?.q4Low ?? null,

            // Cipher Swarm gates — N/A for QB, fill with 0
            gate_trend: 0,
            gate_temporal: 0,
            gate_discount: 0,
            gate_killswitch: 0,
            gate_killswitch_value: null,
            gate_trade_limit: 0,

            // Cipher Swarm votes — N/A for QB, fill with 0
            vote_fast_reader: 0,
            vote_fast_reader_edge: null,
            vote_fast_reader_sigma: null,
            vote_steady_hand: 0,
            vote_steady_hand_edge: null,
            vote_steady_hand_sigma: null,
            vote_trend_surfer: 0,
            vote_trend_surfer_score: null,
            vote_climate_check: 0,
            vote_climate_vol_ratio: null,
            vote_climate_vol_trend: null,
            consensus: 0,
            consensus_trend: null,

            direction,
            barrier,
            stake,
            implied_prob: 0,  // QB doesn't use implied probability
            contract_id: contractId,
            buy_price: buyPrice,
            potential_payout: potentialPayout,

            observation,
            account_mode: accountMode
        };

        const result = this._insertStmt.run(params);

        // Update strategy + strategy_data columns
        this.db.prepare(`
            UPDATE trades SET strategy = 'quadrant', strategy_data = ? WHERE id = ?
        `).run(strategyData, result.lastInsertRowid);

        return result.lastInsertRowid;
    }

    /**
     * Log a Quadrant Break evaluation (FIRE or SKIP).
     * Every block evaluation gets a row — win, lose, or skip.
     */
    logEvaluation(data) {
        const { timestamp, blockStart, signal, direction, reason, gates, blockState, barrierDistance } = data;

        const gateData = JSON.stringify(gates || {});
        const blockSnapshot = JSON.stringify({
            q1: blockState?.q1 || null,
            q2: blockState?.q2 || null,
            q3: blockState?.q3 || null,
            blockOpen: blockState?.blockOpen,
            blockHigh: blockState?.blockHigh,
            blockLow: blockState?.blockLow
        });

        this.db.prepare(`
            INSERT INTO qb_evaluations (timestamp, block_start, signal, direction, reason, gate_data, block_snapshot, barrier_distance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(timestamp, blockStart, signal, direction || null, reason, gateData, blockSnapshot, barrierDistance || null);
    }

    /**
     * Update trade with outcome when contract settles.
     */
    updateOutcome(contractId, outcome, payout, profit) {
        this._updateOutcomeStmt.run({
            contract_id: contractId,
            outcome,
            payout: payout ?? null,
            profit: profit ?? null,
            settled_at: Math.floor(Date.now() / 1000)
        });
    }

    /**
     * Get trade by contract ID.
     */
    getByContractId(contractId) {
        return this._getByContractIdStmt.get(contractId);
    }

    /**
     * Get recent trades.
     */
    getRecent(limit = 20) {
        return this._getRecentStmt.all(limit);
    }

    /**
     * Get recent losses (for debugging).
     */
    getLosses(limit = 10) {
        return this._getLossesStmt.all(limit);
    }

    /**
     * Get only settled trades (outcome is not null).
     * Use this to avoid showing pending trades that might appear as "duplicates"
     * when displayed alongside their settled version.
     */
    getSettledOnly(limit = 50) {
        return this._getSettledOnlyStmt.all(limit);
    }

    /**
     * Get only pending trades (outcome is null).
     */
    getPendingOnly(limit = 50) {
        return this._getPendingOnlyStmt.all(limit);
    }

    /**
     * Get aggregate stats.
     */
    getStats(options = {}) {
        const { from, to, accountMode } = options;
        
        if (from && to) {
            return this._getStatsByDateRangeStmt.get(from, to);
        }
        if (accountMode) {
            return this._getStatsByModeStmt.get(accountMode);
        }
        return this._getStatsStmt.get();
    }

    /**
     * Get trades by date range.
     * @param {number} from - Start epoch (seconds)
     * @param {number} to - End epoch (seconds)
     * @param {number} limit - Max results
     * @param {string} accountMode - 'demo' or 'real' (optional)
     */
    getByDateRange(from, to, limit = 50, accountMode = null) {
        if (accountMode) {
            return this._getByDateRangeAndModeStmt.all(from, to, accountMode, limit);
        }
        return this._getByDateRangeStmt.all(from, to, limit);
    }

    /**
     * Get trades by account mode.
     * @param {string} accountMode - 'demo' or 'real'
     * @param {number} limit - Max results
     */
    getByMode(accountMode, limit = 50) {
        return this._getByModeStmt.all(accountMode, limit);
    }

    /**
     * Helper: Get epoch range for "today" (local timezone)
     */
    static getTodayRange() {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
        return {
            from: Math.floor(startOfDay.getTime() / 1000),
            to: Math.floor(endOfDay.getTime() / 1000)
        };
    }

    /**
     * Helper: Get epoch range for "yesterday" (local timezone)
     */
    static getYesterdayRange() {
        const now = new Date();
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return {
            from: Math.floor(startOfYesterday.getTime() / 1000),
            to: Math.floor(endOfYesterday.getTime() / 1000)
        };
    }

    /**
     * Generate a human-readable observation story.
     * This is the "why" for each trade — useful for journal review.
     */
    _generateObservation(data) {
        const { blockState, swarmResult, direction, impliedProb, barrier } = data;

        const parts = [];

        // Timing context
        parts.push(`${blockState.quadrant} @ ${blockState.elapsed}s`);

        // Trend context
        parts.push(`trend=${blockState.macroTrend}`);

        // Setup context
        if (blockState.q1SweepOccurred) {
            parts.push('Q1-sweep-recovered');
        }
        if (blockState.discountOccurred) {
            parts.push('discount-formed');
        }

        // Agent summary
        const agentYes = [];
        const agentNo = [];
        if (swarmResult.votes.fastReader.vote) {
            agentYes.push(`FR(${swarmResult.votes.fastReader.edge?.toFixed(2) || '?'})`);
        } else {
            agentNo.push('FR');
        }
        if (swarmResult.votes.steadyHand.vote) {
            agentYes.push(`SH(${swarmResult.votes.steadyHand.edge?.toFixed(2) || '?'})`);
        } else {
            agentNo.push('SH');
        }
        if (swarmResult.votes.trendSurfer.vote) {
            agentYes.push(`TS(${swarmResult.votes.trendSurfer.score?.toFixed(2) || '?'})`);
        } else {
            agentNo.push('TS');
        }
        if (swarmResult.votes.climateCheck.vote) {
            agentYes.push('CC');
        } else {
            agentNo.push('CC');
        }

        parts.push(`votes=${swarmResult.consensus}/4`);
        if (agentYes.length > 0) parts.push(`yes=[${agentYes.join(',')}]`);
        if (agentNo.length > 0) parts.push(`no=[${agentNo.join(',')}]`);

        // Edge context
        parts.push(`implProb=${(impliedProb * 100).toFixed(1)}%`);
        parts.push(`barrier=${barrier}`);
        parts.push(`dir=${direction}`);

        return parts.join(' | ');
    }

    /**
     * Close the database connection.
     */
    close() {
        this.db.close();
    }
}

module.exports = TradeLogger;
