/* ================================================================
   Micro-Structure X-Ray — app.js (v4 Phase 5)
   Features added:
   1. 7 chart timeframes: 5s, 10s, 15s, 30s, 1m, 2m, 5m
   2. Candle countdown timer per chart tab
   3. Flexible grid — user picks timeframe per panel
   4. Full drawing toolkit via canvas overlay (hline, vline, ray,
      trendline, rectangle, triangle, Fib retracement, text/comment)
   5. Color picker per drawing + delete
   6. Paginated 4-hour history pre-fill
   ================================================================ */

'use strict';

// ── Safe DOM helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
function setStyle(id, p, v) { const e = $(id); if (e) e.style[p] = v; }

// ── State ─────────────────────────────────────────────────────────
let lastPrice = 0;

// ── Chart Theme ───────────────────────────────────────────────────
const chartTheme = {
    layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
    crosshair: { mode: 1 },
    timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#30363d' },
    rightPriceScale: { borderColor: '#30363d' }
};
const candleColors = { upColor: '#3fb950', downColor: '#f85149', borderVisible: false, wickUpColor: '#3fb950', wickDownColor: '#f85149' };

// ── Auto-Resize Chart Factory ─────────────────────────────────────
function makeChart(containerId, opts = {}) {
    const el = $(containerId);
    if (!el) return { chart: null, series: null };
    const chart = LightweightCharts.createChart(el, { ...chartTheme, ...opts, width: el.clientWidth, height: el.clientHeight });
    new ResizeObserver(() => {
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    }).observe(el);
    return chart;
}
function addCandles(chart) {
    return chart?.addSeries(LightweightCharts.CandlestickSeries, candleColors);
}
function addLine(chart) {
    return chart?.addSeries(LightweightCharts.LineSeries, { color: '#58a6ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true });
}

// ── Charts ────────────────────────────────────────────────────────
const tickChartObj = makeChart('tickChart');
const tickSeries = addLine(tickChartObj);

const charts = {
    '5s': { obj: makeChart('chart5s'), series: null },
    '10s': { obj: makeChart('chart10s'), series: null },
    '15s': { obj: makeChart('chart15s'), series: null },
    '30s': { obj: makeChart('chart30s'), series: null },
    '1m': { obj: makeChart('chart1m'), series: null },
    '5m': { obj: makeChart('chart5m'), series: null },
};
for (const [tf, c] of Object.entries(charts)) c.series = addCandles(c.obj);

// ── Flexible Grid ─────────────────────────────────────────────────
const gridLeftChart = makeChart('gridChartLeft');
const gridRightChart = makeChart('gridChartRight');
let gridLeftSeries = addCandles(gridLeftChart);
let gridRightSeries = addCandles(gridRightChart);

// Candle history buffers per timeframe for the grid
const candleBuffers = { '5s': [], '10s': [], '15s': [], '30s': [], '1m': [], '2m': [], '5m': [] };

function getGridTf(side) {
    return $(side === 'left' ? 'gridLeftTf' : 'gridRightTf')?.value ?? '5s';
}

function rebuildGridPanel(side) {
    const tf = getGridTf(side);
    const data = candleBuffers[tf] ?? [];
    if (side === 'left') {
        gridLeftSeries = addCandles(gridLeftChart);
        gridLeftSeries?.setData(data);
        gridLeftChart?.timeScale().scrollToRealTime();
    } else {
        gridRightSeries = addCandles(gridRightChart);
        gridRightSeries?.setData(data);
        gridRightChart?.timeScale().scrollToRealTime();
    }
}

$('gridLeftTf')?.addEventListener('change', () => rebuildGridPanel('left'));
$('gridRightTf')?.addEventListener('change', () => rebuildGridPanel('right'));

// Push a candle to the right series and buffer
function pushCandle(tf, candle) {
    if (!candleBuffers[tf]) return;
    const buf = candleBuffers[tf];
    if (buf.length > 0 && buf[buf.length - 1].time === candle.time) buf[buf.length - 1] = candle;
    else buf.push(candle);
    charts[tf]?.series?.update(candle);
    if (getGridTf('left') === tf) gridLeftSeries?.update(candle);
    if (getGridTf('right') === tf) gridRightSeries?.update(candle);
}

// ── Tab Switching ─────────────────────────────────────────────────
const allTabs = document.querySelectorAll('.tab');
const allViews = document.querySelectorAll('.chart-view');

allTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        allTabs.forEach(t => t.classList.remove('active'));
        allViews.forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        $(tab.dataset.view)?.classList.add('active');
        window.dispatchEvent(new Event('resize'));
    });
});

// ── Countdown ─────────────────────────────────────────────────────
const countdownMap = {
    '5s': { fill: 'cd5s', time: 'cdt5s' },
    '10s': { fill: 'cd10s', time: 'cdt10s' },
    '15s': { fill: 'cd15s', time: 'cdt15s' },
    '30s': { fill: 'cd30s', time: 'cdt30s' },
    '1m': { fill: 'cd1m', time: 'cdt1m' },
    '5m': { fill: 'cd5m', time: 'cdt5m' },
};

function updateCountdowns(data) {
    for (const [tf, ids] of Object.entries(countdownMap)) {
        const cd = data[tf];
        if (!cd) continue;
        const pct = Math.round(cd.pct * 100);
        setStyle(ids.fill, 'width', pct + '%');
        setText(ids.time, cd.remaining.toFixed(1) + 's');
    }
    // Grid inline countdowns
    const lt = getGridTf('left');
    const rt = getGridTf('right');
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
            case 'tick': tickSeries?.update(msg.data); break;
            case 'countdown': updateCountdowns(msg.data); break;
            case 'candle_closed': pushCandle(msg.timeframe, msg.data); break;
            case 'analytics': handleAnalytics(msg.data); break;
            case 'history': loadHistory(msg.data); break;
        }
    } catch (e) { console.error('[WS]', e); }
};

function loadHistory(h) {
    if (h.historicalTicks?.length) tickSeries?.setData(h.historicalTicks);
    const tfMap = { '5s': h.historicalC5s, '10s': h.historicalC10s, '15s': h.historicalC15s, '30s': h.historicalC30s, '1m': h.historicalC1m, '2m': h.historicalC2m, '5m': h.historicalC5m };
    for (const [tf, data] of Object.entries(tfMap)) {
        if (data?.length) {
            candleBuffers[tf] = [...data];
            charts[tf]?.series?.setData(data);
        }
    }
    // Init grid panels with their selected timeframes
    rebuildGridPanel('left');
    rebuildGridPanel('right');
    // Scroll all charts to live edge
    [tickChartObj, ...Object.values(charts).map(c => c.obj), gridLeftChart, gridRightChart]
        .forEach(c => c?.timeScale().scrollToRealTime());
}

// ── Config ────────────────────────────────────────────────────────
function applyConfig(cfg) {
    if ($('barrierInput')) $('barrierInput').value = cfg.barrier;
    if ($('roiInput')) $('roiInput').value = cfg.payoutROI;
    if (cfg.direction) setDirection(cfg.direction);
}

// ── Analytics ─────────────────────────────────────────────────────
function handleAnalytics(d) {
    const a = d.active;
    const priceColor = d.price > lastPrice ? '#3fb950' : d.price < lastPrice ? '#f85149' : '#c9d1d9';
    setText('currentPrice', d.price.toFixed(2));
    setStyle('currentPrice', 'color', priceColor);
    lastPrice = d.price;
    setText('tickCounter', `${d.tickCount} ticks`);

    const wu = $('warmupBadge');
    if (wu) { wu.style.display = d.warmupDone ? 'none' : 'inline-block'; wu.textContent = `Warming up ${d.tickCount}/300`; }

    setText('theoProb', a.theoretical != null ? pct(a.theoretical) : 'N/A');
    setText('empProb', a.empirical != null ? pct(a.empirical) : 'N/A');
    setText('ourProb', pct(a.ourProb));
    setText('derivProb', pct(a.impliedProb));
    setText('sampleSize', a.sampleSize > 0 ? a.sampleSize.toLocaleString() : '--');

    const edgePct = a.edge * 100;
    setText('edgeNumber', (edgePct >= 0 ? '+' : '') + edgePct.toFixed(1) + '%');
    setStyle('edgeNumber', 'color', edgePct >= 0 ? '#3fb950' : '#f85149');

    const warnEl = $('warningsList');
    if (warnEl) warnEl.innerHTML = a.warnings.length === 0
        ? '<span class="no-warnings">No active warnings</span>'
        : a.warnings.map(w => `<div class="warning-item">${w}</div>`).join('');

    const vol = d.volatility;
    const baseVal = vol.rollingVol[300] || vol.rollingVol[60] || 0.0001;
    for (const w of [10, 30, 60]) {
        const v = vol.rollingVol[w]; const bar = $('bar' + w);
        if (bar && v != null) { bar.style.width = Math.min((v / (baseVal * 2)) * 100, 100) + '%'; bar.className = 'bar-fill' + (v > baseVal * 1.2 ? ' hot' : v < baseVal * 0.8 ? ' cold' : ''); }
    }
    setText('volRatio', vol.volRatio != null ? vol.volRatio.toFixed(2) + ' · ' + vol.volRatioLabel : '--');
    const tc = vol.volTrend === 'EXPANDING' ? '↑' : vol.volTrend === 'CONTRACTING' ? '↓' : '→';
    setText('volTrend', `${tc} ${vol.volTrend}`);
    const mc = vol.momentum?.direction === 'UP' ? '↑' : vol.momentum?.direction === 'DOWN' ? '↓' : '→';
    setText('momentum', `${mc} ${vol.momentum?.direction ?? '--'}`);
}

function pct(val) { return (val * 100).toFixed(1) + '%'; }

// ── Controls ──────────────────────────────────────────────────────
function setDirection(dir) {
    $('btnUp')?.classList.toggle('active', dir === 'up');
    $('btnDown')?.classList.toggle('active', dir === 'down');
}
$('btnUp')?.addEventListener('click', () => { setDirection('up'); syncConfig(); });
$('btnDown')?.addEventListener('click', () => { setDirection('down'); syncConfig(); });

let debounce;
function syncConfig() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
            type: 'update_config',
            barrier: parseFloat($('barrierInput')?.value ?? 2),
            payoutROI: parseFloat($('roiInput')?.value ?? 109),
            direction: $('btnUp')?.classList.contains('active') ? 'up' : 'down'
        }));
    }, 500);
}
$('barrierInput')?.addEventListener('input', syncConfig);
$('roiInput')?.addEventListener('input', syncConfig);


/* ================================================================
   DRAWING MANAGER
   ================================================================
   Strategy: create a transparent canvas overlay on top of each chart container.
   We use the LightweightCharts coordinate APIs to map price/time ↔ pixels.
   All drawings are stored in an array and re-rendered on every frame.
   ================================================================ */

class DrawingManager {
    constructor(chartObj, containerId) {
        this.chart = chartObj;
        this.containerEl = $(containerId);
        if (!this.containerEl || !this.chart) return;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'drawing-canvas';
        this.containerEl.style.position = 'relative';
        this.containerEl.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.drawings = [];
        this.selectedIdx = -1;
        this.currentTool = 'none';
        this.drawColor = '#f59e0b';

        // In-progress drawing state
        this._drafting = false;
        this._points = [];
        this._triStep = 0;

        this._resize();
        new ResizeObserver(() => this._resize()).observe(this.containerEl);
        this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', e => this._onMouseUp(e));
        this.canvas.addEventListener('dblclick', e => this._onDblClick(e));
        window.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected(); });

        // Redraw continuously (60fps)
        const loop = () => { this._render(); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
    }

    setTool(tool) {
        this.currentTool = tool;
        const active = tool !== 'none';
        this.canvas.classList.toggle('drawing-active', active);
        this._drafting = false;
        this._points = [];
        this._triStep = 0;
    }

    setColor(color) { this.drawColor = color; }
    deleteSelected() {
        if (this.selectedIdx >= 0) {
            this.drawings.splice(this.selectedIdx, 1);
            this.selectedIdx = -1;
        }
    }

    _resize() {
        if (!this.containerEl || !this.canvas) return;
        this.canvas.width = this.containerEl.clientWidth;
        this.canvas.height = this.containerEl.clientHeight;
    }

    // Convert chart price/time to canvas pixels
    _toPx(time, price) {
        const ts = this.chart.timeScale();
        const ps = this.chart.priceScale('right');
        try {
            const x = ts.timeToCoordinate(time);
            const y = this.chart.priceToCoordinate(price);
            return { x, y };
        } catch { return null; }
    }

    // Convert canvas pixels to chart price/time
    _fromPx(x, y) {
        const ts = this.chart.timeScale();
        try {
            const time = ts.coordinateToTime(x);
            const price = this.chart.coordinateToPrice(y);
            return { time, price };
        } catch { return null; }
    }

    _clientToCanvas(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onMouseDown(e) {
        if (this.currentTool === 'none') return;
        const pos = this._clientToCanvas(e);
        const pt = this._fromPx(pos.x, pos.y);
        if (!pt || pt.time == null || pt.price == null) return;

        if (this.currentTool === 'hline') {
            this.drawings.push({ type: 'hline', price: pt.price, color: this.drawColor });
            return;
        }
        if (this.currentTool === 'vline') {
            this.drawings.push({ type: 'vline', time: pt.time, color: this.drawColor });
            return;
        }
        if (this.currentTool === 'text') {
            this._placeText(pos.x, pos.y, pt);
            return;
        }
        // 2-point tools
        if (['trendline', 'ray', 'rectangle', 'fib'].includes(this.currentTool)) {
            if (!this._drafting) { this._drafting = true; this._points = [pt]; }
            else {
                this._points.push(pt);
                this.drawings.push({ type: this.currentTool, pts: [...this._points], color: this.drawColor });
                this._drafting = false; this._points = [];
            }
        }
        // 3-point triangle
        if (this.currentTool === 'triangle') {
            this._points.push(pt);
            if (this._points.length === 3) {
                this.drawings.push({ type: 'triangle', pts: [...this._points], color: this.drawColor });
                this._drafting = false; this._points = [];
            } else { this._drafting = true; }
        }
    }

    _onMouseMove(e) {
        if (!this._drafting) return;
        this._mousePos = this._clientToCanvas(e);
    }

    _onMouseUp(e) { /* all logic in mousedown */ }
    _onDblClick(e) { this._drafting = false; this._points = []; }

    _placeText(canvasX, canvasY, chartPt) {
        const overlay = $('textInputOverlay');
        const input = $('textInputField');
        if (!overlay || !input) return;
        const rect = this.containerEl.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.left = (rect.left + canvasX) + 'px';
        overlay.style.top = (rect.top + canvasY) + 'px';
        input.value = '';
        input.focus();
        const onConfirm = (ev) => {
            if (ev.key === 'Enter' || ev.type === 'blur') {
                const txt = input.value.trim();
                if (txt) this.drawings.push({ type: 'text', text: txt, time: chartPt.time, price: chartPt.price, color: this.drawColor });
                overlay.style.display = 'none';
                input.removeEventListener('keydown', onConfirm);
                input.removeEventListener('blur', onConfirm);
            }
        };
        input.addEventListener('keydown', onConfirm);
        input.addEventListener('blur', onConfirm);
    }

    _render() {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        for (let i = 0; i < this.drawings.length; i++) {
            const d = this.drawings[i];
            ctx.save();
            ctx.strokeStyle = d.color; ctx.fillStyle = d.color;
            ctx.lineWidth = i === this.selectedIdx ? 2.5 : 1.5;
            ctx.font = '12px Inter, sans-serif';

            if (d.type === 'hline') {
                const y = this.chart.priceToCoordinate(d.price);
                if (y == null) { ctx.restore(); continue; }
                ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
                ctx.setLineDash([]); ctx.fillText(d.price.toFixed(2), 4, y - 3);
            }
            else if (d.type === 'vline') {
                const x = this.chart.timeScale().timeToCoordinate(d.time);
                if (x == null) { ctx.restore(); continue; }
                ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
            }
            else if (d.type === 'trendline' || d.type === 'ray') {
                const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                if (!p0 || !p1) { ctx.restore(); continue; }
                let ex = p1.x, ey = p1.y;
                if (d.type === 'ray') {
                    // Extend to far right
                    const dx = p1.x - p0.x, dy = p1.y - p0.y;
                    if (dx !== 0) { const t = (W - p0.x) / dx; ex = W; ey = p0.y + dy * t; }
                }
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(ex, ey); ctx.stroke();
            }
            else if (d.type === 'rectangle') {
                const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                if (!p0 || !p1) { ctx.restore(); continue; }
                ctx.globalAlpha = 0.12;
                ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
                ctx.globalAlpha = 1;
                ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
            }
            else if (d.type === 'triangle') {
                const p = d.pts.map(pt => this._toPx(pt.time, pt.price));
                if (p.some(pp => !pp)) { ctx.restore(); continue; }
                ctx.globalAlpha = 0.1;
                ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.closePath(); ctx.fill();
                ctx.globalAlpha = 1;
                ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.closePath(); ctx.stroke();
            }
            else if (d.type === 'fib') {
                const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                if (!p0 || !p1) { ctx.restore(); continue; }
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
                const priceRange = d.pts[0].price - d.pts[1].price;
                for (const lvl of levels) {
                    const p = d.pts[1].price + priceRange * lvl;
                    const y = this.chart.priceToCoordinate(p);
                    if (y == null) continue;
                    ctx.globalAlpha = 0.7;
                    ctx.beginPath(); ctx.setLineDash([4, 3]); ctx.moveTo(p0.x, y); ctx.lineTo(p1.x, y); ctx.stroke(); ctx.setLineDash([]);
                    ctx.globalAlpha = 1;
                    ctx.fillText((lvl * 100).toFixed(1) + '%  ' + p.toFixed(2), Math.min(p0.x, p1.x) + 3, y - 3);
                }
            }
            else if (d.type === 'text') {
                const px = this._toPx(d.time, d.price);
                if (!px) { ctx.restore(); continue; }
                ctx.fillText(d.text, px.x + 4, px.y - 4);
                ctx.beginPath(); ctx.arc(px.x, px.y, 3, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }

        // Render in-progress draft line
        if (this._drafting && this._points.length > 0 && this._mousePos) {
            const p0 = this._toPx(this._points[this._points.length - 1].time, this._points[this._points.length - 1].price);
            if (p0) {
                ctx.save();
                ctx.strokeStyle = this.drawColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 3]);
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(this._mousePos.x, this._mousePos.y); ctx.stroke();
                ctx.restore();
            }
        }
    }
}

// ── Create Drawing Managers for each chart container ─────────────
const drawManagers = {
    tick: new DrawingManager(tickChartObj, 'tickChart'),
    '5s': new DrawingManager(charts['5s'].obj, 'chart5s'),
    '10s': new DrawingManager(charts['10s'].obj, 'chart10s'),
    '15s': new DrawingManager(charts['15s'].obj, 'chart15s'),
    '30s': new DrawingManager(charts['30s'].obj, 'chart30s'),
    '1m': new DrawingManager(charts['1m'].obj, 'chart1m'),
    '5m': new DrawingManager(charts['5m'].obj, 'chart5m'),
};

// ── Drawing Toolbar ───────────────────────────────────────────────
function getActiveManager() {
    const activeTab = document.querySelector('.tab.active');
    const view = activeTab?.dataset?.view;
    const map = { tickView: 'tick', view5s: '5s', view10s: '10s', view15s: '15s', view30s: '30s', view1m: '1m', view5m: '5m' };
    return drawManagers[map[view]] ?? null;
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.dataset.tool;
        Object.values(drawManagers).forEach(m => m?.setTool?.(tool));
    });
});

$('drawingColor')?.addEventListener('input', (e) => {
    Object.values(drawManagers).forEach(m => m?.setColor?.(e.target.value));
});

$('btnDeleteDrawing')?.addEventListener('click', () => {
    getActiveManager()?.deleteSelected();
});
