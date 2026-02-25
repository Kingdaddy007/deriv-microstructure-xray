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
