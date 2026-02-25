/* ================================================================
   Micro-Structure X-Ray — app.js (v5 Senior Review)
   Critical fixes:
   1. LAZY chart init — charts are only created when their tab is first shown
      (fixes 0×0 hidden-tab bug that froze candle chart scrolling)
   2. DrawingManager uses SERIES.priceToCoordinate() not chart
      (fixes drawing tools doing nothing)
   3. Drawing canvas sits BEHIND chart when inactive (no z-index war)
   4. All coordinate conversions have null-safety
   ================================================================ */

'use strict';

const $ = id => document.getElementById(id);
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
function setStyle(id, p, v) { const e = $(id); if (e) e.style[p] = v; }

let lastPrice = 0;

// ── Chart Theme ───────────────────────────────────────────────────
const THEME = {
    layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
    crosshair: { mode: 0 },   // 0 = Normal (allows free pan/scroll)
    timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#30363d' },
    rightPriceScale: { borderColor: '#30363d' }
};
const CANDLE_OPTS = { upColor: '#3fb950', downColor: '#f85149', borderVisible: false, wickUpColor: '#3fb950', wickDownColor: '#f85149' };


/* ================================================================
   DRAWING MANAGER (v2 — Senior Review Fix)
   ================================================================
   KEY FIX: uses series.priceToCoordinate() not chart.priceToCoordinate()
   LightweightCharts coordinate conversion is on the SERIES object.
   The canvas only captures mouse events when a tool is active.
   ================================================================ */

class DrawingManager {
    constructor(chartObj, seriesObj, containerId) {
        this.chart = chartObj;
        this.series = seriesObj;  // CRITICAL: coordinate APIs are on the series
        this.container = $(containerId);
        if (!this.chart || !this.series || !this.container) return;

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'drawing-canvas';
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.drawings = [];
        this.selectedIdx = -1;
        this.activeTool = 'none';
        this.drawColor = '#f59e0b';
        this._drafting = false;
        this._points = [];
        this._mousePos = null;

        this._resize();
        new ResizeObserver(() => this._resize()).observe(this.container);

        // Mouse events on canvas
        this.canvas.addEventListener('mousedown', e => this._onDown(e));
        this.canvas.addEventListener('mousemove', e => this._onMove(e));
        this.canvas.addEventListener('dblclick', () => { this._drafting = false; this._points = []; });

        // Render loop
        const render = () => { this._render(); requestAnimationFrame(render); };
        requestAnimationFrame(render);
    }

    setTool(tool) {
        this.activeTool = tool;
        this.canvas?.classList.toggle('drawing-active', tool !== 'none');
        this._drafting = false;
        this._points = [];
    }

    setColor(c) { this.drawColor = c; }

    deleteSelected() {
        if (this.selectedIdx >= 0 && this.selectedIdx < this.drawings.length) {
            this.drawings.splice(this.selectedIdx, 1);
            this.selectedIdx = -1;
        }
    }

    _resize() {
        if (!this.canvas || !this.container) return;
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = this.container.clientHeight;
    }

    // ── Coordinate conversion (uses SERIES, not chart) ──
    _toPx(time, price) {
        try {
            const x = this.chart.timeScale().timeToCoordinate(time);
            const y = this.series.priceToCoordinate(price);
            if (x == null || y == null) return null;
            return { x, y };
        } catch { return null; }
    }

    _fromPx(canvasX, canvasY) {
        try {
            const time = this.chart.timeScale().coordinateToTime(canvasX);
            const price = this.series.coordinateToPrice(canvasY);
            if (time == null || price == null) return null;
            return { time, price };
        } catch { return null; }
    }

    _canvasXY(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // ── Mouse handlers ──
    _onDown(e) {
        if (this.activeTool === 'none') return;
        const pos = this._canvasXY(e);
        const pt = this._fromPx(pos.x, pos.y);
        if (!pt) return;

        // Single-click tools
        if (this.activeTool === 'hline') {
            this.drawings.push({ type: 'hline', price: pt.price, color: this.drawColor });
            return;
        }
        if (this.activeTool === 'vline') {
            this.drawings.push({ type: 'vline', time: pt.time, color: this.drawColor });
            return;
        }
        if (this.activeTool === 'text') {
            this._placeText(pos, pt);
            return;
        }

        // Multi-click tools
        if (['trendline', 'ray', 'rectangle', 'fib'].includes(this.activeTool)) {
            if (!this._drafting) {
                this._drafting = true;
                this._points = [pt];
            } else {
                this._points.push(pt);
                this.drawings.push({ type: this.activeTool, pts: [...this._points], color: this.drawColor });
                this._drafting = false;
                this._points = [];
            }
            return;
        }

        if (this.activeTool === 'triangle') {
            this._points.push(pt);
            this._drafting = true;
            if (this._points.length === 3) {
                this.drawings.push({ type: 'triangle', pts: [...this._points], color: this.drawColor });
                this._drafting = false;
                this._points = [];
            }
        }
    }

    _onMove(e) {
        if (this._drafting) this._mousePos = this._canvasXY(e);
    }

    _placeText(canvasPos, chartPt) {
        const overlay = $('textInputOverlay');
        const input = $('textInputField');
        if (!overlay || !input) return;
        const rect = this.container.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.left = (rect.left + canvasPos.x) + 'px';
        overlay.style.top = (rect.top + canvasPos.y) + 'px';
        input.value = '';
        input.focus();
        const done = (ev) => {
            if (ev.key === 'Enter' || ev.type === 'blur') {
                const txt = input.value.trim();
                if (txt) this.drawings.push({ type: 'text', text: txt, time: chartPt.time, price: chartPt.price, color: this.drawColor });
                overlay.style.display = 'none';
                input.removeEventListener('keydown', done);
                input.removeEventListener('blur', done);
            }
        };
        input.addEventListener('keydown', done);
        input.addEventListener('blur', done);
    }

    // ── Render ──
    _render() {
        const ctx = this.ctx;
        if (!ctx) return;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        for (let i = 0; i < this.drawings.length; i++) {
            const d = this.drawings[i];
            ctx.save();
            ctx.strokeStyle = d.color;
            ctx.fillStyle = d.color;
            ctx.lineWidth = i === this.selectedIdx ? 2.5 : 1.5;
            ctx.font = '12px Inter, sans-serif';

            switch (d.type) {
                case 'hline': {
                    const y = this.series.priceToCoordinate(d.price);
                    if (y == null) break;
                    ctx.setLineDash([5, 4]);
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillText(d.price.toFixed(2), 4, y - 4);
                    break;
                }
                case 'vline': {
                    const x = this.chart.timeScale().timeToCoordinate(d.time);
                    if (x == null) break;
                    ctx.setLineDash([5, 4]);
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
                    ctx.setLineDash([]);
                    break;
                }
                case 'trendline':
                case 'ray': {
                    const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                    const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                    if (!p0 || !p1) break;
                    let ex = p1.x, ey = p1.y;
                    if (d.type === 'ray') {
                        const dx = p1.x - p0.x, dy = p1.y - p0.y;
                        if (Math.abs(dx) > 0.01) { const t = (W - p0.x) / dx; ex = W; ey = p0.y + dy * t; }
                    }
                    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(ex, ey); ctx.stroke();
                    break;
                }
                case 'rectangle': {
                    const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                    const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                    if (!p0 || !p1) break;
                    ctx.globalAlpha = 0.12;
                    ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
                    ctx.globalAlpha = 1;
                    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
                    break;
                }
                case 'triangle': {
                    const pts = d.pts.map(p => this._toPx(p.time, p.price));
                    if (pts.some(p => !p)) break;
                    ctx.globalAlpha = 0.1;
                    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.closePath(); ctx.fill();
                    ctx.globalAlpha = 1;
                    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.closePath(); ctx.stroke();
                    break;
                }
                case 'fib': {
                    const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                    const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                    if (!p0 || !p1) break;
                    const range = d.pts[0].price - d.pts[1].price;
                    for (const lvl of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]) {
                        const price = d.pts[1].price + range * lvl;
                        const y = this.series.priceToCoordinate(price);
                        if (y == null) continue;
                        ctx.globalAlpha = 0.6;
                        ctx.setLineDash([4, 3]);
                        ctx.beginPath(); ctx.moveTo(Math.min(p0.x, p1.x), y); ctx.lineTo(Math.max(p0.x, p1.x), y); ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.globalAlpha = 1;
                        ctx.fillText((lvl * 100).toFixed(1) + '%  ' + price.toFixed(2), Math.min(p0.x, p1.x) + 3, y - 4);
                    }
                    break;
                }
                case 'text': {
                    const px = this._toPx(d.time, d.price);
                    if (!px) break;
                    ctx.fillText(d.text, px.x + 5, px.y - 5);
                    ctx.beginPath(); ctx.arc(px.x, px.y, 3, 0, Math.PI * 2); ctx.fill();
                    break;
                }
            }
            ctx.restore();
        }

        // Draft preview line
        if (this._drafting && this._points.length > 0 && this._mousePos) {
            const last = this._points[this._points.length - 1];
            const p0 = this._toPx(last.time, last.price);
            if (p0) {
                ctx.save();
                ctx.strokeStyle = this.drawColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
                ctx.setLineDash([4, 3]);
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(this._mousePos.x, this._mousePos.y); ctx.stroke();
                ctx.restore();
            }
        }
    }
}



/* ================================================================
   LAZY CHART MANAGER
   Charts are NOT created at page load. They are created the first
   time their tab becomes visible. This avoids the 0×0 hidden-tab bug.
   ================================================================ */

class ChartSlot {
    constructor(containerId, type) {
        this.containerId = containerId;
        this.type = type;          // 'line' or 'candle'
        this.chart = null;
        this.series = null;
        this.pendingData = null;   // Data queued before chart exists
        this.drawing = null;       // DrawingManager instance
    }

    /** Create chart and series. Only call when container is visible. */
    init() {
        if (this.chart) return;    // Already initialised
        const el = $(this.containerId);
        if (!el || el.clientWidth === 0) return;  // Still hidden

        this.chart = LightweightCharts.createChart(el, {
            ...THEME,
            width: el.clientWidth,
            height: el.clientHeight,
        });

        if (this.type === 'line') {
            this.series = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: '#58a6ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true
            });
        } else {
            this.series = this.chart.addSeries(LightweightCharts.CandlestickSeries, CANDLE_OPTS);
        }

        // Auto-resize on container size change
        new ResizeObserver(() => {
            if (el.clientWidth > 0 && el.clientHeight > 0) {
                this.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            }
        }).observe(el);

        // Flush any pending data
        if (this.pendingData?.length) {
            this.series.setData(this.pendingData);
            this.chart.timeScale().scrollToRealTime();
            this.pendingData = null;
        }

        // Create drawing manager (needs series for coordinate conversion)
        this.drawing = new DrawingManager(this.chart, this.series, this.containerId);
    }

    setData(data) {
        if (!data?.length) return;
        if (this.series) {
            this.series.setData(data);
            this.chart?.timeScale().scrollToRealTime();
        } else {
            this.pendingData = data;
        }
    }

    update(point) {
        if (this.series) this.series.update(point);
        else {
            if (!this.pendingData) this.pendingData = [];
            const last = this.pendingData[this.pendingData.length - 1];
            if (last && last.time === point.time) this.pendingData[this.pendingData.length - 1] = point;
            else this.pendingData.push(point);
        }
    }
}

// ── Chart Slots ───────────────────────────────────────────────────
const slots = {
    tick: new ChartSlot('tickChart', 'line'),
    '5s': new ChartSlot('chart5s', 'candle'),
    '10s': new ChartSlot('chart10s', 'candle'),
    '15s': new ChartSlot('chart15s', 'candle'),
    '30s': new ChartSlot('chart30s', 'candle'),
    '1m': new ChartSlot('chart1m', 'candle'),
    '5m': new ChartSlot('chart5m', 'candle'),
    gridL: new ChartSlot('gridChartLeft', 'candle'),
    gridR: new ChartSlot('gridChartRight', 'candle'),
};

// Init the tick chart immediately (it's visible on load)
slots.tick.init();

// ── Tab → Slot mapping ───────────────────────────────────────────
const TAB_SLOTS = {
    tickView: ['tick'],
    view5s: ['5s'],
    view10s: ['10s'],
    view15s: ['15s'],
    view30s: ['30s'],
    view1m: ['1m'],
    view5m: ['5m'],
    viewGrid: ['gridL', 'gridR'],
};

// Candle data buffers per TF (for grid panel switching)
const candleBuf = { '5s': [], '10s': [], '15s': [], '30s': [], '1m': [], '2m': [], '5m': [] };

// ── Tab Switching ─────────────────────────────────────────────────
const allTabs = document.querySelectorAll('.tab');
const allViews = document.querySelectorAll('.chart-view');

function activateTab(viewId) {
    allTabs.forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
    allViews.forEach(v => v.classList.toggle('active', v.id === viewId));

    // Lazy-init charts for this tab (runs only once per slot)
    const slotKeys = TAB_SLOTS[viewId] || [];
    requestAnimationFrame(() => {
        slotKeys.forEach(key => slots[key]?.init());
    });
}

allTabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.view)));

// ── Flexible Grid ─────────────────────────────────────────────────
function getGridTf(side) {
    return $(side === 'left' ? 'gridLeftTf' : 'gridRightTf')?.value ?? '5s';
}

function rebuildGridPanel(side) {
    const tf = getGridTf(side);
    const slot = side === 'left' ? slots.gridL : slots.gridR;
    const data = candleBuf[tf] ?? [];
    // Re-create series with fresh data
    if (slot.chart && slot.series) {
        slot.chart.removeSeries(slot.series);
        slot.series = slot.chart.addSeries(LightweightCharts.CandlestickSeries, CANDLE_OPTS);
        if (data.length) slot.series.setData(data);
        slot.chart.timeScale().scrollToRealTime();
    }
}

$('gridLeftTf')?.addEventListener('change', () => rebuildGridPanel('left'));
$('gridRightTf')?.addEventListener('change', () => rebuildGridPanel('right'));

function pushCandle(tf, candle) {
    if (!candleBuf[tf]) return;
    const buf = candleBuf[tf];
    if (buf.length > 0 && buf[buf.length - 1].time === candle.time) buf[buf.length - 1] = candle;
    else buf.push(candle);

    // Update main chart for this TF
    slots[tf]?.update(candle);

    // Update grid panels if they show this TF
    if (getGridTf('left') === tf) slots.gridL?.update(candle);
    if (getGridTf('right') === tf) slots.gridR?.update(candle);
}

// ── Countdown ─────────────────────────────────────────────────────
const CD_MAP = {
    '5s': { fill: 'cd5s', time: 'cdt5s' },
    '10s': { fill: 'cd10s', time: 'cdt10s' },
    '15s': { fill: 'cd15s', time: 'cdt15s' },
    '30s': { fill: 'cd30s', time: 'cdt30s' },
    '1m': { fill: 'cd1m', time: 'cdt1m' },
    '5m': { fill: 'cd5m', time: 'cdt5m' },
};

function updateCountdowns(data) {
    for (const [tf, ids] of Object.entries(CD_MAP)) {
        const cd = data[tf];
        if (!cd) continue;
        setStyle(ids.fill, 'width', Math.round(cd.pct * 100) + '%');
        setText(ids.time, cd.remaining.toFixed(1) + 's');
    }
    const lt = getGridTf('left'), rt = getGridTf('right');
    if (data[lt]) setText('cdGridLeft', data[lt].remaining.toFixed(1) + 's');
    if (data[rt]) setText('cdGridRight', data[rt].remaining.toFixed(1) + 's');
}

// ── WebSocket ─────────────────────────────────────────────────────
const ws = new WebSocket(`ws://${location.host}`);
ws.onopen = () => setText('symbolBadge', 'CONNECTED');
ws.onclose = () => { setText('symbolBadge', 'DISCONNECTED'); setTimeout(() => location.reload(), 3000); };
ws.onerror = () => setText('symbolBadge', 'ERROR');

ws.onmessage = (event) => {
    try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
            case 'symbol': setText('symbolBadge', msg.data); break;
            case 'config': applyConfig(msg.data); break;
            case 'tick': slots.tick.update(msg.data); break;
            case 'countdown': updateCountdowns(msg.data); break;
            case 'candle_closed': pushCandle(msg.timeframe, msg.data); break;
            case 'analytics': handleAnalytics(msg.data); break;
            case 'history': loadHistory(msg.data); break;
        }
    } catch (e) { console.error('[WS]', e); }
};

function loadHistory(h) {
    if (h.historicalTicks?.length) slots.tick.setData(h.historicalTicks);
    const map = { '5s': 'historicalC5s', '10s': 'historicalC10s', '15s': 'historicalC15s', '30s': 'historicalC30s', '1m': 'historicalC1m', '2m': 'historicalC2m', '5m': 'historicalC5m' };
    for (const [tf, key] of Object.entries(map)) {
        if (h[key]?.length) {
            candleBuf[tf] = [...h[key]];
            slots[tf]?.setData(h[key]);
        }
    }
    // Pre-fill grid panels
    const lt = getGridTf('left'), rt = getGridTf('right');
    if (candleBuf[lt]?.length) slots.gridL.setData([...candleBuf[lt]]);
    if (candleBuf[rt]?.length) slots.gridR.setData([...candleBuf[rt]]);
}

function applyConfig(cfg) {
    if ($('barrierInput')) $('barrierInput').value = cfg.barrier;
    if ($('roiInput')) $('roiInput').value = cfg.payoutROI;
    if (cfg.direction) setDirection(cfg.direction);
}

// ── Analytics ─────────────────────────────────────────────────────
function handleAnalytics(d) {
    const a = d.active;
    const pc = d.price > lastPrice ? '#3fb950' : d.price < lastPrice ? '#f85149' : '#c9d1d9';
    setText('currentPrice', d.price.toFixed(2)); setStyle('currentPrice', 'color', pc);
    lastPrice = d.price;
    setText('tickCounter', `${d.tickCount} ticks`);

    const wu = $('warmupBadge');
    if (wu) { wu.style.display = d.warmupDone ? 'none' : 'inline-block'; wu.textContent = `Warming up ${d.tickCount}/300`; }

    setText('theoProb', a.theoretical != null ? pct(a.theoretical) : 'N/A');
    setText('empProb', a.empirical != null ? pct(a.empirical) : 'N/A');
    setText('ourProb', pct(a.ourProb));
    setText('derivProb', pct(a.impliedProb));
    setText('sampleSize', a.sampleSize > 0 ? a.sampleSize.toLocaleString() : '--');

    const ep = a.edge * 100;
    setText('edgeNumber', (ep >= 0 ? '+' : '') + ep.toFixed(1) + '%');
    setStyle('edgeNumber', 'color', ep >= 0 ? '#3fb950' : '#f85149');

    const wl = $('warningsList');
    if (wl) wl.innerHTML = a.warnings.length === 0 ? '<span class="no-warnings">No active warnings</span>' : a.warnings.map(w => `<div class="warning-item">${w}</div>`).join('');

    const vol = d.volatility, base = vol.rollingVol[300] || vol.rollingVol[60] || 0.0001;
    for (const w of [10, 30, 60]) {
        const v = vol.rollingVol[w], bar = $('bar' + w);
        if (bar && v != null) { bar.style.width = Math.min((v / (base * 2)) * 100, 100) + '%'; bar.className = 'bar-fill' + (v > base * 1.2 ? ' hot' : v < base * 0.8 ? ' cold' : ''); }
    }
    setText('volRatio', vol.volRatio != null ? vol.volRatio.toFixed(2) + ' · ' + vol.volRatioLabel : '--');
    setText('volTrend', (vol.volTrend === 'EXPANDING' ? '↑' : vol.volTrend === 'CONTRACTING' ? '↓' : '→') + ' ' + vol.volTrend);
    setText('momentum', (vol.momentum?.direction === 'UP' ? '↑' : vol.momentum?.direction === 'DOWN' ? '↓' : '→') + ' ' + (vol.momentum?.direction ?? '--'));
}
function pct(v) { return (v * 100).toFixed(1) + '%'; }

// ── Controls ──────────────────────────────────────────────────────
function setDirection(dir) {
    $('btnUp')?.classList.toggle('active', dir === 'up');
    $('btnDown')?.classList.toggle('active', dir === 'down');
}
$('btnUp')?.addEventListener('click', () => { setDirection('up'); syncConfig(); });
$('btnDown')?.addEventListener('click', () => { setDirection('down'); syncConfig(); });
let dbt;
function syncConfig() {
    clearTimeout(dbt);
    dbt = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'update_config', barrier: parseFloat($('barrierInput')?.value ?? 2), payoutROI: parseFloat($('roiInput')?.value ?? 109), direction: $('btnUp')?.classList.contains('active') ? 'up' : 'down' }));
    }, 500);
}
$('barrierInput')?.addEventListener('input', syncConfig);
$('roiInput')?.addEventListener('input', syncConfig);


/* ================================================================
   TOOLBAR WIRING
   The toolbar sets the tool on ALL drawing managers.
   Drawings are placed on whichever chart is currently active.
   ================================================================ */

function getAllDrawingManagers() {
    return Object.values(slots).map(s => s.drawing).filter(Boolean);
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.dataset.tool;
        getAllDrawingManagers().forEach(m => m.setTool(tool));
    });
});

$('drawingColor')?.addEventListener('input', e => {
    getAllDrawingManagers().forEach(m => m.setColor(e.target.value));
});

$('btnDeleteDrawing')?.addEventListener('click', () => {
    getAllDrawingManagers().forEach(m => m.deleteSelected());
});

// Global delete key
window.addEventListener('keydown', e => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        getAllDrawingManagers().forEach(m => m.deleteSelected());
    }
});
