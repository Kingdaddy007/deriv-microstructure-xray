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
    timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#30363d', rightOffset: 5 },
    rightPriceScale: { borderColor: '#30363d' }
};
const CANDLE_OPTS = { upColor: '#3fb950', downColor: '#f85149', borderVisible: false, wickUpColor: '#3fb950', wickDownColor: '#f85149' };


/* ================================================================
   DRAWING MANAGER (v3 — Select & Edit upgrade)
   ================================================================
   Features: Hit-testing, Selection, Point Dragging, Shape Dragging
   Event Capture: Uses `addEventListener(..., true)` on container
   to intercept mouse events before they reach LightweightCharts 
   when drafting or interacting with drawings.
   ================================================================ */

function distToSegment(px, py, x1, y1, x2, y2, isRay) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    if (!isRay && t > 1) t = 1;
    if (t < 0) t = 0;
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

class DrawingManager {
    constructor(chartObj, seriesObj, containerId) {
        this.chart = chartObj;
        this.series = seriesObj;
        this.container = $(containerId);
        if (!this.chart || !this.series || !this.container) return;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'drawing-canvas';
        this.canvas.style.pointerEvents = 'none'; // NEVER blocking LHS
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this.drawings = [];
        this.selectedIdx = -1;
        this.hoveredIdx = -1;
        this.hoveredPtIdx = -1;

        this.activeTool = 'none';
        this.drawColor = '#58a6ff';

        this._drafting = false;
        this._points = [];
        this._mousePos = null;

        // Drag state
        this._dragging = false;
        this._dragInfo = null;

        this._resize();
        new ResizeObserver(() => this._resize()).observe(this.container);

        // Capture phase listeners on CONTAINER to preempt LHS
        this.container.addEventListener('mousedown', e => this._onDown(e), true);
        this.container.addEventListener('mousemove', e => this._onMove(e), true);
        this.container.addEventListener('mouseup', e => this._onUp(e), true);
        this.container.addEventListener('dblclick', e => this._onDbl(e), true);

        const render = () => { this._render(); requestAnimationFrame(render); };
        requestAnimationFrame(render);
    }

    setTool(tool) {
        this.activeTool = tool;
        this._drafting = false;
        this._points = [];
        this._dragging = false;
        this.selectedIdx = -1;
        if (tool !== 'none') this.canvas.style.cursor = 'crosshair';
        else this.canvas.style.cursor = 'default';
    }

    setColor(c) {
        this.drawColor = c;
        if (this.selectedIdx !== -1) {
            this.drawings[this.selectedIdx].color = c;
        }
    }

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

    // ── Coordinates ──
    _toPx(time, price) {
        try {
            let x = this.chart.timeScale().timeToCoordinate(time);
            let y = this.series.priceToCoordinate(price);
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

    // ── Hit Testing ──
    _hitTest(cx, cy) {
        for (let i = this.drawings.length - 1; i >= 0; i--) {
            const d = this.drawings[i];

            // 1. Check points for resizing (radius 8)
            if (d.pts) {
                for (let j = 0; j < d.pts.length; j++) {
                    const p = this._toPx(d.pts[j].time, d.pts[j].price);
                    if (p && Math.hypot(cx - p.x, cy - p.y) < 8) return { idx: i, ptIdx: j };
                }
            }

            // 2. Check body
            if (d.type === 'hline') {
                const y = this.series.priceToCoordinate(d.price);
                if (y != null && Math.abs(cy - y) < 6) return { idx: i };
            }
            if (d.t === 'vol') processVol(d);

            // Keep track of spot for dynamic barriers
            if (d.t === 'tick') {
                lastKnownSpot = d.tick.price;
                if (frozenCenterPrice === null) updateGlobalBarriers();
            }
            if (d.type === 'vline') {
                const x = this.chart.timeScale().timeToCoordinate(d.time);
                if (x != null && Math.abs(cx - x) < 6) return { idx: i };
            }
            if (d.type === 'trendline' || d.type === 'ray') {
                const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                if (p0 && p1) {
                    const dist = distToSegment(cx, cy, p0.x, p0.y, p1.x, p1.y, d.type === 'ray');
                    if (dist < 6) return { idx: i };
                }
            }
            if (d.type === 'rectangle') {
                const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                if (p0 && p1) {
                    const minX = Math.min(p0.x, p1.x), maxX = Math.max(p0.x, p1.x);
                    const minY = Math.min(p0.y, p1.y), maxY = Math.max(p0.y, p1.y);
                    if (cx >= minX && cx <= maxX && cy >= minY && cy <= Math.abs(maxY)) return { idx: i }; // Click anywhere inside
                }
            }
            if (d.type === 'triangle') {
                const pts = d.pts.map(p => this._toPx(p.time, p.price)).filter(Boolean);
                if (pts.length === 3) {
                    // Simple bounding box hit test for triangle
                    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
                    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
                    if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) return { idx: i };
                }
            }
            if (d.type === 'text') {
                const px = this._toPx(d.time, d.price);
                if (px && Math.hypot(cx - px.x, cy - px.y) < 20) return { idx: i };
            }
        }
        return null; // NO HIT
    }

    // ── Mouse Handlers ──
    _onDown(e) {
        const pos = this._canvasXY(e);
        const pt = this._fromPx(pos.x, pos.y);
        if (!pt) return;

        // Selection / Editing mode
        if (this.activeTool === 'none') {
            const hit = this._hitTest(pos.x, pos.y);
            if (hit) {
                this.selectedIdx = hit.idx;
                this._dragging = true;
                this._dragInfo = {
                    ptIdx: hit.ptIdx,
                    startPos: pos,
                    startDraw: JSON.parse(JSON.stringify(this.drawings[hit.idx])) // clone to compute relative offsets safely
                };

                // IMPORTANT: Stop LHS from panning
                e.preventDefault();
                e.stopPropagation();
            } else {
                this.selectedIdx = -1; // Deselect
            }
            return;
        }

        // --- Drafting new shape below ---
        e.preventDefault();
        e.stopPropagation();

        if (this.activeTool === 'hline') {
            this.drawings.push({ type: 'hline', price: pt.price, color: this.drawColor });
            this.setTool('none');
            return;
        }
        if (this.activeTool === 'vline') {
            this.drawings.push({ type: 'vline', time: pt.time, color: this.drawColor });
            this.setTool('none');
            return;
        }
        if (this.activeTool === 'text') {
            this._placeText(pos, pt);
            return;
        }

        if (['trendline', 'ray', 'rectangle'].includes(this.activeTool)) {
            if (!this._drafting) {
                this._drafting = true;
                this._points = [pt];
            } else {
                this._points.push(pt);
                this.drawings.push({ type: this.activeTool, pts: [...this._points], color: this.drawColor });
                this.setTool('none');
            }
            return;
        }

        if (this.activeTool === 'triangle') {
            this._points.push(pt);
            this._drafting = true;
            if (this._points.length === 3) {
                this.drawings.push({ type: 'triangle', pts: [...this._points], color: this.drawColor });
                this.setTool('none');
            }
            return;
        }
    }

    _onMove(e) {
        const pos = this._canvasXY(e);

        if (this.activeTool === 'none') {
            if (this._dragging && this.selectedIdx !== -1) {
                e.preventDefault();
                e.stopPropagation();

                const d = this.drawings[this.selectedIdx];
                const info = this._dragInfo;
                const pt = this._fromPx(pos.x, pos.y);
                if (!pt) return;

                if (info.ptIdx !== undefined) {
                    // Drag single control point
                    d.pts[info.ptIdx].time = pt.time;
                    d.pts[info.ptIdx].price = pt.price;
                } else {
                    // Drag entire shape based on pixel delta
                    const dx = pos.x - info.startPos.x;
                    const dy = pos.y - info.startPos.y;

                    if (d.type === 'hline') {
                        const sy = this.series.priceToCoordinate(info.startDraw.price);
                        const np = this.series.coordinateToPrice(sy + dy);
                        if (np != null) d.price = np;
                    }
                    else if (d.type === 'vline') {
                        const sx = this.chart.timeScale().timeToCoordinate(info.startDraw.time);
                        const nt = this.chart.timeScale().coordinateToTime(sx + dx);
                        if (nt != null) d.time = nt;
                    }
                    else if (d.type === 'text') {
                        const sx = this.chart.timeScale().timeToCoordinate(info.startDraw.time);
                        const sy = this.series.priceToCoordinate(info.startDraw.price);
                        const nt = this.chart.timeScale().coordinateToTime(sx + dx);
                        const np = this.series.coordinateToPrice(sy + dy);
                        if (nt != null) d.time = nt;
                        if (np != null) d.price = np;
                    }
                    else if (d.pts) {
                        for (let i = 0; i < d.pts.length; i++) {
                            const sd = info.startDraw.pts[i];
                            const sx = this.chart.timeScale().timeToCoordinate(sd.time);
                            const sy = this.series.priceToCoordinate(sd.price);
                            if (sx != null && sy != null) {
                                const nt = this.chart.timeScale().coordinateToTime(sx + dx);
                                const np = this.series.coordinateToPrice(sy + dy);
                                if (nt != null) d.pts[i].time = nt;
                                if (np != null) d.pts[i].price = np;
                            }
                        }
                    }
                }
            } else {
                // Hover Effects
                const hit = this._hitTest(pos.x, pos.y);
                this.hoveredIdx = hit ? hit.idx : -1;
                this.hoveredPtIdx = hit ? hit.ptIdx : -1;

                if (hit) {
                    this.canvas.style.cursor = hit.ptIdx !== undefined ? 'grab' : 'pointer';
                } else {
                    this.canvas.style.cursor = 'default';
                }
            }
            return;
        }

        // If drafting
        e.preventDefault();
        e.stopPropagation();
        if (this._drafting) {
            this._mousePos = pos;
            this.canvas.style.cursor = 'crosshair';
        }
    }

    _onUp(e) {
        if (this._dragging) {
            e.preventDefault();
            e.stopPropagation();
            this._dragging = false;
        }
    }

    _onDbl(e) {
        if (this._drafting) {
            this.setTool('none');
        }
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
                if (txt) {
                    this.drawings.push({ type: 'text', text: txt, time: chartPt.time, price: chartPt.price, color: this.drawColor });
                }
                overlay.style.display = 'none';
                input.removeEventListener('keydown', done);
                input.removeEventListener('blur', done);
                this.setTool('none');
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
            const isSelected = (i === this.selectedIdx);
            const isHovered = (i === this.hoveredIdx);

            ctx.save();
            ctx.strokeStyle = d.color;
            ctx.fillStyle = d.color;
            ctx.lineWidth = isSelected ? 3 : (isHovered ? 2.5 : 1.5);
            ctx.font = '12px Inter, sans-serif';

            // Point handles
            if ((isSelected || isHovered) && d.pts) {
                d.pts.forEach((pt, j) => {
                    const p = this._toPx(pt.time, pt.price);
                    if (p) {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, j === this.hoveredPtIdx ? 6 : 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });
            }

            switch (d.type) {
                case 'hline': {
                    const y = this.series.priceToCoordinate(d.price);
                    if (y != null) {
                        ctx.setLineDash([5, 4]);
                        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.fillText(d.price.toFixed(2), 4, y - 4);
                    }
                    break;
                }
                case 'vline': {
                    const x = this.chart.timeScale().timeToCoordinate(d.time);
                    if (x != null) {
                        ctx.setLineDash([5, 4]);
                        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
                        ctx.setLineDash([]);
                    }
                    break;
                }
                case 'trendline':
                case 'ray': {
                    const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                    const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                    if (p0 && p1) {
                        let ex = p1.x, ey = p1.y;
                        if (d.type === 'ray') {
                            const dx = p1.x - p0.x, dy = p1.y - p0.y;
                            if (Math.abs(dx) > 0.01) { const t = (W - p0.x) / dx; ex = W; ey = p0.y + dy * t; }
                        }
                        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(ex, ey); ctx.stroke();
                    }
                    break;
                }
                case 'rectangle': {
                    const p0 = this._toPx(d.pts[0].time, d.pts[0].price);
                    const p1 = this._toPx(d.pts[1].time, d.pts[1].price);
                    if (p0 && p1) {
                        ctx.globalAlpha = isSelected ? 0.2 : 0.1;
                        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
                        ctx.globalAlpha = 1;
                        ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
                    }
                    break;
                }
                case 'triangle': {
                    const pts = d.pts.map(p => this._toPx(p.time, p.price));
                    if (pts.every(Boolean)) {
                        ctx.globalAlpha = isSelected ? 0.2 : 0.1;
                        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.closePath(); ctx.fill();
                        ctx.globalAlpha = 1;
                        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.closePath(); ctx.stroke();
                    }
                    break;
                }
                case 'text': {
                    const px = this._toPx(d.time, d.price);
                    if (px) {
                        ctx.fillText(d.text, px.x + 5, px.y - 5);
                        ctx.beginPath(); ctx.arc(px.x, px.y, 4, 0, Math.PI * 2); ctx.fill();
                    }
                    break;
                }
            }
            ctx.restore();
        }

        // Option 1: 2-Minute Window Shading
        if (window.lastKnownEpoch) {
            const xRight = this.chart.timeScale().timeToCoordinate(window.lastKnownEpoch);
            const xLeft = this.chart.timeScale().timeToCoordinate(window.lastKnownEpoch - 120);

            if (xRight != null && xLeft != null) {
                // Bound to canvas
                const drawLeft = Math.max(0, xLeft);
                const drawWidth = xRight - drawLeft;

                if (drawWidth > 0) {
                    ctx.save();
                    // Faint blue shading
                    ctx.fillStyle = 'rgba(88, 166, 255, 0.05)';
                    ctx.fillRect(drawLeft, 0, drawWidth, H);

                    // Left bounding dotted line
                    if (xLeft >= 0) {
                        ctx.strokeStyle = 'rgba(88, 166, 255, 0.4)';
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(xLeft, 0); ctx.lineTo(xLeft, H);
                        ctx.stroke();

                        ctx.fillStyle = 'rgba(88, 166, 255, 0.6)';
                        ctx.fillText('2m Window', Math.min(xLeft + 4, W - 80), H - 10);
                    }
                    ctx.restore();
                }
            }
        }

        // Draft preview
        if (this._drafting && this._points.length > 0 && this._mousePos) {
            const last = this._points[this._points.length - 1];
            const p0 = this._toPx(last.time, last.price);
            if (p0) {
                ctx.save();
                ctx.strokeStyle = this.drawColor; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
                ctx.setLineDash([4, 3]);
                ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(this._mousePos.x, this._mousePos.y); ctx.stroke();

                // Rectangle drafted preview
                if (this.activeTool === 'rectangle') {
                    ctx.strokeRect(p0.x, p0.y, this._mousePos.x - p0.x, this._mousePos.y - p0.y);
                }
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

    /** Scroll the chart's time axis to the live edge */
    scrollToNow() {
        if (this.chart) this.chart.timeScale().scrollToRealTime();
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
// Tick data buffer (for grid panels showing tick chart)
let tickBuf = [];

// ── Barrier State ─────────────────────────────────────────────────
let barrierOffset = parseFloat($('barrierInput')?.value) || 2.0;
let barrierDirection = 'up';
let currentSpot = null;
// Store price line references per slot key
const barrierLines = {};

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

// ── Fullscreen Toggle ─────────────────────────────────────────────
document.querySelectorAll('.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetId = btn.dataset.target;
        const targetEl = $(targetId);
        if (!targetEl) return;

        const isFullscreen = targetEl.classList.contains('fullscreen');
        if (isFullscreen) {
            targetEl.classList.remove('fullscreen');
            btn.innerHTML = '⛶';
        } else {
            targetEl.classList.add('fullscreen');
            btn.innerHTML = '✖';
        }

        // Force resize on all slots that might be affected
        setTimeout(() => {
            Object.values(slots).forEach(s => {
                if (s.chart && s.containerId) {
                    const el = $(s.containerId);
                    if (el && el.clientWidth > 0) {
                        s.chart.applyOptions({ width: el.clientWidth, height: Math.max(100, el.clientHeight) });
                    }
                }
            });
        }, 50);
    });
});

// Option 1: Dev Stats Toggle
const btnToggleStats = $('btnToggleStats');
const devStatsPanel = $('devStatsPanel');
if (btnToggleStats && devStatsPanel) {
    btnToggleStats.addEventListener('click', () => {
        const isHidden = devStatsPanel.style.display === 'none';
        devStatsPanel.style.display = isHidden ? 'block' : 'none';
        btnToggleStats.classList.toggle('active', isHidden);
    });
}

const btnMarkNow = $('btnMarkNow');
if (btnMarkNow) {
    btnMarkNow.addEventListener('click', () => {
        if (!window.lastKnownEpoch) return;
        Object.values(slots).forEach(s => {
            if (s.drawing && s.chart) {
                s.drawing.drawings.push({
                    type: 'vline',
                    time: window.lastKnownEpoch,
                    color: s.drawing.drawColor,
                    lineWidth: 2
                });
                s.drawing._requestRender();
            }
        });
    });
}

// ⏩ Scroll to Now button
const btnScrollNow = $('btnScrollNow');
if (btnScrollNow) {
    btnScrollNow.addEventListener('click', () => {
        Object.values(slots).forEach(s => s.scrollToNow());
    });
}

// ── Flexible Grid Restyling & Dragging ────────────────────────────
const gridResizer = $('gridResizer');
const gridLeft = $('gridLeft');
const gridRight = $('gridRight');

if (gridResizer && gridLeft && gridRight) {
    let isResizing = false;

    gridResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        gridResizer.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const viewGrid = $('viewGrid');
        if (!viewGrid) return;

        const rect = viewGrid.getBoundingClientRect();
        // Calculate percentage of mouse X relative to grid container width
        // Min 10%, Max 90%
        let pct = ((e.clientX - rect.left) / rect.width) * 100;
        if (pct < 10) pct = 10;
        if (pct > 90) pct = 90;

        gridLeft.style.flex = `0 0 ${pct}%`;
        gridRight.style.flex = `0 0 ${100 - pct}%`;
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            gridResizer.classList.remove('is-resizing');
            document.body.style.cursor = '';

            // Re-trigger resize observer for active charts
            requestAnimationFrame(() => {
                if (slots.gridL.chart) slots.gridL.chart.applyOptions({ width: $('gridChartLeft').clientWidth });
                if (slots.gridR.chart) slots.gridR.chart.applyOptions({ width: $('gridChartRight').clientWidth });
            });
        }
    });
}
function getGridTf(side) {
    return $(side === 'left' ? 'gridLeftTf' : 'gridRightTf')?.value ?? '5s';
}

function rebuildGridPanel(side) {
    const tf = getGridTf(side);
    const slot = side === 'left' ? slots.gridL : slots.gridR;

    if (!slot.chart) return; // Not yet initialised

    // Remove old series (and its barrier line reference)
    if (slot.series) {
        const slotKey = side === 'left' ? 'gridL' : 'gridR';
        delete barrierLines[slotKey]; // stale ref — will be recreated
        slot.chart.removeSeries(slot.series);
        slot.series = null;
    }

    if (tf === 'tick') {
        // Line series for tick chart
        slot.series = slot.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#58a6ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true
        });
        // Feed tick buffer
        if (tickBuf.length) slot.series.setData([...tickBuf]);
    } else {
        // Candle series for timeframe charts
        slot.series = slot.chart.addSeries(LightweightCharts.CandlestickSeries, CANDLE_OPTS);
        const data = candleBuf[tf] ?? [];
        if (data.length) slot.series.setData(data);
    }

    slot.chart.timeScale().scrollToRealTime();
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

// Live forming candle — updates the current candle in real-time (tick by tick)
function updateLiveCandle(tf, candle) {
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
            case 'tick': {
                slots.tick.update(msg.data);
                window.lastKnownEpoch = msg.data.time;
                // Buffer tick for grid panels
                tickBuf.push(msg.data);
                // Also push tick to any grid panels showing the tick chart
                if (getGridTf('left') === 'tick') slots.gridL?.update(msg.data);
                if (getGridTf('right') === 'tick') slots.gridR?.update(msg.data);
                // Update barrier line with new spot price
                currentSpot = msg.data.value;
                updateBarrierLines();
                break;
            }
            case 'countdown': updateCountdowns(msg.data); break;
            case 'candle_closed': pushCandle(msg.timeframe, msg.data); break;
            case 'candle_update': updateLiveCandle(msg.timeframe, msg.data); break;
            case 'analytics': handleAnalytics(msg.data); break;
            case 'history': loadHistory(msg.data); break;
        }
    } catch (e) { console.error('[WS]', e); }
};

function loadHistory(h) {
    if (h.historicalTicks?.length) {
        slots.tick.setData(h.historicalTicks);
        tickBuf = [...h.historicalTicks];
    }
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
    if (cfg.barrier != null) barrierOffset = parseFloat(cfg.barrier);
    if (cfg.direction) setDirection(cfg.direction);
}

// ── Barrier Line System ──────────────────────────────────────────

const BARRIER_LINE_OPTS = {
    color: '#00e5ff',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: 'Barrier',
};

/**
 * Creates or updates a barrier price line on a given slot.
 * Uses series.createPriceLine() (reused via barrierLines map).
 */
function setBarrierOnSlot(slotKey, slot, price) {
    if (!slot?.series) return;
    try {
        if (barrierLines[slotKey]) {
            // Update existing line
            barrierLines[slotKey].applyOptions({ price });
        } else {
            // Create new line
            barrierLines[slotKey] = slot.series.createPriceLine({
                ...BARRIER_LINE_OPTS,
                price,
            });
        }
    } catch (e) {
        // If series was recreated (e.g. grid panel switch), line ref is stale — recreate
        try {
            barrierLines[slotKey] = slot.series.createPriceLine({
                ...BARRIER_LINE_OPTS,
                price,
            });
        } catch (_) { /* ignore */ }
    }
}

/**
 * Remove a barrier line from a slot (e.g. when grid panel switches type).
 */
function removeBarrierFromSlot(slotKey, slot) {
    if (barrierLines[slotKey] && slot?.series) {
        try { slot.series.removePriceLine(barrierLines[slotKey]); } catch (_) { }
    }
    delete barrierLines[slotKey];
}

/**
 * Recalculates the barrier price and updates/creates the line on all active charts.
 */
function updateBarrierLines() {
    if (currentSpot == null) return;

    const barrierPrice = barrierDirection === 'up'
        ? currentSpot + barrierOffset
        : currentSpot - barrierOffset;

    // Update on all main chart slots
    const mainSlots = ['tick', '5s', '10s', '15s', '30s', '1m', '5m'];
    for (const key of mainSlots) {
        setBarrierOnSlot(key, slots[key], barrierPrice);
    }

    // Update on grid panels
    setBarrierOnSlot('gridL', slots.gridL, barrierPrice);
    setBarrierOnSlot('gridR', slots.gridR, barrierPrice);
}

/**
 * Set the touch direction (up or down) and update the UI + barrier.
 */
function setDirection(dir) {
    barrierDirection = dir;
    const btnUp = $('btnUp');
    const btnDown = $('btnDown');
    if (btnUp) btnUp.classList.toggle('active', dir === 'up');
    if (btnDown) btnDown.classList.toggle('active', dir === 'down');
    updateBarrierLines();
}

// ── Sidebar Barrier Controls ─────────────────────────────────────
$('barrierInput')?.addEventListener('input', (e) => {
    barrierOffset = parseFloat(e.target.value) || 0;
    updateBarrierLines();
    // Notify server of config change
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_config', barrier: barrierOffset }));
    }
});

$('btnUp')?.addEventListener('click', () => {
    setDirection('up');
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_config', direction: 'up' }));
    }
});

$('btnDown')?.addEventListener('click', () => {
    setDirection('down');
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_config', direction: 'down' }));
    }
});

// ── Theme Toggle ──────────────────────────────────────────────────
let isLightMode = false;
$('themeToggle')?.addEventListener('click', () => {
    isLightMode = !isLightMode;
    document.body.classList.toggle('light-mode', isLightMode);
    $('themeToggle').textContent = isLightMode ? '☀️' : '🌙';

    // Update all existing charts
    const newOptions = isLightMode ? {
        layout: { background: { color: '#ffffff' }, textColor: '#1f2328' },
        grid: { vertLines: { color: '#d0d7de' }, horzLines: { color: '#d0d7de' } },
        timeScale: { borderColor: '#d0d7de' },
        rightPriceScale: { borderColor: '#d0d7de' }
    } : THEME; // Fallback to original dark THEME

    Object.values(slots).forEach(slot => {
        if (slot.chart) slot.chart.applyOptions(newOptions);
    });
});

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

    // Option 1: Dev Stats Panel
    if (d.serverStats) {
        setText('statUptime', `${d.serverStats.uptime}s`);
        setText('statMemory', `${d.serverStats.memory}MB`);
        setText('statConnections', d.serverStats.connections);
        setText('statGaps', d.serverStats.gaps);
    }

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
