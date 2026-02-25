/**
 * DerivClient (v2)
 *
 * Manages the WebSocket connection to Deriv's API.
 * Features:
 * - Pre-fills historical ticks on startup (ticks_history API)
 * - Subscribes to live tick stream
 * - Emits 'tick' events for each incoming price
 * - Automatic reconnection with exponential backoff
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('./config');

class DerivClient extends EventEmitter {
    constructor(symbol) {
        super();
        this.symbol = symbol;
        this.ws = null;
        this.appId = config.DERIV_APP_ID;
        this.url = `${config.DERIV_WS_URL}?app_id=${this.appId}`;

        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.pingInterval = null;

        // Pending request callbacks keyed by req_id
        this._pendingRequests = {};
        this._reqId = 1;
    }

    /**
     * Fetch historical ticks by paginating backwards in time.
     * Makes up to `pages` requests of 5000 ticks each, giving ~4h of history.
     * Returns sorted, deduplicated array of { epoch, quote }.
     *
     * @param {number} pages - How many pages of 5000 ticks to fetch (default 3 = ~4h)
     * @returns {Promise<Array<{epoch: number, quote: number}>>}
     */
    async fetchHistory(pages = 3) {
        const allTicks = [];
        let endEpoch = Math.floor(Date.now() / 1000);

        for (let page = 0; page < pages; page++) {
            try {
                const batch = await this._fetchHistoryPage(endEpoch, 5000);
                if (!batch || batch.length === 0) break;
                allTicks.push(...batch);
                // Walk backwards: next request ends just before earliest tick in this batch
                endEpoch = batch[0].epoch - 1;
            } catch (e) {
                console.warn(`[DerivClient] History page ${page} failed:`, e.message);
                break;
            }
        }

        // Sort chronologically and deduplicate
        allTicks.sort((a, b) => a.epoch - b.epoch);
        const deduped = [];
        let lastEpoch = -1;
        for (const t of allTicks) {
            if (t.epoch !== lastEpoch) { deduped.push(t); lastEpoch = t.epoch; }
        }
        return deduped;
    }

    _fetchHistoryPage(endEpoch, count = 5000) {
        return new Promise((resolve) => {
            const histWs = new WebSocket(this.url);
            const timeout = setTimeout(() => { histWs.terminate(); resolve([]); }, 12000);

            histWs.on('open', () => {
                histWs.send(JSON.stringify({
                    ticks_history: this.symbol,
                    end: endEpoch,
                    count,
                    style: 'ticks'
                }));
            });

            histWs.on('message', (data) => {
                clearTimeout(timeout);
                histWs.terminate();
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.error || !msg.history) { resolve([]); return; }
                    const ticks = msg.history.times.map((epoch, i) => ({
                        epoch, quote: msg.history.prices[i]
                    }));
                    resolve(ticks);
                } catch { resolve([]); }
            });

            histWs.on('error', () => { clearTimeout(timeout); resolve([]); });
        });
    }

    connect() {
        if (this.ws) {
            this.ws.terminate();
        }

        console.log(`[DerivClient] Connecting to ${this.url}...`);
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            console.log(`[DerivClient] ✓ WebSocket connected (app_id: ${this.appId})`);
            this.emit('connect');

            // If we have an API token, authorize first
            const token = config.DERIV_API_TOKEN;
            if (token) {
                console.log(`[DerivClient] Authorizing with API token...`);
                this.ws.send(JSON.stringify({ authorize: token }));
            }

            // Subscribe to live ticks
            this.ws.send(JSON.stringify({
                ticks: this.symbol,
                subscribe: 1
            }));

            // Keep alive ping every 25s (under Deriv's 30s timeout)
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ ping: 1 }));
                }
            }, 25000);
        });

        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.error) {
                    console.error(`[DerivClient] API Error: ${msg.error.message}`);
                    return;
                }

                if (msg.msg_type === 'tick' && msg.tick) {
                    const t = msg.tick;
                    this.emit('tick', {
                        symbol: t.symbol,
                        epoch: t.epoch,
                        quote: t.quote
                    });
                }
            } catch (e) {
                console.error(`[DerivClient] Failed to parse message:`, e);
            }
        });

        this.ws.on('close', () => {
            this.handleDisconnect();
        });

        this.ws.on('error', (err) => {
            console.error(`[DerivClient] WS Error: ${err.message}`);
        });
    }

    handleDisconnect() {
        this.isConnected = false;
        clearInterval(this.pingInterval);
        this.emit('disconnect');

        if (!this.isReconnecting) {
            this.isReconnecting = true;
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        let delay = Math.pow(2, this.reconnectAttempts) * 1000;
        if (delay > 30000) delay = 30000;
        console.log(`[DerivClient] Reconnecting in ${delay / 1000}s...`);
        setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
        }, delay);
    }

    disconnect() {
        this.isReconnecting = true;
        clearInterval(this.pingInterval);
        if (this.ws) this.ws.terminate();
    }
}

module.exports = DerivClient;
