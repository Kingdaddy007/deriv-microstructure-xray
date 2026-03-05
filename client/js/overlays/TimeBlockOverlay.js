import { getPointTimeSec, getPointHighLow, lowerBoundTime, findMainPaneCanvas, boundaryTimeToX_edge } from '../utils/ChartHelpers.js';

export default class TimeBlockOverlay {
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

        this._effectiveMode = 'LIVE';
        this.blockDepth = 3;

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

        // Depth selector button
        const btnDepth = document.createElement('button');
        btnDepth.className = 'tb-btn';
        btnDepth.style.font = '12px Inter, system-ui, sans-serif';
        btnDepth.style.padding = '4px 8px';
        btnDepth.style.borderRadius = '6px';
        btnDepth.style.border = '1px solid rgba(255,255,255,.15)';
        btnDepth.style.background = 'rgba(0,0,0,.35)';
        btnDepth.style.color = 'rgba(255,255,255,.85)';
        btnDepth.style.cursor = 'pointer';
        const syncDepth = () => { btnDepth.textContent = `[${this.blockDepth}]`; };
        syncDepth();
        btnDepth.onclick = (e) => {
            e.stopPropagation();
            this.blockDepth = this.blockDepth === 3 ? 1 : this.blockDepth + 1;
            syncDepth();
            this.requestRender();
        };

        // LIVE/VIEW Badge
        const badge = document.createElement('div');
        badge.style.font = '10px Inter, system-ui, sans-serif';
        badge.style.padding = '4px 6px';
        badge.style.borderRadius = '4px';
        badge.style.color = '#fff';
        badge.style.fontWeight = 'bold';
        badge.style.textTransform = 'uppercase';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';

        this._updateBadgeUI = () => {
            if (this._effectiveMode === 'LIVE') {
                badge.textContent = 'LIVE';
                badge.style.background = 'rgba(56,139,253,0.3)'; // blue
                badge.style.border = '1px solid rgba(56,139,253,0.6)';
            } else {
                badge.textContent = 'VIEW';
                badge.style.background = 'rgba(240,185,11,0.3)'; // amber
                badge.style.border = '1px solid rgba(240,185,11,0.6)';
            }
        };
        this._updateBadgeUI();

        wrap.appendChild(btn5);
        wrap.appendChild(btn15);
        wrap.appendChild(btnDepth);
        wrap.appendChild(badge);
        this.slotContainerEl.appendChild(wrap);
        this.togglesWrap = wrap;
    }

    _getAnchorTime(data) {
        const actualLastT = getPointTimeSec(data[data.length - 1]);
        const thresholdSec = 60; // Increased threshold for mode switching (1 min)

        let viewRightT = actualLastT;
        let mode = 'LIVE';

        try {
            const lr = this.chart.timeScale().getVisibleLogicalRange();
            if (lr) {
                const toIdx = Math.min(data.length - 1, Math.max(0, Math.floor(lr.to)));
                let vT = getPointTimeSec(data[toIdx]);

                if (vT != null) {
                    vT = Math.min(vT, actualLastT);
                    // Hysteresis: only switch to VIEW if we are at least 1 min away from LIVE tip
                    if ((actualLastT - vT) > thresholdSec) {
                        viewRightT = vT;
                        mode = 'VIEW';
                    }
                }
            }
        } catch { /* ignore */ }

        // Local hysteresis to prevent tiny jitter movements from triggering re-renders
        if (mode === 'VIEW' && this._lastViewRightT && Math.abs(viewRightT - this._lastViewRightT) < 5) {
            viewRightT = this._lastViewRightT;
        }
        this._lastViewRightT = viewRightT;
        this._effectiveMode = mode;
        if (this._updateBadgeUI) this._updateBadgeUI();

        const firstT = getPointTimeSec(data[0]) || 0;

        // focusT_5m  = viewRightT - 2*300
        // focusT_15m = viewRightT - 1*900
        const focusT5m = Math.max(firstT, viewRightT - 2 * 300);
        const focusT15m = Math.max(firstT, viewRightT - 1 * 900);

        return { viewRightT, focusT5m, focusT15m, mode };
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

        if (!this.enabled5m && !this.enabled15m) return;

        const data = this.getData?.() || [];
        if (data.length < 2) return;

        const anchors = this._getAnchorTime(data);

        // Clip to pane
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, W, H);
        this.ctx.clip();

        // Draw order: 15m behind, then 5m
        if (this.enabled15m) this._drawBlocks(data, 900, anchors, {
            stripes: [
                'rgba(248,81,73,0.14)',  // red
                'rgba(88,166,255,0.14)', // blue
                'rgba(63,185,80,0.14)',  // green
                'rgba(163,113,247,0.14)',// purple
            ],
            border: 'rgba(240,185,11,0.3)',
            borderCurrent: 'rgba(240,185,11,0.6)',
            label: '15m',
        });

        if (this.enabled5m) this._drawBlocks(data, 300, anchors, {
            stripes: [
                'rgba(248,81,73,0.14)',  // red
                'rgba(88,166,255,0.14)', // blue
                'rgba(63,185,80,0.14)',  // green
                'rgba(163,113,247,0.14)',// purple
            ],
            border: 'rgba(56,139,253,0.3)',
            borderCurrent: 'rgba(56,139,253,0.6)',
            label: '5m',
        });

        this.ctx.restore();
    }

    _drawBlocks(data, blockSec, anchors, theme) {
        const timeScale = this.chart.timeScale();
        const series = this.series;

        const { viewRightT, mode } = anchors;
        const focusT = blockSec === 300 ? anchors.focusT5m : anchors.focusT15m;

        // Last hour window based on focus
        const cutoffT = focusT - 3600;
        const sweepFromT = cutoffT - blockSec;
        const sweepFromIdx = Math.max(0, lowerBoundTime(data, sweepFromT));

        // Aggregate high/low per block (only up to focusT)
        const agg = new Map();
        for (let i = sweepFromIdx; i < data.length; i++) {
            const t = getPointTimeSec(data[i]);
            if (t == null) continue;
            const bStart = Math.floor(t / blockSec) * blockSec;
            if (bStart < cutoffT) continue;
            if (bStart >= focusT && mode === 'VIEW') break; // Don't agg "future" blocks in VIEW mode

            const hl = getPointHighLow(data[i]);
            if (!hl) continue;

            const cur = agg.get(bStart);
            if (!cur) agg.set(bStart, { min: hl.low, max: hl.high });
            else {
                if (hl.high > cur.max) cur.max = hl.high;
                if (hl.low < cur.min) cur.min = hl.low;
            }
        }

        // Visible range bounds for culling
        let visFrom = cutoffT;
        let visTo = viewRightT;
        const vr = timeScale.getVisibleRange();
        if (vr) {
            const f = getPointTimeSec({ time: vr.from });
            const t = getPointTimeSec({ time: vr.to });
            if (f != null && t != null) { visFrom = Math.min(f, t); visTo = Math.max(f, t); }
        }

        const startBlock = Math.floor(visFrom / blockSec) * blockSec;
        const endBlock = Math.ceil(visTo / blockSec) * blockSec;
        const quadDur = blockSec / 4;

        for (let bStart = startBlock; bStart <= endBlock; bStart += blockSec) {
            if (bStart < cutoffT) continue;
            const a = agg.get(bStart);
            if (!a) continue;

            const yTop = series.priceToCoordinate(a.max);
            const yBot = series.priceToCoordinate(a.min);
            if (yTop == null || yBot == null) continue;

            const bEnd = bStart + blockSec;
            // Draw box up to either block end OR viewRightT (the visible edge)
            const lineRightT = Math.min(bEnd, viewRightT);

            const x1 = boundaryTimeToX_edge(timeScale, data, bStart);
            const x2 = boundaryTimeToX_edge(timeScale, data, lineRightT);
            if (x1 == null || x2 == null) continue;

            const left = Math.min(x1, x2);
            let right = Math.max(x1, x2);

            // If this is the leading block relative to focusT, stretch it to viewRightT
            if (mode === 'VIEW' && focusT >= bStart && focusT <= bEnd) {
                const xEdge = boundaryTimeToX_edge(timeScale, data, viewRightT);
                if (xEdge != null) right = xEdge;
            }

            const wBox = right - left;
            const hBox = yBot - yTop;
            if (wBox <= 0.5 || hBox === 0) continue;

            // Quadrant stripes (only within the block's natural boundaries)
            for (let q = 0; q < 4; q++) {
                const qStart = bStart + q * quadDur;
                const qEnd = qStart + quadDur;
                if (qStart >= viewRightT) break;

                const qx1 = boundaryTimeToX_edge(timeScale, data, qStart);
                const qx2 = boundaryTimeToX_edge(timeScale, data, Math.min(qEnd, viewRightT));
                if (qx1 == null || qx2 == null) continue;

                const qL = Math.min(qx1, qx2);
                const qR = Math.max(qx1, qx2);
                this.ctx.fillStyle = theme.stripes[q] || theme.stripes[0];
                this.ctx.fillRect(qL, yTop, Math.max(1, qR - qL), hBox);
            }

            const isCurrent = (mode === 'LIVE' && bStart === Math.floor(getPointTimeSec(data[data.length - 1]) / blockSec) * blockSec);
            this.ctx.strokeStyle = isCurrent ? theme.borderCurrent : theme.border;
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.strokeRect(left, yTop, wBox, hBox);
            this.ctx.setLineDash([]);

            this.ctx.fillStyle = isCurrent ? theme.borderCurrent : theme.border;
            this.ctx.font = 'bold 10px Inter, system-ui, sans-serif';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText(`${theme.label}`, left + 4, yTop - 3);

            if (this.debugMode) {
                const d = new Date(bStart * 1000);
                const hh = String(d.getUTCHours()).padStart(2, '0');
                const mm = String(d.getUTCMinutes()).padStart(2, '0');
                this.ctx.strokeStyle = 'rgba(255,0,0,0.65)';
                this.ctx.setLineDash([2, 2]);
                this.ctx.beginPath(); this.ctx.moveTo(left, 0); this.ctx.lineTo(left, this.paneRect.height); this.ctx.stroke();
                this.ctx.setLineDash([]);
                this.ctx.fillStyle = 'rgba(255,0,0,0.85)';
                this.ctx.font = '10px monospace';
                this.ctx.fillText(`${hh}:${mm}Z`, left + 2, this.paneRect.height - 4);
            }
        }
    }
}
