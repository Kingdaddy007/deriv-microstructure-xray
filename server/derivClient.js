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
     * Fetch historical ticks for the last `seconds` before now.
     * Returns a promise that resolves with an array of { epoch, quote }.
     * Uses a fresh one-shot WebSocket so it doesn't interfere with live stream.
     *
     * @param {number} seconds - How many seconds of history to load (max 3600 = 1h)
     * @returns {Promise<Array<{epoch: number, quote: number}>>}
     */
    fetchHistory(seconds = 3600) {
        return new Promise((resolve, reject) => {
            const end = Math.floor(Date.now() / 1000);
            const start = end - seconds;
            const histWs = new WebSocket(this.url);

            const timeout = setTimeout(() => {
                histWs.terminate();
                reject(new Error('ticks_history timeout'));
            }, 15000);

            histWs.on('open', () => {
                histWs.send(JSON.stringify({
                    ticks_history: this.symbol,
                    start,
                    end,
                    style: 'ticks',
                    count: 3600  // Deriv max per request
                }));
            });

            histWs.on('message', (data) => {
                clearTimeout(timeout);
                histWs.terminate();
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.error) {
                        console.warn(`[DerivClient] History error: ${msg.error.message}`);
                        resolve([]);
                        return;
                    }
                    if (msg.history && msg.history.times && msg.history.prices) {
                        const ticks = msg.history.times.map((epoch, i) => ({
                            epoch,
                            quote: msg.history.prices[i]
                        }));
                        resolve(ticks);
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    resolve([]);
                }
            });

            histWs.on('error', (err) => {
                clearTimeout(timeout);
                console.warn(`[DerivClient] History WS error: ${err.message}`);
                resolve([]);
            });
        });
    }

    connect() {
        if (this.ws) {
            this.ws.terminate();
        }

        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            this.emit('connect');

            // Subscribe to live ticks
            this.ws.send(JSON.stringify({
                ticks: this.symbol,
                subscribe: 1
            }));

            // Keep alive ping every 30s
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ ping: 1 }));
                }
            }, 30000);
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
