const EventEmitter = require('events');
const TradingEngine = require('./tradingEngine');

class FakeDerivClient extends EventEmitter {
    constructor() {
        super();
        this.symbol = '1HZ100V';
        this.requests = [];
        this.responses = [];
    }

    queueResponse(response) {
        this.responses.push(response);
    }

    async sendRequest(payload) {
        this.requests.push(payload);

        if (payload.forget) {
            return { forget: payload.forget };
        }

        if (this.responses.length === 0) {
            throw new Error('No queued response');
        }

        return this.responses.shift();
    }
}

describe('TradingEngine outcome tracking', () => {
    test('subscribes to proposal_open_contract after a successful buy', async () => {
        const deriv = new FakeDerivClient();
        const engine = new TradingEngine(deriv);

        deriv.queueResponse({
            buy: {
                contract_id: 12345,
                buy_price: '1.00',
                payout: '2.10',
                longcode: 'Touch contract',
                balance_after: '999.00',
                transaction_id: 456
            }
        });
        deriv.queueResponse({
            proposal_open_contract: {
                contract_id: 12345,
                is_sold: 0,
                status: 'open'
            },
            subscription: { id: 'sub-12345' }
        });

        const trade = await engine.executeBuy('proposal-1', 1.0, 'client-1');

        expect(trade.contractId).toBe(12345);
        expect(trade.outcome).toBe('pending');
        expect(deriv.requests[1]).toMatchObject({
            proposal_open_contract: 1,
            contract_id: 12345,
            subscribe: 1
        });
    });

    test('emits a normalized trade_outcome when the contract settles', async () => {
        const deriv = new FakeDerivClient();
        const engine = new TradingEngine(deriv);

        deriv.queueResponse({
            buy: {
                contract_id: 999,
                buy_price: '1.00',
                payout: '2.10',
                longcode: 'Touch contract',
                balance_after: '999.00',
                transaction_id: 777
            }
        });
        deriv.queueResponse({
            proposal_open_contract: {
                contract_id: 999,
                is_sold: 0,
                status: 'open'
            },
            subscription: { id: 'sub-999' }
        });

        await engine.executeBuy('proposal-2', 1.0, 'client-9');

        const outcomePromise = new Promise(resolve => {
            engine.once('trade_outcome', resolve);
        });

        deriv.emit('proposal_open_contract', {
            contract_id: 999,
            is_sold: 1,
            status: 'won',
            profit: '1.10',
            buy_price: '1.00',
            payout: '2.10',
            entry_tick: '2450.2',
            exit_tick: '2452.4',
            sell_time: 1710000000
        });

        const outcome = await outcomePromise;

        expect(outcome).toMatchObject({
            ownerId: 'client-9',
            contractId: 999,
            outcome: 'won',
            isSettled: true,
            profit: 1.1
        });
        expect(engine.getHistory()[0]).toMatchObject({
            contractId: 999,
            outcome: 'won',
            isSettled: true,
            profit: 1.1
        });
    });

    test('marks touch contracts as having touched the barrier on live updates before sell event', async () => {
        const deriv = new FakeDerivClient();
        const engine = new TradingEngine(deriv);

        deriv.queueResponse({
            buy: {
                contract_id: 333,
                buy_price: '1.00',
                payout: '2.10',
                longcode: 'Touch contract',
                balance_after: '999.00',
                transaction_id: 888
            }
        });
        deriv.queueResponse({
            proposal_open_contract: {
                contract_id: 333,
                is_sold: 0,
                status: 'open'
            },
            subscription: { id: 'sub-333' }
        });

        await engine.executeBuy('proposal-3', 1.0, 'client-3');

        const updatePromise = new Promise(resolve => {
            engine.once('contract_update', resolve);
        });

        deriv.emit('proposal_open_contract', {
            contract_id: 333,
            is_sold: 0,
            status: 'open',
            buy_price: '1.00',
            payout: '2.10',
            entry_tick: '100.00',
            barrier: '102.00',
            current_spot: '102.00',
            current_spot_time: 1710000005,
            date_start: 1710000000,
            date_expiry: 1710000120
        });

        const update = await updatePromise;

        expect(update).toMatchObject({
            contractId: 333,
            isSettled: false,
            touchedBarrier: true,
            barrier: 102,
            entrySpot: 100,
            currentSpot: 102,
            currentSpotTimeSec: 1710000005,
            expiryTimeSec: 1710000120
        });
    });
});
