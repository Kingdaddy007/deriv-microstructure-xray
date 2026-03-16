import { findMainPaneCanvas, boundaryTimeToX_edge, getPointTimeSec } from '../utils/ChartHelpers.js';

export default class TradeOverlay {
    constructor(cfg) {
        this.slotContainerEl = cfg.slotContainerEl;
        this.plotEl = cfg.plotEl;
        this.chart = cfg.chart;
        this.series = cfg.series;
        this.getData = cfg.getData;
        this.getTrades = cfg.getTrades;
        this.intervalSec = cfg.intervalSec || 1;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'trade-overlay-canvas';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '10';
        this.canvas.style.position = 'absolute';
        this.slotContainerEl.style.position = 'relative';
        this.slotContainerEl.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

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
    }

    onDataUpdated() {
        this.requestRender();
    }

    requestRender() {
        if (this._pending) return;
        this._pending = true;
        requestAnimationFrame(() => this._render());
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

    _xForTime(timeSec, data) {
        const ts = this.chart.timeScale();
        let x = boundaryTimeToX_edge(ts, data, timeSec);
        if (x == null) {
            x = ts.timeToCoordinate(timeSec);
        }
        return x;
    }

    _drawFlag(ctx, x, y, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 10, y - 8);
        ctx.lineTo(x + 6, y - 3);
        ctx.lineTo(x + 10, y + 2);
        ctx.lineTo(x, y + 2);
        ctx.closePath();
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.restore();
    }

    _render() {
        this._pending = false;

        // resync every render (LWC can rebuild internal canvases)
        this._syncToPane();

        const ctx = this.ctx;
        if (!ctx || !this.chart || !this.series) return;

        const { width, height } = this.paneRect;
        ctx.clearRect(0, 0, width, height);

        const data = this.getData?.() || [];
        const trades = this.getTrades?.() || [];
        if (data.length < 2 || trades.length === 0) return;

        for (const trade of trades) {
            if (!Number.isFinite(trade.barrierPrice) || !Number.isFinite(trade.entryTimeSec)) continue;

            const entryTimeSec = trade.entryTimeSec;
            const exitTimeSec = Number.isFinite(trade.visualEndTimeSec) ? trade.visualEndTimeSec : trade.entryTimeSec;
            const yBarrier = this.series.priceToCoordinate(trade.barrierPrice);
            if (yBarrier == null) continue;

            const x1 = this._xForTime(entryTimeSec, data);
            const x2 = this._xForTime(exitTimeSec, data);
            if (x1 == null || x2 == null) continue;

            const lineStart = Math.min(x1, x2);
            const lineEnd = Math.max(x1, x2);
            const color = trade.color || '#22c55e';

            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(lineStart, yBarrier);
            ctx.lineTo(lineEnd, yBarrier);
            ctx.stroke();

            if (Number.isFinite(trade.entrySpot)) {
                const yEntry = this.series.priceToCoordinate(trade.entrySpot);
                if (yEntry != null) {
                    ctx.setLineDash([4, 3]);
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x1, yEntry);
                    ctx.lineTo(x1, yBarrier);
                    ctx.stroke();
                }
            }

            if (trade.isClosedVisual) {
                this._drawFlag(ctx, lineEnd, yBarrier, color);
            }

            ctx.restore();
        }
    }
}
