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
let currentSymbol = null;

// ── Chart Theme ───────────────────────────────────────────────────
const THEME = {
    layout: { background: { color: 'transparent' }, textColor: '#8b949e' },
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
   TIME BLOCK QUADRANT OVERLAY
   ================================================================ */

/* ================================================================
   TIME BLOCK QUADRANT OVERLAY
   ================================================================ */

// ---------- Time extraction (seconds) ----------
function getPointTimeSec(d) {
    if (!d) return null;
    const raw = d.time ?? d.timestamp ?? null;
    if (raw == null) return null;
    return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
}

// ---------- Price extraction (supports candles + ticks/line) ----------
function getPointHighLow(d) {
    if (!d) return null;

    // Candles
    if (typeof d.high === 'number' && typeof d.low === 'number') {
        return { high: d.high, low: d.low };
    }

    // Tick/line points
    if (typeof d.value === 'number') {
        return { high: d.value, low: d.value };
    }

    // Fallbacks
    if (typeof d.close === 'number') return { high: d.close, low: d.close };
    if (typeof d.price === 'number') return { high: d.price, low: d.price };

    return null;
}

// ---------- Binary search: first index i where time >= target ----------
function lowerBoundTime(data, targetTimeSec) {
    let lo = 0, hi = data.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const t = getPointTimeSec(data[mid]);
        if (t == null) { lo = mid + 1; continue; }
        if (t < targetTimeSec) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// ---------- Find main pane canvas (plot area) ----------
function findMainPaneCanvas(plotEl) {
    const canvases = plotEl.querySelectorAll('canvas');
    if (!canvases.length) return null;

    // Usually the pane canvas is the largest area canvas.
    let best = null;
    let bestArea = -1;
    for (const c of canvases) {
        const r = c.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) {
            bestArea = area;
            best = c;
        }
    }
    return best;
}

/**
 * Convert UTC boundary time -> X coordinate at BAR EDGE (not center)
 * using: boundary time -> index -> logical edge.
 *
 * This is the "no drift / TradingView feel" mapping.
 */
function boundaryTimeToX_edge(timeScale, data, boundaryTimeSec) {
    const n = data.length;
    if (n < 2) return null;

    const idx = lowerBoundTime(data, boundaryTimeSec);

    // Prefer logicalToCoordinate because it's truly ordinal/bar-based.
    if (typeof timeScale.logicalToCoordinate === 'function') {
        const xInt = timeScale.logicalToCoordinate(Math.floor(idx));
        const xHalf = timeScale.logicalToCoordinate(idx - 0.5);
        if (xHalf != null && !Number.isNaN(xHalf) && xHalf !== 0) return xHalf;
        if (xInt != null && !Number.isNaN(xInt)) return xInt;
    }

    // Fallback: midpoint between neighboring bar centers using timeToCoordinate
    const centerX = (i) => {
        const t = getPointTimeSec(data[i]);
        if (t == null) return null;
        return timeScale.timeToCoordinate(t);
    };

    if (idx <= 0) {
        const x0 = centerX(0);
        const x1 = centerX(1);
        if (x0 == null) return null;
        const spacing = (x1 != null) ? (x1 - x0) : 10;
        return x0 - spacing / 2;
    }

    if (idx >= n) {
        const xN = centerX(n - 1);
        const xP = centerX(n - 2);
        if (xN == null) return null;
        const spacing = (xP != null) ? (xN - xP) : 10;
        return xN + spacing / 2;
    }

    const xL = centerX(idx - 1);
    const xR = centerX(idx);
    if (xL == null || xR == null) return null;
    return (xL + xR) / 2;
}

class TimeBlockOverlay {
    /**
     * @param {Object} cfg
     * @param {HTMLElement} cfg.slotContainerEl  - outer slot container (contains .tv-chart)
     * @param {HTMLElement} cfg.plotEl           - the exact element passed to createChart (e.g. .tv-chart)
     * @param {Object} cfg.chart                - Lightweight chart instance
     * @param {Object} cfg.series               - Series used for priceToCoordinate
     * @param {() => Array} cfg.getData         - returns the SAME array used to setData/update the series
     * @param {number} cfg.intervalSec          - chart timeframe seconds (tick chart can set 1)
     */
    constructor(cfg) {
        this.slotContainerEl = cfg.slotContainerEl;
        this.plotEl = cfg.plotEl;
        this.chart = cfg.chart;
        this.series = cfg.series;
        this.getData = cfg.getData;
        this.intervalSec = cfg.intervalSec;

        // Defaults requested by you:
        // tick/5/10/15/30 => 5m ON; 15m OFF
        // 30s/1m => 15m ON; 5m OFF
        // 5m => both OFF
        this.enabled5m = false;
        this.enabled15m = false;
        this._setDefaults();

        this.debugMode = false;

        // Overlay canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'timeblock-canvas';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '8';
        this.canvas.style.position = 'absolute';
        this.slotContainerEl.style.position = 'relative'; // ensure container is relative
        this.slotContainerEl.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // Optional toggles
        this._createToggles();

        // Pane geometry
        this.dpr = window.devicePixelRatio || 1;
        this.paneRect = { left: 0, top: 0, width: 0, height: 0 };

        // Render scheduling
        this._pending = false;

        // Resize / pan / zoom subscriptions
        this._ro = new ResizeObserver(() => {
            this._syncToPane();
            this.requestRender();
        });
        this._ro.observe(this.slotContainerEl);

        // Subscribe to chart changes (pan/zoom)
        const ts = this.chart.timeScale();
        if (ts.subscribeVisibleLogicalRangeChange) {
            ts.subscribeVisibleLogicalRangeChange(() => this.requestRender());
        }
        if (ts.subscribeVisibleTimeRangeChange) {
            ts.subscribeVisibleTimeRangeChange(() => this.requestRender());
        }
        if (ts.subscribeSizeChange) {
            ts.subscribeSizeChange(() => {
                this._syncToPane();
                this.requestRender();
            });
        }

        // Initial sync + draw
        this._syncToPane();
        this.requestRender();
    }

    _setDefaults() {
        // Map to your desired defaults
        // tick chart: intervalSec can be 1 (or special)
        if (this.intervalSec === 300) { // 5m chart
            this.enabled5m = false;
            this.enabled15m = false;
            return;
        }

        if (this.intervalSec === 60 || this.intervalSec === 30) {
            // 30s / 1m: 15m ON, 5m OFF
            this.enabled15m = true;
            this.enabled5m = false;
            return;
        }

        // tick/5s/10s/15s/30s: 5m ON, 15m OFF
        // (you said 30s priority is 15m; we already handled intervalSec===30 above)
        this.enabled5m = true;
        this.enabled15m = false;
    }

    destroy() {
        try { this._ro?.disconnect(); } catch { }
        try { this.canvas?.remove(); } catch { }
        try { this.togglesWrap?.remove(); } catch { }
    }

    setDebug(on) {
        this.debugMode = !!on;
        this.requestRender();
    }

    requestRender() {
        if (this._pending) return;
        this._pending = true;
        requestAnimationFrame(() => this._render());
    }

    /**
     * IMPORTANT: call this after series.setData() and series.update()
     * so the overlay updates immediately with live candles/ticks.
     */
    onDataUpdated() {
        this.requestRender();
    }

    _createToggles() {
        const wrap = document.createElement('div');
        wrap.className = 'timeblock-toggles';
        wrap.style.position = 'absolute';
        wrap.style.top = '6px';
        wrap.style.right = '10px';
        wrap.style.zIndex = '9';
        wrap.style.display = 'flex';
        wrap.style.gap = '6px';
        wrap.style.pointerEvents = 'auto';

        const mkBtn = (label, getter, setter, activeClass) => {
            const b = document.createElement('button');
            b.className = 'tb-btn';
            b.style.font = '12px Inter, system-ui, sans-serif';
            b.style.padding = '4px 8px';
            b.style.borderRadius = '6px';
            b.style.border = '1px solid rgba(255,255,255,.15)';
            b.style.background = 'rgba(0,0,0,.35)';
            b.style.color = 'rgba(255,255,255,.85)';
            b.style.cursor = 'pointer';
            b.textContent = label;

            const sync = () => {
                b.style.borderColor = 'rgba(255,255,255,.15)';
                if (getter()) {
                    if (activeClass === 'active-5m') b.style.borderColor = 'rgba(56,139,253,.55)';
                    if (activeClass === 'active-15m') b.style.borderColor = 'rgba(245,158,11,.65)';
                }
            };
            sync();

            b.onclick = (e) => {
                e.stopPropagation();
                setter(!getter());
                sync();
                this.requestRender();
            };
            return b;
        };

        const btn5 = mkBtn('5m', () => this.enabled5m, (v) => this.enabled5m = v, 'active-5m');
        const btn15 = mkBtn('15m', () => this.enabled15m, (v) => this.enabled15m = v, 'active-15m');

        wrap.appendChild(btn5);
        wrap.appendChild(btn15);
        this.slotContainerEl.appendChild(wrap);
        this.togglesWrap = wrap;
    }

    _syncToPane() {
        // Find the pane canvas inside plotEl (the element used by createChart)
        const paneCanvas = findMainPaneCanvas(this.plotEl);
        if (!paneCanvas) return;

        const hostRect = this.slotContainerEl.getBoundingClientRect();
        const paneRect = paneCanvas.getBoundingClientRect();

        const left = Math.round(paneRect.left - hostRect.left);
        const top = Math.round(paneRect.top - hostRect.top);
        const width = Math.round(paneRect.width);
        const height = Math.round(paneRect.height);

        this.paneRect = { left, top, width, height };

        // Position overlay canvas over pane only
        this.canvas.style.left = `${left}px`;
        this.canvas.style.top = `${top}px`;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        // DPR scaling
        this.dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(width * this.dpr));
        const bh = Math.max(1, Math.round(height * this.dpr));
        if (this.canvas.width !== bw) this.canvas.width = bw;
        if (this.canvas.height !== bh) this.canvas.height = bh;

        // Draw in CSS pixels (so LWC coords match)
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _render() {
        this._pending = false;

        // resync every render (LWC can rebuild internal canvases)
        this._syncToPane();

        const W = this.paneRect.width;
        const H = this.paneRect.height;
        if (W <= 0 || H <= 0) return;

        this.ctx.clearRect(0, 0, W, H);

        // Removed debug magenta background

        if (!this.enabled5m && !this.enabled15m) return;

        const data = this.getData?.() || [];
        if (data.length < 2) return;

        this._logs = [];
        this._logs.push(`Data Length: ${data.length}`);
        const last = data[data.length - 1];
        const ltSec = getPointTimeSec(last);
        this._logs.push(`last.time: ${last.time}, ltSec: ${ltSec}`);

        // Clip to pane
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, W, H);
        this.ctx.clip();

        // Draw order: 15m behind, then 5m
        if (this.enabled15m) this._drawBlocks(data, 900, {
            // Distinct quadrant colors (amber border)
            stripes: [
                'rgba(248,81,73,0.08)',  // red
                'rgba(88,166,255,0.08)', // blue
                'rgba(63,185,80,0.08)',  // green
                'rgba(163,113,247,0.08)',// purple
            ],
            border: 'rgba(240,185,11,0.3)',
            borderCurrent: 'rgba(240,185,11,0.6)',
            label: '15m',
        });

        if (this.enabled5m) this._drawBlocks(data, 300, {
            // Distinct quadrant colors (blue border)
            stripes: [
                'rgba(248,81,73,0.08)',  // red
                'rgba(88,166,255,0.08)', // blue
                'rgba(63,185,80,0.08)',  // green
                'rgba(163,113,247,0.08)',// purple
            ],
            border: 'rgba(56,139,253,0.3)',
            borderCurrent: 'rgba(56,139,253,0.6)',
            label: '5m',
        });

        this.ctx.restore();
    }

    _drawBlocks(data, blockSec, theme) {
        const timeScale = this.chart.timeScale();
        const series = this.series;

        const lastT = getPointTimeSec(data[data.length - 1]);
        if (lastT == null) {
            this._logs.push(`[${blockSec}] lastT null`);
            return;
        }

        // Last 1 hour
        const cutoffT = lastT - 3600;
        const sweepFromT = cutoffT - blockSec; // include overlap
        const sweepFromIdx = Math.max(0, lowerBoundTime(data, sweepFromT));

        this._logs.push(`[${blockSec}] svIdx=${sweepFromIdx} cutoff=${cutoffT} lastT=${lastT}`);

        // Aggregate high/low per block (only last hour)
        const agg = new Map(); // blockStart -> {min,max}
        for (let i = sweepFromIdx; i < data.length; i++) {
            const t = getPointTimeSec(data[i]);
            if (t == null) continue;
            const bStart = Math.floor(t / blockSec) * blockSec;
            if (bStart < cutoffT) continue;

            const hl = getPointHighLow(data[i]);
            if (!hl) continue;

            const cur = agg.get(bStart);
            if (!cur) agg.set(bStart, { min: hl.low, max: hl.high });
            else {
                if (hl.high > cur.max) cur.max = hl.high;
                if (hl.low < cur.min) cur.min = hl.low;
            }
        }
        this._logs.push(`[${blockSec}] aggSize=${agg.size}`);

        // Visible range time bounds (best effort)
        let visFrom = cutoffT;
        let visTo = lastT;

        if (typeof timeScale.getVisibleRange === 'function') {
            const vr = timeScale.getVisibleRange();
            const f = getPointTimeSec({ time: vr?.from });
            const t = getPointTimeSec({ time: vr?.to });
            if (f != null && t != null) {
                visFrom = Math.min(f, t);
                visTo = Math.max(f, t);
            }
        } else if (typeof timeScale.getVisibleLogicalRange === 'function') {
            // fallback to logical range and data times
            const lr = timeScale.getVisibleLogicalRange();
            if (lr) {
                const fromIdx = Math.max(0, Math.floor(lr.from) - 5);
                const toIdx = Math.min(data.length - 1, Math.ceil(lr.to) + 5);
                const a = getPointTimeSec(data[fromIdx]);
                const b = getPointTimeSec(data[toIdx]);
                if (a != null && b != null) { visFrom = a; visTo = b; }
            }
        }

        this._logs.push(`[${blockSec}] visBounds: ${visFrom} - ${visTo}`);

        const startBlock = Math.floor(visFrom / blockSec) * blockSec;
        const endBlock = Math.ceil(visTo / blockSec) * blockSec;

        const nowBlock = Math.floor(lastT / blockSec) * blockSec;
        const quadDur = blockSec / 4;

        let drew = 0;
        let skips = [];

        for (let bStart = startBlock; bStart <= endBlock; bStart += blockSec) {
            if (bStart < cutoffT) { skips.push('bStart<C'); continue; }
            const a = agg.get(bStart);
            if (!a) { skips.push('noAgg'); continue; }

            const yTop = series.priceToCoordinate(a.max);
            const yBot = series.priceToCoordinate(a.min);
            if (yTop == null || yBot == null) { skips.push('yCoordNul'); continue; }

            const bEnd = bStart + blockSec;

            // X edges (bar edges)
            const idx1 = lowerBoundTime(data, bStart);
            const idx2 = lowerBoundTime(data, bEnd);
            const x1 = boundaryTimeToX_edge(timeScale, data, bStart);
            const x2 = boundaryTimeToX_edge(timeScale, data, bEnd);
            if (x1 == null || x2 == null) { skips.push('xEdgeNul'); continue; }

            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            const wBox = right - left;
            const hBox = yBot - yTop;
            if (wBox <= 0.5 || hBox === 0) { skips.push(`w${wBox.toFixed(1)}(x1=${Math.round(x1)},x2=${Math.round(x2)},i1=${idx1},i2=${idx2})/h${Math.round(hBox)}`); continue; }

            drew++;

            // Quadrant stripes
            for (let q = 0; q < 4; q++) {
                const qStart = bStart + q * quadDur;
                const qEnd = qStart + quadDur;

                const qx1 = boundaryTimeToX_edge(timeScale, data, qStart);
                const qx2 = boundaryTimeToX_edge(timeScale, data, qEnd);
                if (qx1 == null || qx2 == null) continue;

                const qL = Math.min(qx1, qx2);
                const qR = Math.max(qx1, qx2);
                const w = Math.max(1, qR - qL);

                this.ctx.fillStyle = theme.stripes[q] || theme.stripes[0];
                this.ctx.fillRect(qL, yTop, w, hBox);
            }

            // Border
            const isCurrent = (bStart === nowBlock);
            this.ctx.strokeStyle = isCurrent ? theme.borderCurrent : theme.border;
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.strokeRect(left, yTop, wBox, hBox);
            this.ctx.setLineDash([]);

            // Label
            this.ctx.fillStyle = isCurrent ? theme.borderCurrent : theme.border;
            this.ctx.font = 'bold 10px Inter, system-ui, sans-serif';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText(`${theme.label}`, left + 4, yTop - 3);

            // Debug vertical boundary line
            if (this.debugMode) {
                const d = new Date(bStart * 1000);
                const hh = String(d.getUTCHours()).padStart(2, '0');
                const mm = String(d.getUTCMinutes()).padStart(2, '0');

                this.ctx.strokeStyle = 'rgba(255,0,0,0.65)';
                this.ctx.setLineDash([2, 2]);
                this.ctx.beginPath();
                this.ctx.moveTo(left, 0);
                this.ctx.lineTo(left, this.paneRect.height);
                this.ctx.stroke();
                this.ctx.setLineDash([]);

                this.ctx.fillStyle = 'rgba(255,0,0,0.85)';
                this.ctx.font = '10px monospace';
                this.ctx.fillText(`${hh}:${mm}Z`, left + 2, this.paneRect.height - 4);
            }
        }

        let skipStr = skips.length > 5 ? skips.slice(0, 5).join(',') + '...' : skips.join(',');
        this._logs.push(`[${blockSec}] drew=${drew}, skips=${skipStr}`);
    }
}

/* ================================================================
   LIQUIDITY EVENT MANAGER (V2)
   ================================================================ */
class LiquidityEventManager {
    constructor() {
        this.trackedLevels = new Map(); // symbol -> Map(id -> state)
        this.recentEvents = []; // Ring buffer of 200 events
        this.lastMargin = 0.5;
    }

    syncLevels(symbol, blocks5m, blocks15m) {
        if (!symbol) return;
        if (!this.trackedLevels.has(symbol)) {
            this.trackedLevels.set(symbol, new Map());
        }
        const stateMap = this.trackedLevels.get(symbol);

        // Evaluate against High/Low only
        const register = (blocks, tf) => {
            blocks.forEach(b => {
                const idH = `${tf}_${b.bStart}_H`;
                const idL = `${tf}_${b.bStart}_L`;

                if (!stateMap.has(idH)) stateMap.set(idH, { price: b.high, touchedAtSec: null, reenteredAtSec: null, touchEmitted: false, sweepEmitted: false, type: tf + 'High', bStart: b.bStart });
                else stateMap.get(idH).price = b.high;

                if (!stateMap.has(idL)) stateMap.set(idL, { price: b.low, touchedAtSec: null, reenteredAtSec: null, touchEmitted: false, sweepEmitted: false, type: tf + 'Low', bStart: b.bStart });
                else stateMap.get(idL).price = b.low;
            });
        };

        register(blocks5m, '5m');
        register(blocks15m, '15m');
    }

    _updateMargin() {
        // dynamic margin = 0.25 * median(|Δ| over last 300 tick deltas)
        if (typeof tickBuf === 'undefined' || tickBuf.length < 2) return;
        const m = Math.min(300, tickBuf.length);
        const deltas = [];
        for (let i = tickBuf.length - m + 1; i < tickBuf.length; i++) {
            deltas.push(Math.abs(tickBuf[i].value - tickBuf[i - 1].value));
        }
        deltas.sort((a, b) => a - b);
        const median = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 0;
        this.lastMargin = median * 0.25;
    }

    onTick(tick) {
        if (!currentSymbol) return;
        this._updateMargin();

        const stateMap = this.trackedLevels.get(currentSymbol);
        if (!stateMap) return;

        const p = tick.value;
        const t = tick.time;
        const m = this.lastMargin;

        stateMap.forEach((state, id) => {
            const isHigh = state.type.includes('High');

            // TOUCH logic
            if (!state.touchEmitted) {
                if ((isHigh && p >= state.price) || (!isHigh && p <= state.price)) {
                    state.touchedAtSec = t;
                    state.touchEmitted = true;
                    this._pushEvent({ symbol: currentSymbol, levelType: state.type, sourceBlockStartSec: state.bStart, eventType: 'TOUCH', touchTimeSec: t, reentryTimeSec: null, latencySec: null, levelPrice: state.price });
                }
            }

            // RE-ENTRY (SWEEP) logic
            if (state.touchEmitted && !state.sweepEmitted && state.touchedAtSec) {
                const reentered = isHigh ? (p < state.price - m) : (p > state.price + m);
                if (reentered) {
                    state.reenteredAtSec = t;
                    state.sweepEmitted = true;
                    const latency = t - state.touchedAtSec;
                    let evType = null;
                    if (latency <= 30) evType = 'FAST_SWEEP';
                    else if (latency <= 90) evType = 'SWEEP';

                    if (evType) {
                        this._pushEvent({ symbol: currentSymbol, levelType: state.type, sourceBlockStartSec: state.bStart, eventType: evType, touchTimeSec: state.touchedAtSec, reentryTimeSec: t, latencySec: latency, levelPrice: state.price });
                    }
                }
            }
        });
    }

    _pushEvent(ev) {
        this.recentEvents.push(ev);
        if (this.recentEvents.length > 200) this.recentEvents.shift();
    }
}
window.liqEventManager = new LiquidityEventManager();

/* ================================================================
   LIQUIDITY + EQUILIBRIUM OVERLAY (V1)
   ================================================================ */

class LiquidityEqOverlay {
    /**
     * @param {Object} cfg
     * @param {HTMLElement} cfg.slotContainerEl  - outer slot container (contains .tv-chart)
     * @param {HTMLElement} cfg.plotEl           - the exact element passed to createChart
     * @param {Object} cfg.chart                - Lightweight chart instance
     * @param {Object} cfg.series               - Series used for priceToCoordinate
     * @param {() => Array} cfg.getData         - returns the SAME array used to setData/update the series
     * @param {Object} cfg.uiState              - Reference to the slot's ui state to persist toggles
     */
    constructor(cfg) {
        this.slotContainerEl = cfg.slotContainerEl;
        this.plotEl = cfg.plotEl;
        this.chart = cfg.chart;
        this.series = cfg.series;
        this.getData = cfg.getData;
        this.uiState = cfg.uiState || {};

        if (!this.uiState.liqEq) {
            this.uiState.liqEq = { enabled5m: false, enabled15m: false, enabledMid: true, enabledEvents: false };
        }

        this._cachedBlocks5m = [];
        this._cachedBlocks15m = [];
        this._lastDataLength = -1;
        this._lastDataLastT = -1;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'liqeq-canvas';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '9';
        this.canvas.style.position = 'absolute';
        this.slotContainerEl.style.position = 'relative';
        this.slotContainerEl.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        this._createToggles();

        this.dpr = window.devicePixelRatio || 1;
        this.paneRect = { left: 0, top: 0, width: 0, height: 0 };
        this._pending = false;

        this._ro = new ResizeObserver(() => {
            this._syncToPane();
            this.requestRender();
        });
        this._ro.observe(this.slotContainerEl);

        const ts = this.chart.timeScale();
        if (ts.subscribeVisibleLogicalRangeChange) ts.subscribeVisibleLogicalRangeChange(() => this.requestRender());
        if (ts.subscribeVisibleTimeRangeChange) ts.subscribeVisibleTimeRangeChange(() => this.requestRender());
        if (ts.subscribeSizeChange) {
            ts.subscribeSizeChange(() => {
                this._syncToPane();
                this.requestRender();
            });
        }

        this._syncToPane();
        this.requestRender();
    }

    destroy() {
        try { this._ro?.disconnect(); } catch { }
        try { this.canvas?.remove(); } catch { }
        try { this.togglesWrap?.remove(); } catch { }
    }

    _createToggles() {
        const wrap = document.createElement('div');
        wrap.className = 'liqeq-toggles';
        wrap.style.position = 'absolute';
        wrap.style.top = '6px';
        wrap.style.left = '10px';
        wrap.style.zIndex = '10';
        wrap.style.display = 'flex';
        wrap.style.gap = '6px';
        wrap.style.pointerEvents = 'auto';

        const mkBtn = (label, key, activeColor) => {
            const b = document.createElement('button');
            b.className = 'tb-btn';
            b.style.font = '12px Inter, system-ui, sans-serif';
            b.style.padding = '4px 8px';
            b.style.borderRadius = '6px';
            b.style.border = '1px solid rgba(255,255,255,.15)';
            b.style.background = 'rgba(0,0,0,.35)';
            b.style.color = 'rgba(255,255,255,.85)';
            b.style.cursor = 'pointer';
            b.textContent = label;

            const sync = () => {
                b.style.borderColor = 'rgba(255,255,255,.15)';
                if (this.uiState.liqEq[key]) {
                    b.style.borderColor = activeColor;
                }
            };
            sync();

            b.onclick = (e) => {
                e.stopPropagation();
                this.uiState.liqEq[key] = !this.uiState.liqEq[key];
                sync();
                this.requestRender();
            };
            return b;
        };

        const btn5 = mkBtn('5m L', 'enabled5m', 'rgba(56,139,253,.65)');
        const btn15 = mkBtn('15m L', 'enabled15m', 'rgba(245,158,11,.65)');
        const btnMid = mkBtn('Mid', 'enabledMid', 'rgba(255,255,255,.5)');
        const btnEv = mkBtn('Events', 'enabledEvents', 'rgba(255,255,255,.8)');

        wrap.appendChild(btn5);
        wrap.appendChild(btn15);
        wrap.appendChild(btnMid);
        wrap.appendChild(btnEv);
        this.slotContainerEl.appendChild(wrap);
        this.togglesWrap = wrap;
    }

    _syncToPane() {
        const paneCanvas = findMainPaneCanvas(this.plotEl);
        if (!paneCanvas) return;

        const hostRect = this.slotContainerEl.getBoundingClientRect();
        const paneRect = paneCanvas.getBoundingClientRect();

        const left = Math.round(paneRect.left - hostRect.left);
        const top = Math.round(paneRect.top - hostRect.top);
        const width = Math.round(paneRect.width);
        const height = Math.round(paneRect.height);

        this.paneRect = { left, top, width, height };

        this.canvas.style.left = `${left}px`;
        this.canvas.style.top = `${top}px`;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        this.dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(width * this.dpr));
        const bh = Math.max(1, Math.round(height * this.dpr));
        if (this.canvas.width !== bw) this.canvas.width = bw;
        if (this.canvas.height !== bh) this.canvas.height = bh;

        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    onDataUpdated() {
        this._computeBlocks();
        this.requestRender();
    }

    _computeBlocks() {
        const data = this.getData?.() || [];
        if (data.length < 2) return;

        const lastT = getPointTimeSec(data[data.length - 1]);
        if (lastT == null) return;

        if (this._lastDataLength === data.length && this._lastDataLastT === lastT) return;
        this._lastDataLength = data.length;
        this._lastDataLastT = lastT;

        const getLast3Closed = (blockSec) => {
            const nowBlock = Math.floor(lastT / blockSec) * blockSec;
            const cutoffT = nowBlock - (blockSec * 4);
            const sweepFromIdx = Math.max(0, lowerBoundTime(data, cutoffT));

            const agg = new Map();
            for (let i = sweepFromIdx; i < data.length; i++) {
                const t = getPointTimeSec(data[i]);
                if (t == null) continue;
                const bStart = Math.floor(t / blockSec) * blockSec;
                if (bStart >= nowBlock) break;
                if (bStart < cutoffT) continue;

                const hl = getPointHighLow(data[i]);
                if (!hl) continue;

                const cur = agg.get(bStart);
                if (!cur) agg.set(bStart, { min: hl.low, max: hl.high });
                else {
                    if (hl.high > cur.max) cur.max = hl.high;
                    if (hl.low < cur.min) cur.min = hl.low;
                }
            }

            const sortedStarts = Array.from(agg.keys()).sort((a, b) => b - a).slice(0, 3);
            const res = [];
            sortedStarts.forEach((bStart) => {
                const a = agg.get(bStart);
                res.push({
                    bStart: bStart,
                    bEnd: bStart + blockSec,
                    low: a.min,
                    high: a.max,
                    mid50: (a.min + a.max) / 2
                });
            });
            return res;
        };

        this._cachedBlocks5m = getLast3Closed(300);
        this._cachedBlocks15m = getLast3Closed(900);

        if (window.liqEventManager && currentSymbol) {
            window.liqEventManager.syncLevels(currentSymbol, this._cachedBlocks5m, this._cachedBlocks15m);
        }
    }

    requestRender() {
        if (this._pending) return;
        this._pending = true;
        requestAnimationFrame(() => this._render());
    }

    _render() {
        this._pending = false;
        this._syncToPane();

        const W = this.paneRect.width;
        const H = this.paneRect.height;
        if (W <= 0 || H <= 0) return;

        this.ctx.clearRect(0, 0, W, H);

        if (!this.uiState.liqEq.enabled5m && !this.uiState.liqEq.enabled15m) return;

        const data = this.getData?.() || [];
        if (data.length < 2) return;
        const lastT = getPointTimeSec(data[data.length - 1]);
        if (lastT == null) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, W, H);
        this.ctx.clip();

        const ts = this.chart.timeScale();
        let rightEdgeX = boundaryTimeToX_edge(ts, data, lastT);
        if (rightEdgeX == null || isNaN(rightEdgeX)) {
            rightEdgeX = W;
            const vr = ts.getVisibleLogicalRange();
            if (vr && vr.to !== null) {
                const mappedTo = ts.logicalToCoordinate(vr.to);
                if (mappedTo != null) rightEdgeX = Math.max(0, Math.min(W, mappedTo));
            }
        }
        if (isNaN(rightEdgeX)) rightEdgeX = W;

        const lines = [];
        const pushBlockLines = (blocks, tf, baseColorStr) => {
            blocks.forEach((bg, index) => {
                const ageIdx = index + 1; // 1, 2, 3
                const alpha = ageIdx === 1 ? 0.55 : (ageIdx === 2 ? 0.35 : 0.22);
                const startX = boundaryTimeToX_edge(ts, data, bg.bStart);
                if (startX == null || isNaN(startX)) return;

                const yH = this.series.priceToCoordinate(bg.high);
                const yL = this.series.priceToCoordinate(bg.low);
                const yEQ = this.series.priceToCoordinate(bg.mid50);

                if (yH != null) lines.push({ y: yH, startX, alpha, tf, ageIdx, type: 'H', baseColor: baseColorStr, label: `${tf} #${ageIdx} H` });
                if (yL != null) lines.push({ y: yL, startX, alpha, tf, ageIdx, type: 'L', baseColor: baseColorStr, label: `${tf} #${ageIdx} L` });
                if (this.uiState.liqEq.enabledMid && yEQ != null) {
                    lines.push({ y: yEQ, startX, alpha, tf, ageIdx, type: 'EQ', baseColor: baseColorStr, label: `${tf} #${ageIdx} EQ` });
                }
            });
        };

        if (this.uiState.liqEq.enabled15m) pushBlockLines(this._cachedBlocks15m, '15m', '240, 185, 11');
        if (this.uiState.liqEq.enabled5m) pushBlockLines(this._cachedBlocks5m, '5m', '56, 139, 253');

        // Cluster lines within 6px
        lines.sort((a, b) => a.y - b.y);
        const clusters = [];
        let currentCluster = [];

        for (const line of lines) {
            if (currentCluster.length === 0) {
                currentCluster.push(line);
            } else {
                const avgY = currentCluster.reduce((sum, l) => sum + l.y, 0) / currentCluster.length;
                if (Math.abs(line.y - avgY) <= 6) {
                    currentCluster.push(line);
                } else {
                    clusters.push(currentCluster);
                    currentCluster = [line];
                }
            }
        }
        if (currentCluster.length > 0) clusters.push(currentCluster);

        // Render merged clusters
        for (const cluster of clusters) {
            // Sort to find "strongest" line: lowest ageIdx, then 15m over 5m
            cluster.sort((a, b) => {
                if (a.ageIdx !== b.ageIdx) return a.ageIdx - b.ageIdx;
                if (a.tf !== b.tf) return a.tf === '15m' ? -1 : 1;
                return 0;
            });

            const lead = cluster[0];
            const avgY = cluster.reduce((s, l) => s + l.y, 0) / cluster.length;
            const minX = Math.min(...cluster.map(l => l.startX));

            const isEq = lead.type === 'EQ';
            this.ctx.strokeStyle = `rgba(${lead.baseColor}, ${lead.alpha})`;
            this.ctx.lineWidth = isEq ? 1.2 : 1.6;
            this.ctx.setLineDash(isEq ? [8, 6] : []);

            this.ctx.beginPath();
            this.ctx.moveTo(minX, avgY);
            this.ctx.lineTo(rightEdgeX, avgY);
            this.ctx.stroke();

            // Draw pill tag at right edge
            const combinedLabel = cluster.map(l => l.label).join(' | ');
            this.ctx.font = '10px Inter, system-ui, sans-serif';
            const textW = this.ctx.measureText(combinedLabel).width;
            const padding = 4;
            const ph = 16;
            const px = Math.max(0, rightEdgeX - textW - padding * 2 - 2);
            const py = avgY - ph / 2;

            this.ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
            this.ctx.beginPath();
            if (this.ctx.roundRect) {
                this.ctx.roundRect(px, py, textW + padding * 2, ph, 4);
            } else {
                this.ctx.rect(px, py, textW + padding * 2, ph);
            }
            this.ctx.fill();

            this.ctx.fillStyle = `rgba(${lead.baseColor}, 0.9)`;
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(combinedLabel, px + padding, avgY);
        }

        // Render events
        if (this.uiState.liqEq.enabledEvents && window.liqEventManager && currentSymbol) {
            const evs = window.liqEventManager.recentEvents.filter(e => e.symbol === currentSymbol);

            const visibleBlocks = new Set([
                ...(this.uiState.liqEq.enabled5m ? this._cachedBlocks5m.map(b => b.bStart) : []),
                ...(this.uiState.liqEq.enabled15m ? this._cachedBlocks15m.map(b => b.bStart) : [])
            ]);

            evs.forEach(ev => {
                if (!visibleBlocks.has(ev.sourceBlockStartSec)) return;

                const timeToMap = ev.eventType === 'TOUCH' ? ev.touchTimeSec : ev.reentryTimeSec;
                if (!timeToMap) return;

                const idx = lowerBoundTime(data, timeToMap);
                const rawX = ts.logicalToCoordinate(idx - 0.5);
                const x = rawX != null ? rawX : ts.logicalToCoordinate(idx);

                const y = this.series.priceToCoordinate(ev.levelPrice);
                if (x == null || y == null) return;

                this.ctx.beginPath();
                if (ev.eventType === 'TOUCH') {
                    this.ctx.fillStyle = ev.levelType.includes('5m') ? 'rgb(56,139,253)' : 'rgb(240,185,11)';
                    this.ctx.arc(x, y, 3, 0, Math.PI * 2);
                    this.ctx.fill();
                } else if (ev.eventType === 'SWEEP' || ev.eventType === 'FAST_SWEEP') {
                    this.ctx.fillStyle = ev.eventType === 'FAST_SWEEP' ? '#fff' : 'rgba(255,255,255,0.7)';
                    this.ctx.font = ev.eventType === 'FAST_SWEEP' ? 'bold 12px Inter' : '10px Inter';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.fillText('S', x, y);
                }
            });
        }

        this.ctx.setLineDash([]);
        this.ctx.restore();
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
        this._chartData = [];      // Local exact clone of chart's active data
        this.uiState = {};         // Persist UI states
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
            this._chartData = [...this.pendingData];
            this.chart.timeScale().scrollToRealTime();
            this.pendingData = null;
        }

        // Create drawing manager (needs series for coordinate conversion)
        this.drawing = new DrawingManager(this.chart, this.series, this.containerId);

        // Create time block overlay directly in the container
        let intervalSec = 0;
        if (this.containerId === 'tickChart') intervalSec = 1;
        else if (this.containerId === 'chart5s') intervalSec = 5;
        else if (this.containerId === 'chart10s') intervalSec = 10;
        else if (this.containerId === 'chart15s') intervalSec = 15;
        else if (this.containerId === 'chart30s') intervalSec = 30;
        else if (this.containerId === 'chart1m') intervalSec = 60;
        else if (this.containerId === 'chart5m') intervalSec = 300;
        else if (this.containerId === 'gridChartLeft' || this.containerId === 'gridChartRight') {
            const side = this.containerId === 'gridChartLeft' ? 'left' : 'right';
            const tf = getGridTf(side);
            const tfMap = { 'tick': 1, '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '5m': 300 };
            intervalSec = tfMap[tf] || 5;
        }

        const plotEl = el.querySelector('.tv-chart');

        this.timeBlockOverlay = new TimeBlockOverlay({
            slotContainerEl: el,
            plotEl: plotEl || el, // Fallback if wrapping is different
            chart: this.chart,
            series: this.series,
            intervalSec: intervalSec,
            getData: () => {
                return this._chartData || [];
            }
        });
        this.timeBlockOverlay.setDebug(true); // Enable debug testing as requested

        this.liquidityEqOverlay = new LiquidityEqOverlay({
            slotContainerEl: el,
            plotEl: plotEl || el,
            chart: this.chart,
            series: this.series,
            uiState: this.uiState,
            getData: () => {
                return this._chartData || [];
            }
        });

        // Ensure barrier line is added when tab is lazily initialised
        updateBarrierLines();
    }

    setData(data) {
        if (!data?.length) return;
        if (this.series) {
            this.series.setData(data);
            this._chartData = [...data];
            this.chart?.timeScale().scrollToRealTime();
            if (this.timeBlockOverlay) this.timeBlockOverlay.onDataUpdated();
            if (this.liquidityEqOverlay) this.liquidityEqOverlay.onDataUpdated();
        } else {
            this.pendingData = data;
        }
    }

    update(point) {
        if (this.series) {
            this.series.update(point);
            if (!this._chartData) this._chartData = [];
            const last = this._chartData[this._chartData.length - 1];
            if (last && last.time === point.time) {
                this._chartData[this._chartData.length - 1] = point;
            } else {
                this._chartData.push(point);
            }
            if (this.timeBlockOverlay) this.timeBlockOverlay.onDataUpdated();
            if (this.liquidityEqOverlay) this.liquidityEqOverlay.onDataUpdated();
        } else {
            if (!this.pendingData) this.pendingData = [];
            const last = this.pendingData[this.pendingData.length - 1];
            if (last && last.time === point.time) {
                this.pendingData[this.pendingData.length - 1] = point;
            } else {
                this.pendingData.push(point);
            }
        }
    }

    /** Scroll the chart's time axis to the live edge */
    scrollToNow() {
        if (this.chart) this.chart.timeScale().scrollToRealTime();
    }
}

// ── Barrier State (must be declared before slots.tick.init() which calls updateBarrierLines) ──
let barrierOffset = parseFloat($('barrierInput')?.value) || 2.0;
let barrierDirection = 'up';
let barrierMode = 'float'; // 'float' | 'freeze'
let frozenBarrierPrice = null;
let currentSpot = null;
// Store price line references per slot key
const barrierLines = {};

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
    viewReachGrid: [] // No chart slots for the heatmap view
};

// Candle data buffers per TF (for grid panel switching)
const candleBuf = { '5s': [], '10s': [], '15s': [], '30s': [], '1m': [], '2m': [], '5m': [] };
// Tick data buffer (for grid panels showing tick chart)
let tickBuf = [];

// ── Simple Mode Sidebar State ─────────────────────────────────────
let textureHistEff = [];
let textureHistFlip = [];
let texturalHysteresis = { current: 'WARMING', candidate: '', count: 0 };
let lastPercentileUpdate = 0;
let cachedThresholds = { eff20: 0, eff80: 0, flip20: 0, flip80: 0 };

// Init the tick chart immediately (it's visible on load)
slots.tick.init();


// ── Tab Switching ─────────────────────────────────────────────────
const allTabs = document.querySelectorAll('.tab');
const allViews = document.querySelectorAll('.chart-view');

function activateTab(viewId) {
    allTabs.forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
    allViews.forEach(v => v.classList.toggle('active', v.id === viewId));

    // Show/Hide the Reach Grid Config section in the sidebar based on active tab
    const gridConfigPanel = $('reachGridConfigPanel');
    if (gridConfigPanel) {
        gridConfigPanel.style.display = (viewId === 'viewReachGrid') ? 'block' : 'none';
    }

    // Handle visible charts for this tab (runs only once per slot)
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

    // Create new series
    if (tf === 'tick') {
        slot.series = slot.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#58a6ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true
        });
    } else {
        slot.series = slot.chart.addSeries(LightweightCharts.CandlestickSeries, CANDLE_OPTS);
    }

    // Reattach the new series to the TimeBlockOverlay before setting data
    if (slot.timeBlockOverlay) {
        slot.timeBlockOverlay.series = slot.series;
        const tfMap = { 'tick': 1, '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '5m': 300 };
        slot.timeBlockOverlay.intervalSec = tfMap[tf] || 5;
    }

    // Reattach the new series to the LiquidityEqOverlay
    if (slot.liquidityEqOverlay) {
        slot.liquidityEqOverlay.series = slot.series;
    }

    // Feed data securely via slot so ChartSlot caches it for the overlay and triggers onDataUpdated
    if (tf === 'tick') {
        if (tickBuf.length) slot.setData([...tickBuf]);
    } else {
        const data = candleBuf[tf] ?? [];
        if (data.length) slot.setData([...data]);
    }

    // Safety re-render if slot.setData wasn't triggered (e.g., empty buffer)
    if (slot.timeBlockOverlay) {
        slot.timeBlockOverlay.requestRender();
    }
    if (slot.liquidityEqOverlay) {
        slot.liquidityEqOverlay.onDataUpdated();
    }

    slot.chart.timeScale().scrollToRealTime();
}

$('gridLeftTf')?.addEventListener('change', () => rebuildGridPanel('left'));
$('gridRightTf')?.addEventListener('change', () => rebuildGridPanel('right'));

function pushCandle(tf, candle) {
    if (!candleBuf[tf]) return;
    const buf = candleBuf[tf];
    if (buf.length > 0 && buf[buf.length - 1].time === candle.time) {
        buf[buf.length - 1] = candle;
    } else {
        buf.push(candle);
        // Cap candle buffer to maximum 2000 items to prevent RAM bloat
        if (buf.length > 2000) buf.shift();
    }

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
const wsUrl = `ws://${window.location.hostname}:${window.location.port || 8080}`;
let ws;
let isReconnecting = false;
let reconnectAttempts = 0;

function connectWebSocket() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        setText('symbolBadge', 'CONNECTED');
        $('symbolBadge').style.background = 'rgba(88, 166, 255, 0.1)';
        $('symbolBadge').style.color = 'var(--accent)';
        isReconnecting = false;
        reconnectAttempts = 0;
    };

    ws.onclose = () => {
        setText('symbolBadge', 'RECONNECTING...');
        $('symbolBadge').style.background = 'rgba(210, 153, 34, 0.1)';
        $('symbolBadge').style.color = 'var(--yellow)';

        if (!isReconnecting) {
            isReconnecting = true;
        }

        // Exponential backoff reconnect
        let delay = Math.pow(2, reconnectAttempts) * 1000;
        if (delay > 15000) delay = 15000; // max 15s delay between tries

        setTimeout(() => {
            reconnectAttempts++;
            if (ws && ws.readyState === WebSocket.CLOSED) {
                connectWebSocket();
            }
        }, delay);
    };

    ws.onerror = (err) => {
        console.error('[WS Error]', err);
        setText('symbolBadge', 'ERROR');
        $('symbolBadge').style.background = 'rgba(248, 81, 73, 0.1)';
        $('symbolBadge').style.color = 'var(--red)';
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
                case 'symbol':
                    currentSymbol = msg.data;
                    setText('symbolBadge', msg.data);
                    break;
                case 'config': applyConfig(msg.data); break;
                case 'tick': {
                    const lastTick = tickBuf.length > 0 ? tickBuf[tickBuf.length - 1] : null;
                    if (lastTick && msg.data.time <= lastTick.time) {
                        break; // Strict time monotony: ignore duplicates or out-of-order
                    }

                    slots.tick.update(msg.data);
                    window.lastKnownEpoch = msg.data.time;
                    // Buffer tick for grid panels and Simple Mode (capped at 3600)
                    tickBuf.push(msg.data);
                    if (tickBuf.length > 3600) tickBuf.shift();

                    if (window.liqEventManager) window.liqEventManager.onTick(msg.data);

                    // Also push tick to any grid panels showing the tick chart
                    if (getGridTf('left') === 'tick') slots.gridL?.update(msg.data);
                    if (getGridTf('right') === 'tick') slots.gridR?.update(msg.data);
                    // Update barrier line with new spot price
                    currentSpot = msg.data.value;
                    updateBarrierLines();

                    // Update Simple Mode Meters securely
                    try { processSimpleMetrics(); } catch (e) { console.error('[Metrics Error]', e); }
                    break;
                }
                case 'countdown': updateCountdowns(msg.data); break;
                case 'candle_closed': pushCandle(msg.timeframe, msg.data); break;
                case 'candle_update': updateLiveCandle(msg.timeframe, msg.data); break;
                case 'analytics': handleAnalytics(msg.data); break;
                case 'history': loadHistory(msg.data); break;
                case 'reach_grid': handleReachGrid(msg.data); break;
            }
        } catch (e) { console.error('[WS]', e); }
    };
} // end connectWebSocket()

connectWebSocket(); // Kick off initial connection

function loadHistory(h) {
    if (h.historicalTicks?.length) {
        slots.tick.setData(h.historicalTicks);
        // Cap history to 3600 specifically for simple mode memory constraints
        tickBuf = h.historicalTicks.slice(-3600);

        // Reset simple mode on history load (e.g., symbol change)
        textureHistEff = [];
        textureHistFlip = [];
        texturalHysteresis = { current: 'WARMING', candidate: '', count: 0 };
        lastPercentileUpdate = 0;
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

    let barrierPrice;
    if (barrierMode === 'freeze' && frozenBarrierPrice !== null) {
        barrierPrice = frozenBarrierPrice;
    } else {
        barrierPrice = barrierDirection === 'up'
            ? currentSpot + barrierOffset
            : currentSpot - barrierOffset;
    }

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

    // Auto-unfreeze if direction changes
    if (barrierMode === 'freeze') {
        setBarrierMode('float');
    } else {
        updateBarrierLines();
    }
}

function setBarrierMode(mode) {
    barrierMode = mode;
    $('btnFloat')?.classList.toggle('active', mode === 'float');
    $('btnFreeze')?.classList.toggle('active', mode === 'freeze');

    if (mode === 'freeze') {
        if (currentSpot != null) {
            frozenBarrierPrice = barrierDirection === 'up'
                ? currentSpot + barrierOffset
                : currentSpot - barrierOffset;
        }
    } else {
        frozenBarrierPrice = null;
    }
    updateBarrierLines();
}

// ── Sidebar Barrier Controls ─────────────────────────────────────
let dbt;
function syncConfig() {
    clearTimeout(dbt);
    dbt = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
            type: 'update_config',
            barrier: parseFloat($('barrierInput')?.value ?? 2),
            payoutROI: parseFloat($('roiInput')?.value ?? 109),
            direction: $('btnUp')?.classList.contains('active') ? 'up' : 'down'
        }));
    }, 500);
}

$('barrierInput')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (Number.isFinite(val)) {
        barrierOffset = val;
        updateBarrierLines();
        syncConfig();
    }
});

$('roiInput')?.addEventListener('input', syncConfig);

$('btnUp')?.addEventListener('click', () => {
    setDirection('up');
    syncConfig();
});

$('btnDown')?.addEventListener('click', () => {
    setDirection('down');
    syncConfig();
});

$('btnFloat')?.addEventListener('click', () => setBarrierMode('float'));
$('btnFreeze')?.addEventListener('click', () => setBarrierMode('freeze'));

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

// ── Reach Grid UI Sync ────────────────────────────────────────────
function sendGridConfig(update) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'update_grid_config', ...update }));
    }
}
['btnGridEither', 'btnGridUp', 'btnGridDown'].forEach(id => {
    $(id)?.addEventListener('click', (e) => {
        ['btnGridEither', 'btnGridUp', 'btnGridDown'].forEach(b => $(b)?.classList.remove('active'));
        e.target.classList.add('active');
        sendGridConfig({ mode: id.replace('btnGrid', '').toLowerCase() });
    });
});
['btnGrid10m', 'btnGrid30m', 'btnGrid2h'].forEach(id => {
    $(id)?.addEventListener('click', (e) => {
        ['btnGrid10m', 'btnGrid30m', 'btnGrid2h'].forEach(b => $(b)?.classList.remove('active'));
        e.target.classList.add('active');
        sendGridConfig({ lookbackSec: parseInt(e.target.dataset.sec) });
    });
});

function handleReachGrid(data) {
    const table = $('reachGridTable');
    if (!table) return;

    const { matrix, distances, horizons, mode, samplesPerHorizon } = data;

    // Sample warning
    const minSamples = Math.min(...Object.values(samplesPerHorizon));
    const warningEl = $('reachGridWarning');
    if (minSamples < 10) {
        warningEl.textContent = `⚠️ Low sample size (${minSamples} windows). Consider extending Lookback.`;
    } else {
        warningEl.textContent = `Sample size: ${minSamples} windows evaluated | Updated: ${new Date(data.timestamp * 1000).toLocaleTimeString()}`;
        warningEl.style.color = 'var(--muted)';
    }

    let html = '<thead><tr><th>Dist</th>';
    horizons.forEach(h => html += `<th>${h}s</th>`);
    html += '</tr></thead><tbody>';

    distances.forEach((d, rIdx) => {
        html += `<tr><td class="distance-col">${d.toFixed(1)}</td>`;
        horizons.forEach((h, cIdx) => {
            const cellData = matrix[rIdx][cIdx];
            const rate = cellData[mode]; // decimal 0.0 to 1.0
            const pct = Math.round(rate * 100);

            // Map percentage to heat class (10 steps)
            const heatStep = Math.round(pct / 10) * 10;

            let displayVal = `${pct}%`;
            if (pct === 100) displayVal = '100'; // Make it fit better visually if 100

            html += `<td class="reach-cell bg-heat-${heatStep}">${displayVal}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
}

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

// ── Simple Mode Processing ──────────────────────────────────────────
function processSimpleMetrics() {
    const N = tickBuf.length;
    if (N < 2) return;

    const currentPrice = tickBuf[N - 1].value;
    const nowSec = tickBuf[N - 1].time;

    // --- 1. IMPULSE METER ---
    // M=300 trailing median baseline
    const m = Math.min(300, N);
    const mSlice = tickBuf.slice(N - m).map(t => t.value).sort((a, b) => a - b);
    const median = mSlice[Math.floor(m / 2)];

    const currentMag = Math.abs(currentPrice - median);

    // Dynamic big tick threshold (80th percentile of typical jumps, minimum 0.5)
    let deltas = [];
    for (let i = N - m + 1; i < N; i++) deltas.push(Math.abs(tickBuf[i].value - tickBuf[i - 1].value));
    deltas.sort((a, b) => a - b);
    const thr = deltas.length > 0 ? deltas[Math.floor(deltas.length * 0.8)] : 0;
    const bigThresh = Math.max(thr * 1.5, 0.5);

    let big60 = 0, big120 = 0;
    for (let i = N - 1; i > 0; i--) {
        const dt = nowSec - tickBuf[i].time;
        if (dt > 120) break;
        const dPrice = Math.abs(tickBuf[i].value - tickBuf[i - 1].value);
        if (dPrice >= bigThresh) {
            if (dt <= 60) big60++;
            if (dt <= 120) big120++;
        }
    }

    setText('impulseMag', currentMag.toFixed(2));
    setText('impulseBig60', big60);
    setText('impulseBig120', big120);

    // --- 2. TEXTURE METER ---
    // N=120 window
    let eff = 0, flipRate = 0;
    const nTicks = [];
    for (let i = N - 1; i >= 0; i--) {
        if (nowSec - tickBuf[i].time <= 120) nTicks.unshift(tickBuf[i].value);
        else break;
    }

    if (nTicks.length >= 2) {
        let pathLen = 0, flips = 0, lastSign = 0;
        for (let i = 1; i < nTicks.length; i++) {
            const d = nTicks[i] - nTicks[i - 1];
            pathLen += Math.abs(d);
            const sign = Math.sign(d);
            if (sign !== 0) {
                if (lastSign !== 0 && sign !== lastSign) flips++;
                lastSign = sign;
            }
        }
        const netDist = Math.abs(nTicks[nTicks.length - 1] - nTicks[0]);
        eff = pathLen > 0 ? (netDist / pathLen) : 0;
        flipRate = flips / nTicks.length;
    }

    // History & Percentiles
    textureHistEff.push(eff);
    textureHistFlip.push(flipRate);
    if (textureHistEff.length > 3600) textureHistEff.shift();
    if (textureHistFlip.length > 3600) textureHistFlip.shift();

    if (nowSec - lastPercentileUpdate > 10 && textureHistEff.length >= 120) {
        lastPercentileUpdate = nowSec;
        const sEff = [...textureHistEff].sort((a, b) => a - b);
        const sFlip = [...textureHistFlip].sort((a, b) => a - b);
        const len = sEff.length;
        cachedThresholds.eff20 = sEff[Math.floor(len * 0.2)];
        cachedThresholds.eff80 = sEff[Math.floor(len * 0.8)];
        cachedThresholds.flip20 = sFlip[Math.floor(len * 0.2)];
        cachedThresholds.flip80 = sFlip[Math.floor(len * 0.8)];
    }

    setText('textureEff', eff.toFixed(3));
    setText('textureFlip', flipRate.toFixed(3));

    // State Classifier
    let candidate = 'MIXED';
    if (textureHistEff.length < 120) {
        candidate = 'WARMING';
    } else {
        const highEff = eff > cachedThresholds.eff80, lowEff = eff < cachedThresholds.eff20;
        const highFlip = flipRate > cachedThresholds.flip80, lowFlip = flipRate < cachedThresholds.flip20;

        if (highEff && lowFlip) candidate = 'FLOW';
        else if (lowEff && highFlip) candidate = 'CHOP';
        else if (lowEff && lowFlip) candidate = 'QUIET';
    }

    // Hysteresis Anti-Flicker
    if (candidate === texturalHysteresis.candidate) {
        texturalHysteresis.count++;
        if (texturalHysteresis.count >= 8 || candidate === 'WARMING') {
            texturalHysteresis.current = candidate;
        }
    } else {
        texturalHysteresis.candidate = candidate;
        texturalHysteresis.count = 1;
    }

    // UI Update
    const tLabel = $('textureLabel');
    if (tLabel) {
        tLabel.textContent = texturalHysteresis.current;
        tLabel.style.color = '#fff';
        switch (texturalHysteresis.current) {
            case 'FLOW': tLabel.style.background = 'rgba(63, 185, 80, 0.2)'; tLabel.style.color = '#3fb950'; break;
            case 'CHOP': tLabel.style.background = 'rgba(248, 81, 73, 0.2)'; tLabel.style.color = '#f85149'; break;
            case 'QUIET': tLabel.style.background = 'rgba(163, 113, 247, 0.2)'; tLabel.style.color = '#a371f7'; break;
            case 'MIXED': tLabel.style.background = 'rgba(255, 255, 255, 0.05)'; break;
            case 'WARMING': tLabel.style.background = 'rgba(210, 153, 34, 0.2)'; tLabel.style.color = '#d29922'; break;
        }
    }
}

// ── Controls ──────────────────────────────────────────────────────
// (Merged into Sidebar Barrier Controls section above)




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
