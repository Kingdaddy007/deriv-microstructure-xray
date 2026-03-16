import { getPointTimeSec, getPointHighLow, lowerBoundTime, findMainPaneCanvas, boundaryTimeToX_edge } from '../utils/ChartHelpers.js';

/* ================================================================
   LIQUIDITY + EQUILIBRIUM OVERLAY (V1)
   ================================================================ */

export default class LiquidityEqOverlay {
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
            this.uiState.liqEq = { enabled5m: false, enabled15m: false, enabledMid: true };
        }

        this._effectiveMode = 'LIVE';
        this.blockDepth = 3;

        this._cachedBlocks5m = [];
        this._cachedBlocks15m = [];
        this._lastDataLength = -1;
        this._lastAnchorT = -1;
        this._lastBlockDepth = -1;

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

    _isLightMode() {
        return document.body.classList.contains('light-mode');
    }

    _controlTheme() {
        return this._isLightMode()
            ? {
                border: '1px solid rgba(15,23,42,.12)',
                background: 'rgba(255,255,255,.92)',
                color: 'rgba(15,23,42,.78)',
                activeBlue: 'rgba(37,99,235,.78)',
                activeAmber: 'rgba(217,119,6,.78)',
                activeNeutral: 'rgba(71,85,105,.55)',
                liveBg: 'rgba(37,99,235,0.14)',
                liveBorder: '1px solid rgba(37,99,235,0.34)',
                liveColor: '#1d4ed8',
                viewBg: 'rgba(217,119,6,0.14)',
                viewBorder: '1px solid rgba(217,119,6,0.32)',
                viewColor: '#b45309',
                tagBg: 'rgba(255,255,255,0.92)'
            }
            : {
                border: '1px solid rgba(255,255,255,.15)',
                background: 'rgba(0,0,0,.35)',
                color: 'rgba(255,255,255,.85)',
                activeBlue: 'rgba(56,139,253,.65)',
                activeAmber: 'rgba(245,158,11,.65)',
                activeNeutral: 'rgba(255,255,255,.5)',
                liveBg: 'rgba(56,139,253,0.3)',
                liveBorder: '1px solid rgba(56,139,253,0.6)',
                liveColor: '#fff',
                viewBg: 'rgba(240,185,11,0.3)',
                viewBorder: '1px solid rgba(240,185,11,0.6)',
                viewColor: '#fff',
                tagBg: 'rgba(20,20,20,0.85)'
            };
    }

    refreshTheme() {
        if (typeof this._syncToggleTheme === 'function') this._syncToggleTheme();
        if (typeof this._updateBadgeUI === 'function') this._updateBadgeUI();
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

        const getActiveColor = (theme, key) => {
            if (key === 'enabled5m') return theme.activeBlue;
            if (key === 'enabled15m') return theme.activeAmber;
            return theme.activeNeutral;
        };

        const mkBtn = (label, key) => {
            const b = document.createElement('button');
            b.className = 'tb-btn';
            b.style.font = '12px Inter, system-ui, sans-serif';
            b.style.padding = '4px 8px';
            b.style.borderRadius = '6px';
            b.style.cursor = 'pointer';
            b.textContent = label;

            const sync = () => {
                const theme = this._controlTheme();
                b.style.border = theme.border;
                b.style.background = theme.background;
                b.style.color = theme.color;
                b.style.borderColor = theme.border.match(/rgba?\([^)]*\)/)?.[0] || 'rgba(255,255,255,.15)';
                if (this.uiState.liqEq[key]) {
                    b.style.borderColor = getActiveColor(theme, key);
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

        const btn5 = mkBtn('5m L', 'enabled5m');
        const btn15 = mkBtn('15m L', 'enabled15m');
        const btnMid = mkBtn('Mid', 'enabledMid');

        // Depth selector button
        const btnDepth = document.createElement('button');
        btnDepth.className = 'tb-btn';
        btnDepth.style.font = '12px Inter, system-ui, sans-serif';
        btnDepth.style.padding = '4px 8px';
        btnDepth.style.borderRadius = '6px';
        btnDepth.style.cursor = 'pointer';
        const syncDepth = () => {
            const nextTheme = this._controlTheme();
            btnDepth.textContent = `[${this.blockDepth}]`;
            btnDepth.style.border = nextTheme.border;
            btnDepth.style.background = nextTheme.background;
            btnDepth.style.color = nextTheme.color;
        };
        syncDepth();
        btnDepth.onclick = (e) => {
            e.stopPropagation();
            this.blockDepth = this.blockDepth === 3 ? 1 : this.blockDepth + 1;
            syncDepth();
            this.onDataUpdated();
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
            const nextTheme = this._controlTheme();
            if (this._effectiveMode === 'LIVE') {
                badge.textContent = 'LIVE';
                badge.style.background = nextTheme.liveBg;
                badge.style.border = nextTheme.liveBorder;
                badge.style.color = nextTheme.liveColor;
            } else {
                badge.textContent = 'VIEW';
                badge.style.background = nextTheme.viewBg;
                badge.style.border = nextTheme.viewBorder;
                badge.style.color = nextTheme.viewColor;
            }
        };
        this._updateBadgeUI();

        this._syncToggleTheme = () => {
            const nextTheme = this._controlTheme();
            btn5.style.border = nextTheme.border;
            btn5.style.background = nextTheme.background;
            btn5.style.color = nextTheme.color;
            btn5.style.borderColor = this.uiState.liqEq.enabled5m ? nextTheme.activeBlue : (nextTheme.border.match(/rgba?\([^)]*\)/)?.[0] || 'rgba(255,255,255,.15)');

            btn15.style.border = nextTheme.border;
            btn15.style.background = nextTheme.background;
            btn15.style.color = nextTheme.color;
            btn15.style.borderColor = this.uiState.liqEq.enabled15m ? nextTheme.activeAmber : (nextTheme.border.match(/rgba?\([^)]*\)/)?.[0] || 'rgba(255,255,255,.15)');

            btnMid.style.border = nextTheme.border;
            btnMid.style.background = nextTheme.background;
            btnMid.style.color = nextTheme.color;
            btnMid.style.borderColor = this.uiState.liqEq.enabledMid ? nextTheme.activeNeutral : (nextTheme.border.match(/rgba?\([^)]*\)/)?.[0] || 'rgba(255,255,255,.15)');

            syncDepth();
            this._updateBadgeUI();
        };

        wrap.appendChild(btn5);
        wrap.appendChild(btn15);
        wrap.appendChild(btnMid);
        wrap.appendChild(btnDepth);
        wrap.appendChild(badge);
        this.slotContainerEl.appendChild(wrap);
        this.togglesWrap = wrap;
    }

    onDataUpdated() {
        this._computeBlocks();
        this.requestRender();
    }

    _getAnchorTime(data) {
        const actualLastT = getPointTimeSec(data[data.length - 1]);
        const thresholdSec = 60; // Increased threshold for mode switching (1 min)

        let viewRightT = actualLastT;
        let focusT = actualLastT;
        let mode = 'LIVE';

        try {
            const lr = this.chart.timeScale().getVisibleLogicalRange();
            if (lr) {
                const toIdx = Math.min(data.length - 1, Math.max(0, Math.floor(lr.to)));
                const focusIdx = Math.min(data.length - 1, Math.max(0, Math.floor(lr.from + ((lr.to - lr.from) * 0.6))));
                let vT = getPointTimeSec(data[toIdx]);
                let fT = getPointTimeSec(data[focusIdx]);

                if (vT != null) {
                    vT = Math.min(vT, actualLastT);
                    if ((actualLastT - vT) > thresholdSec) {
                        viewRightT = vT;
                        mode = 'VIEW';
                        if (fT != null) focusT = Math.min(fT, actualLastT);
                    }
                }
            }
        } catch { /* ignore */ }

        if (mode === 'VIEW' && this._lastViewRightT && Math.abs(viewRightT - this._lastViewRightT) < 5) {
            viewRightT = this._lastViewRightT;
        }
        this._lastViewRightT = viewRightT;
        this._effectiveMode = mode;
        if (this._updateBadgeUI) this._updateBadgeUI();

        const focusT5m = mode === 'VIEW' ? focusT : viewRightT;
        const focusT15m = mode === 'VIEW' ? focusT : viewRightT;

        return { viewRightT, focusT5m, focusT15m, mode };
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

    _computeBlocks() {
        const data = this.getData?.() || [];
        if (data.length < 2) return;

        const anchors = this._getAnchorTime(data);
        if (!anchors) return;

        // Use focusT for caching logic so levels don't jump on every pixel drag within a block
        const focusKey = anchors.mode === 'LIVE' ? 'LIVE' : `${anchors.focusT5m}_${anchors.focusT15m}`;

        if (this._lastDataLength === data.length && this._lastFocusKey === focusKey && this._lastBlockDepth === this.blockDepth) return;
        this._lastDataLength = data.length;
        this._lastFocusKey = focusKey;
        this._lastBlockDepth = this.blockDepth;

        const getClosedLeadingBlocks = (blockSec, focusT, mode) => {
            const focusBlock = Math.floor(focusT / blockSec) * blockSec;
            const cutoffT = focusBlock - (blockSec * (this.blockDepth + 1));
            const sweepFromIdx = Math.max(0, lowerBoundTime(data, cutoffT));

            const agg = new Map();
            for (let i = sweepFromIdx; i < data.length; i++) {
                const t = getPointTimeSec(data[i]);
                if (t == null) continue;
                const bStart = Math.floor(t / blockSec) * blockSec;

                if (bStart >= focusBlock && mode === 'VIEW') break; // Only closed relative to focus
                if (bStart >= focusBlock && mode === 'LIVE') break; // Default behavior
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

            const sortedStarts = Array.from(agg.keys()).sort((a, b) => b - a).slice(0, this.blockDepth);
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

        this._cachedBlocks5m = getClosedLeadingBlocks(300, anchors.focusT5m, anchors.mode);
        this._cachedBlocks15m = getClosedLeadingBlocks(900, anchors.focusT15m, anchors.mode);
    }

    requestRender() {
        if (this._pending) return;
        this._pending = true;
        requestAnimationFrame(() => this._render());
    }

    _render() {
        this._pending = false;
        this._computeBlocks();
        this._syncToPane();

        const W = this.paneRect.width;
        const H = this.paneRect.height;
        if (W <= 0 || H <= 0) return;

        this.ctx.clearRect(0, 0, W, H);

        if (!this.uiState.liqEq.enabled5m && !this.uiState.liqEq.enabled15m) return;

        const data = this.getData?.() || [];
        if (data.length < 2) return;
        const actualLastT = getPointTimeSec(data[data.length - 1]);
        if (actualLastT == null) return;

        const anchors = this._getAnchorTime(data);
        if (!anchors) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, W, H);
        this.ctx.clip();

        const ts = this.chart.timeScale();
        let rightEdgeX = boundaryTimeToX_edge(ts, data, anchors.viewRightT);
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

            this.ctx.fillStyle = this._controlTheme().tagBg;
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



        this.ctx.setLineDash([]);
        this.ctx.restore();
    }
}
