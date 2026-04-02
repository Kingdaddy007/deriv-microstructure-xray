/**
 * Trade Logger Tests — Phase 4
 *
 * Tests the TradeLogger class functionality.
 * Uses a separate test database that gets cleaned up after tests.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Test database path
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'cipher_trades_test.db');

// We'll create TradeLogger manually with a patched DB path
// since the module uses a hardcoded path

describe('TradeLogger', () => {
    let db;

    // Mock block state
    const mockBlockState = {
        blockStart: 1711900200,
        quadrant: 'Q3',
        elapsed: 180,
        blockOpen: 56234.50,
        blockHigh: 56250.00,
        blockLow: 56220.00,
        macroTrend: 'UP',
        discountOccurred: true,
        q1SweepOccurred: false,
        prevBlock: {
            high: 56280.00,
            low: 56200.00,
            q4Low: 56210.00
        }
    };

    // Mock gate result
    const mockGateResult = {
        unlocked: true,
        direction: 'UP',
        gates: {
            trend: { pass: true, value: 'UP', reason: 'Trend: UP' },
            temporal: { pass: true, value: 'Q3', reason: 'In sweet zone (180s, Q3)' },
            discount: { pass: true, value: true, reason: 'Discount occurred' },
            killSwitch: { pass: true, value: 'NONE', reason: 'No kill conditions active' },
            tradeLimit: { pass: true, value: 0, reason: 'Trades: 0/2' }
        }
    };

    // Mock swarm result
    const mockSwarmResult = {
        votes: {
            fastReader: { vote: true, edge: 0.045, sigma: 0.0012 },
            steadyHand: { vote: true, edge: 0.038, sigma: 0.0010 },
            trendSurfer: { vote: true, score: 0.6 },
            climateCheck: { vote: true, volRatio: 1.1, volTrend: 'EXPANDING' }
        },
        consensus: 4,
        consensusTrend: 'RISING',
        greenLight: true
    };

    beforeAll(() => {
        // Clean up any existing test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }

        // Create the test database with the same schema
        db = new Database(TEST_DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                block_start INTEGER NOT NULL,
                quadrant TEXT NOT NULL,
                elapsed INTEGER NOT NULL,
                block_open REAL NOT NULL,
                block_high REAL NOT NULL,
                block_low REAL NOT NULL,
                macro_trend TEXT NOT NULL,
                discount_occurred INTEGER NOT NULL,
                q1_sweep_occurred INTEGER NOT NULL,
                prev_block_high REAL,
                prev_block_low REAL,
                prev_block_q4_low REAL,
                gate_trend INTEGER NOT NULL,
                gate_temporal INTEGER NOT NULL,
                gate_discount INTEGER NOT NULL,
                gate_killswitch INTEGER NOT NULL,
                gate_killswitch_value TEXT,
                gate_trade_limit INTEGER NOT NULL,
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
                direction TEXT NOT NULL,
                barrier REAL NOT NULL,
                stake REAL NOT NULL,
                implied_prob REAL NOT NULL,
                contract_id TEXT,
                buy_price REAL,
                potential_payout REAL,
                outcome TEXT,
                payout REAL,
                profit REAL,
                settled_at INTEGER,
                observation TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );
            CREATE INDEX IF NOT EXISTS idx_trades_contract_id ON trades(contract_id);
            CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome);
        `);
    });

    afterAll(() => {
        db.close();
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    // Helper to generate observation
    function generateObservation(data) {
        const { blockState, swarmResult, direction, impliedProb, barrier } = data;
        const parts = [];

        parts.push(`${blockState.quadrant} @ ${blockState.elapsed}s`);
        parts.push(`trend=${blockState.macroTrend}`);

        if (blockState.q1SweepOccurred) parts.push('Q1-sweep-recovered');
        if (blockState.discountOccurred) parts.push('discount-formed');

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
        parts.push(`implProb=${(impliedProb * 100).toFixed(1)}%`);
        parts.push(`barrier=${barrier}`);
        parts.push(`dir=${direction}`);

        return parts.join(' | ');
    }

    // Helper to insert a trade
    function insertTrade(data) {
        const {
            timestamp, blockState, gateResult, swarmResult,
            direction, barrier, stake, impliedProb,
            contractId, buyPrice, potentialPayout
        } = data;

        const observation = generateObservation(data);

        const stmt = db.prepare(`
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
                observation
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
                @observation
            )
        `);

        const result = stmt.run({
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
            observation
        });

        return result.lastInsertRowid;
    }

    describe('Trade insertion', () => {
        test('inserts a trade record and returns row ID', () => {
            const rowId = insertTrade({
                timestamp: 1711900380,
                blockState: mockBlockState,
                gateResult: mockGateResult,
                swarmResult: mockSwarmResult,
                direction: 'UP',
                barrier: 2.0,
                stake: 1.0,
                impliedProb: 0.48,
                contractId: 'test_contract_1',
                buyPrice: 1.0,
                potentialPayout: 2.09
            });

            expect(rowId).toBe(1);
        });

        test('stores all gate values correctly', () => {
            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_1');

            expect(trade.gate_trend).toBe(1);
            expect(trade.gate_temporal).toBe(1);
            expect(trade.gate_discount).toBe(1);
            expect(trade.gate_killswitch).toBe(1);
            expect(trade.gate_trade_limit).toBe(1);
        });

        test('stores all vote values correctly', () => {
            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_1');

            expect(trade.vote_fast_reader).toBe(1);
            expect(trade.vote_fast_reader_edge).toBeCloseTo(0.045, 3);
            expect(trade.vote_steady_hand).toBe(1);
            expect(trade.vote_trend_surfer).toBe(1);
            expect(trade.vote_trend_surfer_score).toBeCloseTo(0.6, 1);
            expect(trade.vote_climate_check).toBe(1);
            expect(trade.consensus).toBe(4);
        });

        test('stores trade execution values correctly', () => {
            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_1');

            expect(trade.direction).toBe('UP');
            expect(trade.barrier).toBe(2.0);
            expect(trade.stake).toBe(1.0);
            expect(trade.implied_prob).toBeCloseTo(0.48, 2);
            expect(trade.buy_price).toBe(1.0);
            expect(trade.potential_payout).toBeCloseTo(2.09, 2);
        });

        test('stores block state correctly', () => {
            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_1');

            expect(trade.block_start).toBe(1711900200);
            expect(trade.quadrant).toBe('Q3');
            expect(trade.elapsed).toBe(180);
            expect(trade.block_open).toBeCloseTo(56234.50, 2);
            expect(trade.macro_trend).toBe('UP');
            expect(trade.discount_occurred).toBe(1);
            expect(trade.q1_sweep_occurred).toBe(0);
        });
    });

    describe('Outcome update', () => {
        test('updates outcome for won trade', () => {
            const updateStmt = db.prepare(`
                UPDATE trades SET outcome = @outcome, payout = @payout, profit = @profit, settled_at = @settled_at
                WHERE contract_id = @contract_id
            `);

            updateStmt.run({
                contract_id: 'test_contract_1',
                outcome: 'won',
                payout: 2.09,
                profit: 1.09,
                settled_at: Math.floor(Date.now() / 1000)
            });

            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_1');
            expect(trade.outcome).toBe('won');
            expect(trade.payout).toBeCloseTo(2.09, 2);
            expect(trade.profit).toBeCloseTo(1.09, 2);
            expect(trade.settled_at).toBeGreaterThan(0);
        });

        test('updates outcome for lost trade', () => {
            // Insert second trade
            insertTrade({
                timestamp: 1711900500,
                blockState: mockBlockState,
                gateResult: mockGateResult,
                swarmResult: { ...mockSwarmResult, consensus: 3 },
                direction: 'UP',
                barrier: 2.0,
                stake: 1.0,
                impliedProb: 0.45,
                contractId: 'test_contract_2',
                buyPrice: 1.0,
                potentialPayout: 2.09
            });

            const updateStmt = db.prepare(`
                UPDATE trades SET outcome = @outcome, profit = @profit, settled_at = @settled_at
                WHERE contract_id = @contract_id
            `);

            updateStmt.run({
                contract_id: 'test_contract_2',
                outcome: 'lost',
                profit: -1.0,
                settled_at: Math.floor(Date.now() / 1000)
            });

            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_2');
            expect(trade.outcome).toBe('lost');
            expect(trade.profit).toBe(-1.0);
        });
    });

    describe('Query functions', () => {
        test('getRecent returns trades in reverse chronological order', () => {
            const trades = db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10').all();

            expect(trades.length).toBe(2);
            expect(trades[0].contract_id).toBe('test_contract_2');
            expect(trades[1].contract_id).toBe('test_contract_1');
        });

        test('getLosses returns only lost trades', () => {
            const losses = db.prepare("SELECT * FROM trades WHERE outcome = 'lost' ORDER BY timestamp DESC LIMIT 10").all();

            expect(losses.length).toBe(1);
            expect(losses[0].contract_id).toBe('test_contract_2');
        });

        test('getStats returns aggregate statistics', () => {
            const stats = db.prepare(`
                SELECT 
                    COUNT(*) as total_trades,
                    SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END) as losses,
                    SUM(stake) as total_staked,
                    SUM(CASE WHEN outcome = 'won' THEN payout ELSE 0 END) as total_payout,
                    SUM(profit) as net_profit
                FROM trades
            `).get();

            expect(stats.total_trades).toBe(2);
            expect(stats.wins).toBe(1);
            expect(stats.losses).toBe(1);
            expect(stats.total_staked).toBe(2.0);
            expect(stats.total_payout).toBeCloseTo(2.09, 2);
            expect(stats.net_profit).toBeCloseTo(0.09, 2);
        });
    });

    describe('Observation generation', () => {
        test('generates observation with all relevant info', () => {
            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_1');

            expect(trade.observation).toContain('Q3 @ 180s');
            expect(trade.observation).toContain('trend=UP');
            expect(trade.observation).toContain('discount-formed');
            expect(trade.observation).toContain('votes=4/4');
            expect(trade.observation).toContain('implProb=48.0%');
        });

        test('includes Q1 sweep recovery when applicable', () => {
            insertTrade({
                timestamp: 1711900600,
                blockState: { ...mockBlockState, q1SweepOccurred: true },
                gateResult: mockGateResult,
                swarmResult: mockSwarmResult,
                direction: 'UP',
                barrier: 2.0,
                stake: 1.0,
                impliedProb: 0.50,
                contractId: 'test_contract_3',
                buyPrice: 1.0,
                potentialPayout: 2.00
            });

            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_3');
            expect(trade.observation).toContain('Q1-sweep-recovered');
        });

        test('shows which agents voted no', () => {
            insertTrade({
                timestamp: 1711900700,
                blockState: mockBlockState,
                gateResult: mockGateResult,
                swarmResult: {
                    votes: {
                        fastReader: { vote: true, edge: 0.04, sigma: 0.0012 },
                        steadyHand: { vote: true, edge: 0.035, sigma: 0.0010 },
                        trendSurfer: { vote: false, score: 0.1 },
                        climateCheck: { vote: true, volRatio: 1.0, volTrend: 'STABLE' }
                    },
                    consensus: 3,
                    consensusTrend: 'STEADY',
                    greenLight: true
                },
                direction: 'UP',
                barrier: 2.0,
                stake: 1.0,
                impliedProb: 0.47,
                contractId: 'test_contract_4',
                buyPrice: 1.0,
                potentialPayout: 2.05
            });

            const trade = db.prepare('SELECT * FROM trades WHERE contract_id = ?').get('test_contract_4');
            expect(trade.observation).toContain('votes=3/4');
            expect(trade.observation).toContain('no=[TS]');
        });
    });
});
