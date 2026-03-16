/**
 * TradingPanel — Self-contained trading UI module
 * Single-action trade flow: one TRADE button that auto-quotes and buys.
 * Deriv API requires a proposal_id before buying — this panel handles
 * that two-step handshake invisibly so the user experiences one click.
 */

export default class TradingPanel {
    constructor({ containerEl, ws, getParams, onTrade, onToggleClosedTradeVisuals, onClearClosedTradeVisuals }) {
        this.containerEl = containerEl;   // DOM element to render into
        this.ws = ws;                     // WebSocket reference
        this.getParams = getParams;       // Function returning { barrier, direction, symbol }
        this.onTrade = onTrade || null;   // Callback when trade executes: ({ entrySpot, entryTimeSec, barrier, direction, duration, durationUnit, contractId, buyPrice, payout })
        this.onToggleClosedTradeVisuals = onToggleClosedTradeVisuals || null;
        this.onClearClosedTradeVisuals = onClearClosedTradeVisuals || null;
        this.accountInfo = null;          // Set by account_info message
        this.trades = [];                 // Session trade log
        this.hideClosedTradeVisuals = false;

        // Auto-buy state: when true, the next proposal_result triggers immediate buy
        this._autoBuyPending = false;
        this._pendingTradeContext = null; // Stores { entrySpot, barrier, direction, duration, durationUnit } between quote and buy

        this._render();
        this._bindEvents();
        this._historyTimer = setInterval(() => this._refreshTradeCountdowns(), 250);

        // P4: If account_info never arrives, update badge after timeout
        this._acctTimeout = setTimeout(() => {
            if (!this.accountInfo) {
                const badge = this.containerEl.querySelector('#acctBadge');
                if (badge && badge.textContent.includes('CHECKING')) {
                    badge.textContent = 'NO TOKEN';
                    badge.className = 'acct-badge acct-unknown';
                }
            }
        }, 5000);
    }

    // ── Build the DOM ──
    _render() {
        this.containerEl.innerHTML = `
            <div class="trading-panel">
                <div class="trading-header">
                    <label>Trading</label>
                    <span id="acctBadge" class="acct-badge acct-unknown">CHECKING...</span>
                </div>

                <div class="trading-controls">
                    <div class="input-row">
                        <div class="input-group">
                            <span>Stake ($)</span>
                            <input type="number" id="stakeInput" value="1" min="0.35"
                                   step="0.5" class="mono" placeholder="1.00">
                        </div>
                        <div class="input-group">
                            <span>Duration</span>
                            <select id="durationSelect" class="mono">
                                <option value="2_m">2 min</option>
                                <option value="5_m" selected>5 min</option>
                                <option value="10_m">10 min</option>
                                <option value="15_m">15 min</option>
                                <option value="30_m">30 min</option>
                            </select>
                        </div>
                    </div>

                    <div id="contractTypeDisplay" class="contract-type-display">
                        ONETOUCH ▲
                    </div>

                    <button id="btnTrade" class="trade-btn primary-trade-btn">TRADE</button>

                    <div id="tradeStatus" class="trade-status hidden"></div>
                </div>

                <details class="collapsible-panel trade-history-panel" open>
                    <summary class="panel-header">Recent Trades <svg class="panel-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,2 7,5 3,8"/></svg></summary>
                    <div class="trade-history-actions">
                        <button id="btnToggleClosedVisuals" type="button" class="trade-history-action-btn">Hide Closed On Chart</button>
                        <button id="btnClearClosedVisuals" type="button" class="trade-history-action-btn">Clear Closed Chart Marks</button>
                    </div>
                    <div id="tradeHistoryList" class="trade-history-list">
                        <div class="muted small">No trades yet</div>
                    </div>
                </details>
            </div>
        `;
    }

    // ── Bind UI events ──
    _bindEvents() {
        const el = (id) => this.containerEl.querySelector(`#${id}`);

        // Single TRADE button — requests quote then auto-buys
        el('btnTrade')?.addEventListener('click', () => this._trade());
        el('btnToggleClosedVisuals')?.addEventListener('click', () => {
            if (!this.onToggleClosedTradeVisuals) return;
            this.hideClosedTradeVisuals = !!this.onToggleClosedTradeVisuals();
            this._syncClosedVisualToggle();
            this._pulseActionButton(el('btnToggleClosedVisuals'));
        });
        el('btnClearClosedVisuals')?.addEventListener('click', () => {
            const removed = this.onClearClosedTradeVisuals ? this.onClearClosedTradeVisuals() : 0;
            this._pulseActionButton(el('btnClearClosedVisuals'), removed > 0 ? `${removed} cleared` : 'Nothing to clear');
        });
        this._syncClosedVisualToggle();
    }

    _syncClosedVisualToggle() {
        const btn = this.containerEl.querySelector('#btnToggleClosedVisuals');
        if (!btn) return;
        btn.textContent = this.hideClosedTradeVisuals ? 'Show Closed On Chart' : 'Hide Closed On Chart';
        btn.classList.toggle('is-active', this.hideClosedTradeVisuals);
    }

    _pulseActionButton(btn, tempLabel = null) {
        if (!btn) return;
        const originalLabel = btn.dataset.originalLabel || btn.textContent;
        btn.dataset.originalLabel = originalLabel;
        btn.classList.remove('did-flash');
        void btn.offsetWidth;
        btn.classList.add('did-flash');
        if (tempLabel) btn.textContent = tempLabel;
        clearTimeout(btn._resetTimer);
        btn._resetTimer = setTimeout(() => {
            btn.classList.remove('did-flash');
            if (btn.id === 'btnToggleClosedVisuals') this._syncClosedVisualToggle();
            else btn.textContent = originalLabel;
        }, 850);
    }

    // ── Handle incoming WebSocket messages ──
    handleMessage(msg) {
        switch (msg.type) {
            case 'account_info':
                this._setAccountInfo(msg.data);
                break;
            case 'proposal_result':
                this._handleProposalResult(msg.data);
                break;
            case 'trade_result':
                this._handleTradeResult(msg.data);
                break;
            case 'trade_outcome':
                this._handleTradeOutcome(msg.data);
                break;
            case 'contract_update':
                this._handleContractUpdate(msg.data);
                break;
            case 'trade_error':
                this._showStatus(msg.data.message || 'Trade failed', 'error');
                this._setIdle();
                break;
        }
    }

    // ── Account info badge ──
    _setAccountInfo(info) {
        this.accountInfo = info;
        if (this._acctTimeout) { clearTimeout(this._acctTimeout); this._acctTimeout = null; }
        const badge = this.containerEl.querySelector('#acctBadge');
        if (badge) {
            if (info.isVirtual) {
                badge.textContent = 'DEMO (' + info.currency + ')';
                badge.className = 'acct-badge acct-demo';
            } else {
                badge.textContent = 'REAL (' + info.currency + ')';
                badge.className = 'acct-badge acct-real';
            }
        }
    }

    // ── Update contract type display based on direction ──
    updateContractDisplay() {
        const { direction } = this.getParams();
        const display = this.containerEl.querySelector('#contractTypeDisplay');
        if (display) {
            const type = direction === 'up' ? 'ONETOUCH ▲' : 'ONETOUCH ▼';
            display.textContent = type;
        }
    }

    // ── Single-action trade: quote → buy in one click ──
    _trade() {
        const stakeEl = this.containerEl.querySelector('#stakeInput');
        const durationEl = this.containerEl.querySelector('#durationSelect');
        const stake = parseFloat(stakeEl?.value) || 1;

        // Validate stake — minimum only, no upper cap
        if (stake < 0.35) {
            this._showStatus('Stake must be at least $0.35', 'error');
            return;
        }

        const [durVal, durUnit] = (durationEl?.value || '5_m').split('_');
        const { barrier, direction } = this.getParams();
        const barrierStr = direction === 'up' ? `+${barrier}` : `-${barrier}`;

        if (!this.ws || this.ws.readyState !== 1) {
            this._showStatus('Not connected to server', 'error');
            return;
        }

        // Set auto-buy flag so proposal_result triggers immediate buy
        this._autoBuyPending = true;
        this._pendingTradeContext = {
            barrier: parseFloat(barrier),
            direction,
            duration: parseInt(durVal),
            durationUnit: durUnit
        };
        this._setButtonState('quoting');
        this._showStatus('Quoting...', 'info');

        this.ws.send(JSON.stringify({
            type: 'get_proposal',
            amount: stake,
            contract_type: 'ONETOUCH',
            barrier: barrierStr,
            duration: parseInt(durVal),
            duration_unit: durUnit
        }));
    }

    // ── Handle proposal response ──
    _handleProposalResult(data) {
        if (data.error) {
            this._showStatus(data.error, 'error');
            this._autoBuyPending = false;
            this._pendingTradeContext = null;
            this._setIdle();
            return;
        }

        // If auto-buy is pending, immediately execute the trade
        if (this._autoBuyPending) {
            this._autoBuyPending = false;

            // Capture entry spot + time from proposal for chart visualization
            if (this._pendingTradeContext) {
                this._pendingTradeContext.entrySpot = data.spot;
                this._pendingTradeContext.entryTimeSec = data.spotTime || Math.floor(Date.now() / 1000);
            }

            this._setButtonState('buying');
            this._showStatus(`Buying @ $${data.askPrice.toFixed(2)}...`, 'info');

            this.ws.send(JSON.stringify({
                type: 'execute_trade',
                proposalId: data.proposalId,
                maxPrice: data.askPrice
            }));
        }
    }

    // ── Handle trade result ──
    _handleTradeResult(data) {
        // Capture trade context before _setIdle clears it
        const tradeCtx = this._pendingTradeContext;
        this._setIdle();

        if (data.error) {
            this._showStatus(`Trade failed: ${data.error}`, 'error');
            return;
        }

        // Fire onTrade callback with full context for chart visualization
        if (this.onTrade && tradeCtx) {
            const barrierPrice = tradeCtx.direction === 'up'
                ? tradeCtx.entrySpot + tradeCtx.barrier
                : tradeCtx.entrySpot - tradeCtx.barrier;
            const durationSec = this._durationToSec(tradeCtx.duration, tradeCtx.durationUnit);

            this.onTrade({
                contractId: data.contractId,
                entrySpot: tradeCtx.entrySpot,
                entryTimeSec: tradeCtx.entryTimeSec,
                barrierPrice,
                barrierOffset: tradeCtx.barrier,
                direction: tradeCtx.direction,
                duration: tradeCtx.duration,
                durationUnit: tradeCtx.durationUnit,
                durationSec,
                buyPrice: data.buyPrice,
                payout: data.payout,
                timestamp: data.timestamp || Date.now()
            });
        }

        // Add to session history
        this.trades.unshift({
            ...data,
            entryTimeSec: tradeCtx?.entryTimeSec,
            duration: tradeCtx?.duration,
            durationUnit: tradeCtx?.durationUnit,
            durationSec: this._durationToSec(tradeCtx?.duration, tradeCtx?.durationUnit),
            expiryTimeSec: tradeCtx?.entryTimeSec && tradeCtx?.duration
                ? tradeCtx.entryTimeSec + this._durationToSec(tradeCtx.duration, tradeCtx.durationUnit)
                : null,
            outcome: 'pending',
            status: 'open',
            isSettled: false
        });
        if (this.trades.length > 20) this.trades.pop();
        this.containerEl.querySelector('.trade-history-panel')?.setAttribute('open', 'open');
        this._renderHistory();

        this._showStatus(
            `Trade placed! #${data.contractId} | Cost: $${data.buyPrice.toFixed(2)} | Payout: $${data.payout.toFixed(2)}`,
            'success'
        );
    }

    // ── Button state management ──
    _setButtonState(state) {
        const btn = this.containerEl.querySelector('#btnTrade');
        if (!btn) return;

        switch (state) {
            case 'quoting':
                btn.disabled = true;
                btn.textContent = 'QUOTING...';
                btn.className = 'trade-btn primary-trade-btn state-quoting';
                break;
            case 'buying':
                btn.disabled = true;
                btn.textContent = 'BUYING...';
                btn.className = 'trade-btn primary-trade-btn state-buying';
                break;
            default: // idle
                btn.disabled = false;
                btn.textContent = 'TRADE';
                btn.className = 'trade-btn primary-trade-btn';
                break;
        }
    }

    _setIdle() {
        this._autoBuyPending = false;
        this._pendingTradeContext = null;
        this._setButtonState('idle');
    }

    // ── Status display ──
    _showStatus(message, type = 'info') {
        const el = this.containerEl.querySelector('#tradeStatus');
        if (!el) return;
        el.classList.remove('hidden');
        el.className = `trade-status status-${type}`;
        el.textContent = message;
    }

    _getOutcomeTone(trade) {
        if (trade?.outcome === 'won') return 'won';
        if (trade?.outcome === 'lost') return 'lost';
        if (trade?.outcome === 'flat') return 'flat';
        return 'pending';
    }

    _getOutcomeLabel(trade) {
        const tone = this._getOutcomeTone(trade);
        if (tone === 'won') return 'WIN';
        if (tone === 'lost') return 'LOSS';
        if (tone === 'flat') return 'FLAT';
        return 'PENDING';
    }

    _formatMoney(value) {
        return Number.isFinite(value) ? `$${value.toFixed(2)}` : '--';
    }

    _durationToSec(duration, unit) {
        if (!Number.isFinite(duration)) return null;
        if (unit === 's') return duration;
        if (unit === 'm') return duration * 60;
        if (unit === 'h') return duration * 3600;
        if (unit === 'd') return duration * 86400;
        if (unit === 't') return duration * 2;
        return duration * 60;
    }

    _getTradeFillState(trade) {
        const nowSec = Date.now() / 1000;
        const entryTimeSec = Number.isFinite(trade.entryTimeSec) ? trade.entryTimeSec : null;
        const durationSec = Number.isFinite(trade.durationSec) ? trade.durationSec : this._durationToSec(trade.duration, trade.durationUnit);
        const expiryTimeSec = Number.isFinite(trade.expiryTimeSec)
            ? trade.expiryTimeSec
            : (entryTimeSec && durationSec ? entryTimeSec + durationSec : null);

        if (trade.outcome === 'won') return { phase: 'won', progress: 1 };
        if (trade.outcome === 'lost' || trade.contractStatus === 'lost' || trade.contractStatus === 'expired') return { phase: 'lost', progress: 1 };
        if (!entryTimeSec || !expiryTimeSec || expiryTimeSec <= entryTimeSec) return { phase: 'pending', progress: 1 };

        const remaining = Math.max(0, expiryTimeSec - nowSec);
        const total = Math.max(1, expiryTimeSec - entryTimeSec);
        const progress = Math.max(0, Math.min(1, remaining / total));

        if (progress <= 0) return { phase: 'expired', progress: 0 };
        return { phase: 'pending', progress };
    }

    _refreshTradeCountdowns() {
        const items = this.containerEl.querySelectorAll('.trade-history-item[data-contract-id]');
        if (!items.length) return;
        items.forEach((item) => {
            const contractId = item.dataset.contractId;
            const trade = this.trades.find(t => String(t.contractId) === String(contractId));
            if (!trade) return;
            const fill = this._getTradeFillState(trade);
            item.style.setProperty('--trade-fill-scale', String(fill.progress));
            item.dataset.phase = fill.phase;
        });
    }

    _mergeTradeUpdate(data) {
        const idx = this.trades.findIndex(t => String(t.contractId) === String(data.contractId));

        if (idx >= 0) {
            const existing = this.trades[idx];
            // Never downgrade a settled outcome back to 'pending'
            const settled = ['won', 'lost', 'flat'];
            if (settled.includes(existing.outcome) && data.outcome === 'pending') {
                delete data.outcome;
            }
            // Never downgrade settled status
            if (existing.isSettled && data.isSettled === false) {
                delete data.isSettled;
            }
            this.trades[idx] = { ...existing, ...data };
        }
        // Do NOT create a new entry here — _handleTradeResult is the
        // single source of truth for adding trades.  Early contract_update
        // messages that arrive before trade_result should be ignored
        // rather than producing duplicate rows.
    }

    // ── Render trade history ──
    _renderHistory() {
        const list = this.containerEl.querySelector('#tradeHistoryList');
        if (!list) return;
        if (this.trades.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'muted small';
            empty.textContent = 'No trades yet';
            list.replaceChildren(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        this.trades.forEach(t => {
            const tone = this._getOutcomeTone(t);
            const fill = this._getTradeFillState(t);
            const item = document.createElement('div');
            item.className = `trade-history-item outcome-${tone}`;
            item.dataset.contractId = String(t.contractId);
            item.dataset.phase = fill.phase;
            item.style.setProperty('--trade-fill-scale', String(fill.progress));

            const fillLayer = document.createElement('div');
            fillLayer.className = 'trade-history-fill';

            const main = document.createElement('div');
            main.className = 'trade-history-main';

            const topRow = document.createElement('div');
            topRow.className = 'trade-history-top';

            const bottomRow = document.createElement('div');
            bottomRow.className = 'trade-history-bottom';

            const side = document.createElement('div');
            side.className = 'trade-history-side';

            const time = document.createElement('span');
            time.className = 'mono small';
            time.textContent = new Date(t.timestamp).toLocaleTimeString();

            const contract = document.createElement('span');
            contract.className = 'mono';
            const cid = String(t.contractId || '');
            contract.textContent = cid.length > 8 ? `#…${cid.slice(-6)}` : `#${cid}`;

            const prices = document.createElement('span');
            prices.className = 'mono';
            prices.textContent = `${this._formatMoney(t.buyPrice)} → ${this._formatMoney(t.payout)}`;

            const status = document.createElement('span');
            status.className = `trade-history-status outcome-${tone}`;
            status.textContent = this._getOutcomeLabel(t);

            const profit = document.createElement('span');
            profit.className = `trade-history-profit mono outcome-${tone}`;
            if (tone !== 'pending' && Number.isFinite(t.profit)) {
                profit.textContent = `${t.profit >= 0 ? '+' : ''}$${Number(t.profit).toFixed(2)}`;
            } else {
                profit.textContent = tone === 'pending' ? 'settling' : '--';
            }

            topRow.append(time, contract);
            bottomRow.append(prices);
            side.append(status, profit);
            main.append(topRow, bottomRow);
            item.append(fillLayer, main, side);
            fragment.appendChild(item);
        });

        list.replaceChildren(fragment);
    }

    // ── Handle trade outcome (win/loss result from server) ──
    _handleTradeOutcome(data) {
        this._mergeTradeUpdate(data);
        this._renderHistory();
    }

    _handleContractUpdate(data) {
        const touchedBarrier = Boolean(data?.touchedBarrier);
        const inferredProfit = Number.isFinite(data?.profit)
            ? data.profit
            : (Number.isFinite(data?.payout) && Number.isFinite(data?.buyPrice) ? data.payout - data.buyPrice : null);

        const patch = touchedBarrier ? {
            ...data,
            outcome: 'won',
            status: 'closed',
            contractStatus: data.contractStatus || 'won',
            visualClosed: true,
            profit: inferredProfit,
            expiryTimeSec: data.currentSpotTimeSec || data.expiryTimeSec || data.exitTimeSec
        } : data;

        this._mergeTradeUpdate(patch);
        this._renderHistory();
    }
}
