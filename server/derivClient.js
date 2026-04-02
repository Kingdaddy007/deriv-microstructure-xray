/**
 * DerivClient (v3)
 *
 * Manages the WebSocket connection to Deriv's API.
 * Features:
 * - Pre-fills historical ticks on startup (ticks_history API)
 * - Subscribes to live tick stream
 * - Emits 'tick' events for each incoming price
 * - Generic sendRequest() for proposal/buy/any API call
 * - Emits proposal_open_contract updates for tracked contracts
 * - Automatic reconnection with exponential backoff
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('./config');

class DerivClient extends EventEmitter {
    constructor(symbol, token, options = {}) {
        super();
        this.symbol = symbol;
        this.token = token || config.DERIV_DEMO_TOKEN;
        this.ws = null;
        this.appId = config.DERIV_APP_ID;
        this.urls = config.DERIV_WS_URLS; // Array of fallback URLs
        this.urlIndex = 0;
        this.subscribeTicks = options.subscribeTicks !== false; // default: true

        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.pingInterval = null;

        // Pending request callbacks keyed by req_id
        this._pendingRequests = {};
        this._reqId = 1;

        // Stale-stream detection (tick freeze watchdog)
        this._lastTickReceived = 0;
        this._staleCheckInterval = null;
    }

    _getCurrentUrl() {
        return `${this.urls[this.urlIndex]}?app_id=${this.appId}`;
    }

    _cycleUrl() {
        this.urlIndex = (this.urlIndex + 1) % this.urls.length;
        console.log(`[DerivClient] Switching to Fallback Endpoint: ${this._getCurrentUrl()}`);
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

                // Add a small delay between pagination requests to avoid tripping Deriv rate limits
                if (page < pages - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
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
            const tempUrl = this._getCurrentUrl();
            const histWs = new WebSocket(tempUrl);
            const timeout = setTimeout(() => {
                histWs.close();
                resolve([]);
            }, 12000);

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
                histWs.close(); // Graceful close instead of terminate() to prevent zombie connections
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.error) {
                        console.error(`[DerivClient] History API error:`, msg.error.message);
                        resolve([]);
                        return;
                    }
                    if (!msg.history) {
                        resolve([]);
                        return;
                    }
                    const ticks = msg.history.times.map((epoch, i) => ({
                        epoch, quote: msg.history.prices[i]
                    }));
                    resolve(ticks);
                } catch { resolve([]); }
            });

            histWs.on('error', (err) => { 
                console.error(`[DerivClient] History WS error:`, err?.message || err);
                clearTimeout(timeout); 
                resolve([]); 
            });
        });
    }

    connect() {
        if (this.ws) {
            this.ws.terminate();
        }

        const activeUrl = this._getCurrentUrl();
        console.log(`[DerivClient] Connecting to ${activeUrl}...`);
        this.ws = new WebSocket(activeUrl);

        this.ws.on('open', () => {
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            console.log(`[DerivClient] ✓ WebSocket connected (app_id: ${this.appId})`);
            this.emit('connect');

            // If we have an API token, authorize first
            const token = this.token;
            if (token) {
                console.log(`[DerivClient] Authorizing with API token...`);
                this.ws.send(JSON.stringify({ authorize: token }));
            }

            // Subscribe to live ticks ONLY if NOT authorizing right now
            // If we are authorizing, we must wait for 'authorize' response to subscribe
            if (this.subscribeTicks && !token) {
                this.ws.send(JSON.stringify({
                    ticks: this.symbol,
                    subscribe: 1
                }));
            }

            // Keep alive ping every 25s (under Deriv's 30s timeout)
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ ping: 1 }));
                }
            }, 25000);

            // Stale-stream watchdog: if no tick arrives for 8s, force reconnect
            // Only active on clients that subscribe to ticks
            if (this.subscribeTicks) {
                this._lastTickReceived = Date.now();
                clearInterval(this._staleCheckInterval);
                this._staleCheckInterval = setInterval(() => {
                    if (this.isConnected && Date.now() - this._lastTickReceived > 8000) {
                        console.warn('[DerivClient] Data stream stale (>8s without tick). Forcing reconnect...');
                        this.ws.terminate(); // triggers handleDisconnect → scheduleReconnect
                    }
                }, 5000);
            }
        });

        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Route req_id responses to pending request callbacks (proposal, buy, etc.)
                if (msg.req_id && this._pendingRequests[msg.req_id]) {
                    const { resolve, reject } = this._pendingRequests[msg.req_id];
                    delete this._pendingRequests[msg.req_id];
                    if (msg.error) {
                        console.error(`[DerivClient] Request ${msg.req_id} failed: ${msg.error.message}`);
                        reject(msg.error);
                    } else {
                        resolve(msg);
                    }
                    return;
                }

                if (msg.error) {
                    console.error(`[DerivClient] API Error: ${msg.error.message}`);
                    return;
                }

                // Capture authorize response — emit event so other modules can use account info
                if (msg.msg_type === 'authorize' && msg.authorize) {
                    const acctInfo = msg.authorize;
                    const isVirtual = acctInfo.is_virtual;
                    const loginId = acctInfo.loginid;
                    const acctType = isVirtual ? 'DEMO/VIRTUAL' : 'REAL';
                    console.log(`[DerivClient] ✓ AUTHORIZE SUCCESS`);
                    console.log(`[DerivClient]   Account Type: ${acctType}`);
                    console.log(`[DerivClient]   Login ID: ${loginId}`);
                    console.log(`[DerivClient]   Email: ${acctInfo.email || 'N/A'}`);
                    this.emit('authorize', { isVirtual, loginId, email: acctInfo.email, currency: acctInfo.currency, balance: acctInfo.balance });
                    
                    // Auto-subscribe to live balance stream after authorization
                    this.subscribeBalance();

                    // If token was present, we delayed tick subscription until now to avoid race conditions
                    if (this.subscribeTicks) {
                        this.ws.send(JSON.stringify({
                            ticks: this.symbol,
                            subscribe: 1
                        }));
                    }
                }

                if (msg.msg_type === 'tick' && msg.tick) {
                    const t = msg.tick;
                    this._lastTickReceived = Date.now();
                    this.emit('tick', {
                        symbol: t.symbol,
                        epoch: t.epoch,
                        quote: t.quote
                    });
                }

                if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
                    this.emit('proposal_open_contract', msg.proposal_open_contract);
                }

                // Live balance updates from Deriv's balance subscription
                if (msg.msg_type === 'balance' && msg.balance) {
                    const bal = msg.balance;
                    this.emit('balance', {
                        balance: bal.balance,
                        currency: bal.currency,
                        loginid: bal.loginid,
                        id: bal.id
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
            const errMsg = err && err.message ? err.message : String(err);
            console.error(`[DerivClient] WS Error (${activeUrl}): ${errMsg}`);
            // If we fail specifically on TLS/Network right away, cycle to the next URL immediately for the next attempt
            if (errMsg.includes('disconnected') || errMsg.includes('network') || errMsg.includes('ENOTFOUND')) {
                this._cycleUrl();
            }
        });
    }

    handleDisconnect() {
        this.isConnected = false;
        clearInterval(this.pingInterval);
        clearInterval(this._staleCheckInterval);

        // Reject all pending requests — they will never get responses on the dead socket
        for (const reqId of Object.keys(this._pendingRequests)) {
            const { reject } = this._pendingRequests[reqId];
            try { reject(new Error('WebSocket disconnected')); } catch (_) { /* ignore */ }
        }
        this._pendingRequests = {};

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

    /**
     * Send any request to the Deriv API. Returns a Promise resolved with the response.
     * Uses req_id for response matching — safe for concurrent requests.
     * @param {Object} payload - The API request payload (e.g. { proposal: 1, ... })
     * @param {number} [timeoutMs=15000] - Timeout in ms
     * @returns {Promise<Object>} - The Deriv API response
     */
    sendRequest(payload, timeoutMs = 15000) {
        const reqId = this._reqId++;
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return reject(new Error('WebSocket not connected'));
            }
            // Auto-cleanup on timeout
            const timer = setTimeout(() => {
                delete this._pendingRequests[reqId];
                reject(new Error(`Request ${reqId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this._pendingRequests[reqId] = {
                resolve: (msg) => { clearTimeout(timer); resolve(msg); },
                reject: (err) => { clearTimeout(timer); reject(err); }
            };
            this.ws.send(JSON.stringify({ ...payload, req_id: reqId }));
        });
    }

    /**
     * Subscribe to live balance updates from Deriv.
     * Emits 'balance' events whenever the account balance changes (trades, deposits, etc.)
     */
    subscribeBalance() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        console.log('[DerivClient] Subscribed to live balance stream');
    }

    disconnect() {
        this.isReconnecting = true;
        clearInterval(this.pingInterval);
        if (this.ws) this.ws.terminate();
    }
}

module.exports = DerivClient;
