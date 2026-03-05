'use strict';

import {
    $, setText, setStyle, THEME, CANDLE_OPTS, pct,
    getPointTimeSec, getPointHighLow, lowerBoundTime, findMainPaneCanvas, boundaryTimeToX_edge
} from '../utils/ChartHelpers.js';

import DrawingManager from '../drawing/DrawingManager.js';
import TimeBlockOverlay from '../overlays/TimeBlockOverlay.js';
import LiquidityEqOverlay from '../overlays/LiquidityEqOverlay.js';
import { processSimpleMetrics, resetMetrics, setTickBufRef } from '../engines/SimpleMetricsEngine.js';

/* ================================================================
   Micro-Structure X-Ray — App.js (Modular Version)
   ================================================================ */

// ── Crash Black Box Recorder ──
window.__lastSeriesCall = { payload: null, tf: null, type: null, slot: null };
window.onerror = function (msg, url, line, col, error) {
    if (msg.toLowerCase().includes('value is null')) {
        console.group('%c CRASH DETECTED: VALUE IS NULL ', 'background: #f00; color: #fff; font-weight: bold; padding: 4px;');
        console.log('Last Series Call Info:', window.__lastSeriesCall);
        console.log('Error Details:', { msg, url, line, col, error });
        console.groupEnd();
    }
};

function normTimeSec(t) {
    if (t == null) return null;
    const x = Number(t);
    if (!Number.isFinite(x)) return null;
    return x > 1e12 ? Math.floor(x / 1000) : Math.floor(x);
}
function normNum(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
}
function sanitizeTickPoint(p) {
    if (!p) return null;
    const time = normTimeSec(p.time ?? p.timestamp);
    const value = normNum(p.value);
    if (time == null || value == null) return null;
    return { time, value };
}
function sanitizeCandleBar(b) {
    if (!b) return null;
    const time = normTimeSec(b.time ?? b.timestamp);
    const open = normNum(b.open);
    const high = normNum(b.high);
    const low = normNum(b.low);
    const close = normNum(b.close);
    if (time == null || open == null || high == null || low == null || close == null) return null;
    const H = Math.max(high, open, close);
    const L = Math.min(low, open, close);
    return { time, open, high: H, low: L, close };
}

function normalizeTf(tf) {
    if (!tf) return tf;
    const s = String(tf).trim().toLowerCase();
    if (s === 'tick' || s.includes('tick')) return 'tick';
    if (s.match(/^5s/) || s.includes('5 sec')) return '5s';
    if (s.match(/^10s/) || s.includes('10 sec')) return '10s';
    if (s.match(/^15s/) || s.includes('15 sec')) return '15s';
    if (s.match(/^30s/) || s.includes('30 sec')) return '30s';
    if (s.match(/^1m/) || s.includes('1 min')) return '1m';
    if (s.match(/^5m/) || s.includes('5 min')) return '5m';
    return s;
}

/**
 * Ultimate Library Boundary Guard
 * Overrides series.update and series.setData with validation logic.
 */
function wrapGridSeries(slot, side) {
    if (!slot.series) return;
    const origUpdate = slot.series.update.bind(slot.series);
    const origSetData = slot.series.setData.bind(slot.series);

    slot.series.update = function (p) {
        window.__lastSeriesCall = { method: 'update', side, tf: slot.activeTf, type: slot.seriesType, payload: p };
        const clean = slot.seriesType === 'candle' ? sanitizeCandleBar(p) : sanitizeTickPoint(p);
        if (!clean) {
            console.warn(`LWC Guard [${side}]: Dropping invalid data ->`, p);
            return;
        }
        origUpdate(clean);
    };

    slot.series.setData = function (data) {
        window.__lastSeriesCall = { method: 'setData', side, tf: slot.activeTf, type: slot.seriesType, count: data?.length };
        const isCandle = slot.seriesType === 'candle';
        let clean = (data || []).map(d => isCandle ? sanitizeCandleBar(d) : sanitizeTickPoint(d))
            .filter(x => x !== null)
            .sort((a, b) => a.time - b.time);

        // FINAL BOUNDARY DEDUPE
        if (clean.length > 1) {
            const out = [];
            for (const p of clean) {
                if (out.length > 0 && out[out.length - 1].time === p.time) out[out.length - 1] = p;
                else out.push(p);
            }
            clean = out;
        }
        origSetData(clean);
    };
}

class ChartSlot {
    constructor(containerId, type) {
        this.containerId = containerId;
        this.type = type;
        this.chart = null;
        this.series = null;
        this.pendingData = null;
        this.drawing = null;
        this._chartData = [];
        this.uiState = {};
        this.seriesType = type;
        this.isSwitching = false;
        this.activeTf = null;
    }

    init() {
        if (this.chart) return;
        const el = $(this.containerId);
        if (!el || el.clientWidth === 0) return;

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

        new ResizeObserver(() => {
            if (el.clientWidth > 0 && el.clientHeight > 0) {
                this.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            }
        }).observe(el);

        if (this.pendingData?.length) {
            this.setData(this.pendingData);
            this.pendingData = null;
        } else if (this.containerId === 'gridChartLeft' || this.containerId === 'gridChartRight') {
            // Split Mode: Auto-load history from buffers on first init
            rebuildGridPanel(this.containerId === 'gridChartLeft' ? 'left' : 'right');
        }

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

        this.drawing = new DrawingManager(this.chart, this.series, this.containerId, globalDrawings, intervalSec);
        const cp = $('drawColorPicker');
        if (cp) this.drawing.setColor(cp.value);
        const activeToolBtn = document.querySelector('.tool-btn.active');
        if (activeToolBtn) this.drawing.setTool(activeToolBtn.dataset.tool);


        const plotEl = el.querySelector('.tv-chart');
        this.timeBlockOverlay = new TimeBlockOverlay({
            slotContainerEl: el, plotEl: plotEl || el, chart: this.chart, series: this.series,
            intervalSec: intervalSec, getData: () => this._chartData || []
        });

        this.liquidityEqOverlay = new LiquidityEqOverlay({
            slotContainerEl: el, plotEl: plotEl || el, chart: this.chart, series: this.series,
            uiState: this.uiState, getData: () => this._chartData || []
        });

        updateBarrierLines();
    }

    setData(data) {
        if (this.series) {
            const arr = data || [];
            const isCandle = this.seriesType === 'candle';
            let clean = arr.map(item => isCandle ? sanitizeCandleBar(item) : sanitizeTickPoint(item))
                .filter(x => x !== null)
                .sort((a, b) => a.time - b.time);

            // DEDUPE (Keep Last)
            if (clean.length > 0) {
                const out = [];
                for (const p of clean) {
                    if (out.length > 0 && out[out.length - 1].time === p.time) out[out.length - 1] = p;
                    else out.push(p);
                }
                clean = out;
            }

            try {
                this.series.setData(clean);
                this._chartData = [...clean];
                this.chart?.timeScale().scrollToRealTime();
            } catch (err) {
                console.warn("LWC Data Alert:", err.message);
            }
        } else { this.pendingData = data; }
    }

    update(point) {
        if (!this.series || this.isSwitching) return;
        const isCandle = this.seriesType === 'candle';
        const clean = isCandle ? sanitizeCandleBar(point) : sanitizeTickPoint(point);
        if (!clean) return;

        this.series.update(clean);
        if (!this._chartData) this._chartData = [];

        if (isCandle) {
            const last = this._chartData[this._chartData.length - 1];
            if (last && last.time === clean.time) {
                this._chartData[this._chartData.length - 1] = { ...clean };
            } else {
                this._chartData.push({ ...clean });
                if (this._chartData.length > 1000) this._chartData.shift();
            }
        } else {
            this._chartData.push(clean);
            if (this._chartData.length > 3600) this._chartData.shift();
        }

        if (this.timeBlockOverlay) this.timeBlockOverlay.onDataUpdated();
        if (this.liquidityEqOverlay) this.liquidityEqOverlay.onDataUpdated();
    }

    scrollToNow() { if (this.chart) this.chart.timeScale().scrollToRealTime(); }
}

// ── Globals ──
let barrierOffset = 2.0;
let barrierDirection = 'up';
let barrierMode = 'float';
let frozenBarrierPrice = null;
let currentSpot = null;
let lastPrice = 0;
const barrierLines = {};
let globalDrawings = [];

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

const TAB_SLOTS = {
    tickView: ['tick'], view5s: ['5s'], view10s: ['10s'], view15s: ['15s'], view30s: ['30s'],
    view1m: ['1m'], view5m: ['5m'], viewGrid: ['gridL', 'gridR'], viewReachGrid: []
};

const candleBuf = { '5s': [], '10s': [], '15s': [], '30s': [], '1m': [], '2m': [], '5m': [] };
let tickBuf = [];
setTickBufRef(tickBuf);

slots.tick.init();

// ── UI Interactivity ──
function activateTab(viewId) {
    const prevView = document.querySelector('.chart-view.active');
    const isFS = prevView?.classList.contains('fullscreen');

    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
    document.querySelectorAll('.chart-view').forEach(v => {
        v.classList.toggle('active', v.id === viewId);
        if (v.id === viewId && isFS) {
            v.classList.add('fullscreen');
            const btn = v.querySelector('.fullscreen-btn');
            if (btn) btn.innerHTML = '✖';
        } else if (v.id !== viewId) {
            v.classList.remove('fullscreen');
            const btn = v.querySelector('.fullscreen-btn');
            if (btn) btn.innerHTML = '⛶';
        }
    });

    document.body.classList.toggle('is-split-view', viewId === 'viewGrid');

    const gridConfigPanel = $('reachGridConfigPanel');
    if (gridConfigPanel) gridConfigPanel.style.display = (viewId === 'viewReachGrid') ? 'block' : 'none';
    const slotKeys = TAB_SLOTS[viewId] || [];
    requestAnimationFrame(() => {
        slotKeys.forEach(key => slots[key]?.init());
        if (isFS) {
            setTimeout(() => slotKeys.forEach(key => {
                const s = slots[key];
                if (s.chart) s.chart.applyOptions({ width: $(s.containerId).clientWidth, height: $(s.containerId).clientHeight });
            }), 100);
        }
    });
}
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.view)));

document.querySelectorAll('.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetEl = $(btn.dataset.target); if (!targetEl) return;
        const isFS = targetEl.classList.toggle('fullscreen');
        document.body.classList.toggle('is-fullscreen', document.querySelector('.chart-view.fullscreen') !== null);
        btn.innerHTML = isFS ? '✖' : '⛶';
        setTimeout(() => Object.values(slots).forEach(s => {
            if (s.chart) s.chart.applyOptions({ width: $(s.containerId).clientWidth, height: $(s.containerId).clientHeight });
        }), 50);
    });
});

$('btnExitFullscreen')?.addEventListener('click', () => {
    const fsView = document.querySelector('.chart-view.fullscreen');
    if (fsView) {
        fsView.classList.remove('fullscreen');
        document.body.classList.remove('is-fullscreen');
        const btn = fsView.querySelector('.fullscreen-btn');
        if (btn) btn.innerHTML = '⛶';
        setTimeout(() => Object.values(slots).forEach(s => {
            if (s.chart) s.chart.applyOptions({ width: $(s.containerId).clientWidth, height: $(s.containerId).clientHeight });
        }), 50);
    }
});

$('themeToggle')?.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('light-mode');
    $('themeToggle').textContent = isDark ? '☀' : '🌙';
});

$('btnMarkNow')?.addEventListener('click', () => {
    if (!window.lastKnownEpoch) return;
    Object.values(slots).forEach(s => {
        if (s.drawing && s.chart) s.drawing.drawings.push({ type: 'vline', time: window.lastKnownEpoch, color: s.drawing.drawColor });
    });
});

$('btnScrollNow')?.addEventListener('click', () => Object.values(slots).forEach(s => s.scrollToNow()));

// ── Toolbar & Tools ──
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tool = btn.dataset.tool; if (!tool) return;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b === btn));
        Object.values(slots).forEach(s => { if (s.drawing) s.drawing.setTool(tool); });
    });
});
$('btnDeleteDrawing')?.addEventListener('click', () => Object.values(slots).forEach(s => { if (s.drawing) s.drawing.deleteSelected(); }));
$('drawColorPicker')?.addEventListener('input', e => Object.values(slots).forEach(s => { if (s.drawing) s.drawing.setColor(e.target.value); }));

// ── Grid Resizer ──
const gridResizer = $('gridResizer');
if (gridResizer) {
    let rs = false;
    gridResizer.addEventListener('mousedown', () => { rs = true; document.body.style.cursor = 'col-resize'; });
    window.addEventListener('mousemove', e => {
        if (!rs) return;
        const vg = $('viewGrid'); if (!vg) return;
        const r = vg.getBoundingClientRect();
        let p = ((e.clientX - r.left) / r.width) * 100; p = Math.max(10, Math.min(90, p));
        $('gridLeft').style.flex = `0 0 ${p}%`; $('gridRight').style.flex = `0 0 ${100 - p}%`;
    });
    window.addEventListener('mouseup', () => {
        if (rs) {
            rs = false; document.body.style.cursor = '';
            requestAnimationFrame(() => {
                if (slots.gridL.chart) slots.gridL.chart.applyOptions({ width: $('gridChartLeft').clientWidth });
                if (slots.gridR.chart) slots.gridR.chart.applyOptions({ width: $('gridChartRight').clientWidth });
            });
        }
    });
}

function getGridTf(side) {
    const val = $(side === 'left' ? 'gridLeftTf' : 'gridRightTf')?.value;
    return normalizeTf(val) || '5s';
}

function rebuildGridPanel(side) {
    const tf = getGridTf(side);
    const slot = side === 'left' ? slots.gridL : slots.gridR;
    if (!slot.chart) return;

    // ---- LAYER 1: START SWITCH LOCK ----
    slot.isSwitching = true;
    slot.activeTf = null;

    try {
        // Safety: Reset managers BEFORE removing series to avoid "Zombie Series" errors
        if (slot.drawing) slot.drawing.series = null;
        if (slot.timeBlockOverlay) slot.timeBlockOverlay.series = null;
        if (slot.liquidityEqOverlay) slot.liquidityEqOverlay.series = null;

        if (slot.series) { delete barrierLines[side === 'left' ? 'gridL' : 'gridR']; slot.chart.removeSeries(slot.series); slot.series = null; }
        if (tf === 'tick') {
            slot.series = slot.chart.addSeries(LightweightCharts.LineSeries, { color: '#58a6ff', lineWidth: 2 });
            slot.seriesType = 'line';
        }
        else {
            slot.series = slot.chart.addSeries(LightweightCharts.CandlestickSeries, CANDLE_OPTS);
            slot.seriesType = 'candle';
        }

        // ---- LAYER 4: ULTIMATE LIBRARY BOUNDARY WRAP ----
        wrapGridSeries(slot, side);

        // Re-initialize managers for the new series IMMEDIATELY
        const tfMap = { 'tick': 1, '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '5m': 300 };
        const intervalSec = tfMap[tf] || 5;

        if (!slot.drawing) {
            slot.drawing = new DrawingManager(slot.chart, slot.series, slot.containerId, globalDrawings, intervalSec);
        } else {
            slot.drawing.series = slot.series;
            slot.drawing.intervalSec = intervalSec;
        }

        if (slot.timeBlockOverlay) {
            slot.timeBlockOverlay.series = slot.series;
            slot.timeBlockOverlay.intervalSec = intervalSec;
        }
        if (slot.liquidityEqOverlay) slot.liquidityEqOverlay.series = slot.series;

        if (tf === 'tick') {
            console.log('[GRID]', side, 'tfRaw=', side === 'left' ? $('gridLeftTf')?.value : $('gridRightTf')?.value, 'tfNorm=', tf, 'keys=', Object.keys(candleBuf));
            console.log('[GRID]', side, 'dataLen=', tickBuf.length);
            slot.setData([...tickBuf]);
        }
        else {
            const d = candleBuf[tf] ?? [];
            console.log('[GRID]', side, 'tfRaw=', side === 'left' ? $('gridLeftTf')?.value : $('gridRightTf')?.value, 'tfNorm=', tf, 'keys=', Object.keys(candleBuf));
            console.log('[GRID]', side, 'dataLen=', d.length);
            slot.setData([...d]);
        }

        // officially running this TF now
        slot.activeTf = tf;

        // ---- REFRESH VIEW (RAF) ----
        requestAnimationFrame(() => {
            if (slot.chart) {
                slot.chart.timeScale().fitContent();
            }
        });
    } finally {
        // ---- LAYER 1: END SWITCH LOCK (Delay 1 frame for stability) ----
        requestAnimationFrame(() => { slot.isSwitching = false; });
    }
}
$('gridLeftTf')?.addEventListener('change', () => rebuildGridPanel('left'));
$('gridRightTf')?.addEventListener('change', () => rebuildGridPanel('right'));

// ── Analytics & WebSocket ──
function updateCountdowns(data) {
    const CD_MAP = { '5s': { f: 'cd5s', t: 'cdt5s' }, '10s': { f: 'cd10s', t: 'cdt10s' }, '15s': { f: 'cd15s', t: 'cdt15s' }, '30s': { f: 'cd30s', t: 'cdt30s' }, '1m': { f: 'cd1m', t: 'cdt1m' }, '5m': { f: 'cd5m', t: 'cdt5m' } };
    for (const [tf, ids] of Object.entries(CD_MAP)) {
        const cd = data[tf]; if (!cd) continue;
        if ($(ids.f)) setStyle(ids.f, 'width', Math.round(cd.pct * 100) + '%');
        if ($(ids.t)) setText(ids.t, cd.remaining.toFixed(1) + 's');
    }
}

function handleAnalytics(d) {
    setText('currentPrice', d.price.toFixed(2));
    const pEl = $('currentPrice');
    if (pEl) pEl.style.color = d.price > lastPrice ? '#22c55e' : (d.price < lastPrice ? '#ef4444' : '#f1f5f9');
    lastPrice = d.price;
    setText('tickCounter', `${d.tickCount} ticks`);

    const wBadge = $('warmupBadge');
    if (wBadge) {
        if (d.warmupProgress < 1) {
            wBadge.style.display = 'inline-block';
            wBadge.textContent = `WARMING UP (${Math.round(d.warmupProgress * 100)}%)`;
        } else { wBadge.style.display = 'none'; }
    }

    // --- Health Panel Updates ---
    if (d.serverStats) {
        setText('healthWs', 'CONNECTED');
        setText('healthLast', new Date().toLocaleTimeString());

        // TPM Calculation (approximate from tickCount delta if interval is known, or just use server uptime)
        const uptime = d.serverStats.uptime || 1;
        const tpm = Math.round((d.tickCount / uptime) * 60);
        setText('healthTpm', tpm);

        setText('healthTickBuf', tickBuf.length);
        const candleCount = Object.values(candleBuf).reduce((sum, arr) => sum + arr.length, 0);
        setText('healthCandleBuf', candleCount);

        // Also update the old devStatsPanel if it's visible
        setText('statUptime', d.serverStats.uptime + 's');
        setText('statMemory', d.serverStats.memory + 'MB');
        setText('statConnections', d.serverStats.connections);
        setText('statGaps', d.serverStats.gaps);
    }

    if (d.volatility && d.volatility.rollingVol) {
        const vol = d.volatility;
        const bVal = vol.rollingVol[300] || 0.0001;
        [10, 30, 60].forEach(w => {
            const v = vol.rollingVol[w];
            if (v != null) setStyle('bar' + w, 'width', Math.min((v / (bVal * 2)) * 100, 100) + '%');
        });
        setText('volRatio', vol.volRatio != null ? vol.volRatio.toFixed(2) : '--');
        setText('volTrend', vol.volTrend || '--');
        if (vol.momentum) setText('momentum', `${vol.momentum.direction} (${vol.momentum.score.toFixed(2)})`);
    }

    if (d.active) {
        const a = d.active;
        const eVal = (a.edge * 100);
        setText('edgeNumber', (eVal >= 0 ? '+' : '') + eVal.toFixed(1) + '%');
        const eEl = $('edgeNumber'); if (eEl) eEl.style.color = eVal >= 0 ? '#22c55e' : '#ef4444';
        setText('ourProb', (a.ourProb * 100).toFixed(1) + '%');
        setText('derivProb', (a.impliedProb * 100).toFixed(1) + '%');
        setText('theoProb', a.theoretical != null ? (a.theoretical * 100).toFixed(1) + '%' : 'N/A');
        setText('empProb', a.empirical != null ? (a.empirical * 100).toFixed(1) + '%' : 'N/A');
        if ($('sampleSize')) setText('sampleSize', a.sampleSize || '--');
    }
}

const wsUrl = `ws://${window.location.hostname}:${window.location.port || 8080}`;
let ws;
let reconnectAttempts = 0;

function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        setText('symbolBadge', 'CONNECTED');
        setStyle('symbolBadge', 'color', 'var(--accent)');
        reconnectAttempts = 0;
    };
    ws.onclose = () => {
        setText('symbolBadge', 'RECONNECTING...'); setStyle('symbolBadge', 'color', 'var(--yellow)');
        setText('healthWs', 'DISCONNECTED');
        let delay = Math.min(15000, Math.pow(2, reconnectAttempts) * 1000);
        setTimeout(() => { reconnectAttempts++; connectWebSocket(); }, delay);
    };
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'symbol': setText('symbolBadge', msg.data); break;
                case 'config': if (msg.data.barrier) { barrierOffset = parseFloat(msg.data.barrier); setText('barrierInput', barrierOffset); } break;
                case 'tick': {
                    slots.tick.update(msg.data);
                    window.lastKnownEpoch = msg.data.time;
                    tickBuf.push(msg.data); if (tickBuf.length > 3600) tickBuf.shift();

                    // LAYER 2: TYPE-SAFE ROUTING
                    if (slots.gridL && !slots.gridL.isSwitching && slots.gridL.activeTf === 'tick' && slots.gridL.seriesType === 'line') {
                        slots.gridL.update(msg.data);
                    }
                    if (slots.gridR && !slots.gridR.isSwitching && slots.gridR.activeTf === 'tick' && slots.gridR.seriesType === 'line') {
                        slots.gridR.update(msg.data);
                    }

                    currentSpot = msg.data.value;
                    updateBarrierLines();
                    processSimpleMetrics();
                    break;
                }
                case 'countdown': updateCountdowns(msg.data); break;
                case 'candle_closed': pushCandle(msg.data.timeframe, msg.data.data); break;
                case 'candle_update': updateLiveCandle(msg.data.timeframe, msg.data.data); break;
                case 'history': loadHistory(msg.data); break;
                case 'reach_grid': handleReachGrid(msg.data); break;
                case 'analytics': handleAnalytics(msg.data); break;

            }
        } catch (err) { console.error(err); }
    };
}
connectWebSocket();


function routeCandleToGrid(tf, candle) {
    if (slots.gridL && !slots.gridL.isSwitching && slots.gridL.activeTf === tf && slots.gridL.seriesType === 'candle') {
        slots.gridL.update(candle);
    }
    if (slots.gridR && !slots.gridR.isSwitching && slots.gridR.activeTf === tf && slots.gridR.seriesType === 'candle') {
        slots.gridR.update(candle);
    }
}

function pushCandle(tf, candle) {
    if (!candleBuf[tf]) candleBuf[tf] = [];
    const buf = candleBuf[tf];
    const last = buf[buf.length - 1];

    if (last && last.time === candle.time) {
        buf[buf.length - 1] = { ...candle }; // Replace/Update last
    } else {
        buf.push(candle);
        if (buf.length > 1000) buf.shift();
    }

    if (slots[tf]) slots[tf].update(candle);
    routeCandleToGrid(tf, candle);
}

function updateLiveCandle(tf, candle) {
    if (slots[tf]) slots[tf].update(candle);
    routeCandleToGrid(tf, candle);
}

function loadHistory(h) {
    if (h.historicalTicks?.length) {
        slots.tick.setData(h.historicalTicks);
        tickBuf.push(...h.historicalTicks.slice(-3600));
        resetMetrics();
        if (getGridTf('left') === 'tick') slots.gridL?.setData(h.historicalTicks);
        if (getGridTf('right') === 'tick') slots.gridR?.setData(h.historicalTicks);
    }
    const map = { '5s': 'historicalC5s', '10s': 'historicalC10s', '15s': 'historicalC15s', '30s': 'historicalC30s', '1m': 'historicalC1m', '5m': 'historicalC5m' };
    for (const [tf, key] of Object.entries(map)) {
        if (h[key]?.length) {
            candleBuf[tf] = [...h[key]];
            slots[tf]?.setData(h[key]);
            if (getGridTf('left') === tf) slots.gridL?.setData(h[key]);
            if (getGridTf('right') === tf) slots.gridR?.setData(h[key]);
        }
    }
}

// ── Barrier System ──
const BARRIER_LINE_OPTS = { color: '#00e5ff', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Barrier' };

function updateBarrierLines() {
    if (currentSpot == null) return;
    const p = barrierMode === 'freeze' ? frozenBarrierPrice : (barrierDirection === 'up' ? currentSpot + barrierOffset : currentSpot - barrierOffset);
    if (!Number.isFinite(p)) return; // CRITICAL: Stop NaNs from crashing LWC

    ['tick', '5s', '10s', '15s', '30s', '1m', '5m', 'gridL', 'gridR'].forEach(k => {
        const s = slots[k]; if (!s?.series) return;
        if (!barrierLines[k]) barrierLines[k] = s.series.createPriceLine({ ...BARRIER_LINE_OPTS, price: p });
        else barrierLines[k].applyOptions({ price: p });
    });
}

function setDirection(dir) {
    barrierDirection = dir;
    $('btnUp')?.classList.toggle('active', dir === 'up');
    $('btnDown')?.classList.toggle('active', dir === 'down');
    updateBarrierLines();
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'update_config', direction: dir }));
}

function setBarrierMode(mode) {
    barrierMode = mode;
    $('btnFloat')?.classList.toggle('active', mode === 'float');
    $('btnFreeze')?.classList.toggle('active', mode === 'freeze');
    if (mode === 'freeze') frozenBarrierPrice = (barrierDirection === 'up' ? currentSpot + barrierOffset : currentSpot - barrierOffset);
    updateBarrierLines();
}

$('barrierInput')?.addEventListener('input', e => {
    barrierOffset = parseFloat(e.target.value) || 2.0; updateBarrierLines();
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'update_config', barrier: barrierOffset }));
});
$('roiInput')?.addEventListener('input', e => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'update_config', payoutROI: parseFloat(e.target.value) }));
});
$('btnUp')?.addEventListener('click', () => setDirection('up'));
$('btnDown')?.addEventListener('click', () => setDirection('down'));
$('btnFloat')?.addEventListener('click', () => setBarrierMode('float'));
$('btnFreeze')?.addEventListener('click', () => setBarrierMode('freeze'));

// ── Reach Grid ──
let reachGridMode = 'either';
let reachGridHorizon = 1800;

function syncReachGridConfig() {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'update_reach_config', mode: reachGridMode, horizon: reachGridHorizon }));
}
$('btnGridEither')?.addEventListener('click', () => { reachGridMode = 'either'; updateReachGridBtns(); syncReachGridConfig(); });
$('btnGridUp')?.addEventListener('click', () => { reachGridMode = 'up'; updateReachGridBtns(); syncReachGridConfig(); });
$('btnGridDown')?.addEventListener('click', () => { reachGridMode = 'down'; updateReachGridBtns(); syncReachGridConfig(); });
[10, 30, 2].forEach(v => {
    const id = v === 2 ? 'btnGrid2h' : (v === 10 ? 'btnGrid10m' : 'btnGrid30m');
    const sec = v === 2 ? 7200 : v * 60;
    $(id)?.addEventListener('click', () => { reachGridHorizon = sec; updateReachGridBtns(); syncReachGridConfig(); });
});
function updateReachGridBtns() {
    $('btnGridEither')?.classList.toggle('active', reachGridMode === 'either');
    $('btnGridUp')?.classList.toggle('active', reachGridMode === 'up');
    $('btnGridDown')?.classList.toggle('active', reachGridMode === 'down');
    [$('btnGrid10m'), $('btnGrid30m'), $('btnGrid2h')].forEach(b => {
        if (b) b.classList.toggle('active', parseInt(b.dataset.sec) === reachGridHorizon);
    });
}

function handleReachGrid(data) {
    const table = $('reachGridTable'); if (!table) return;
    const { matrix, distances, horizons, mode } = data;
    let html = '<thead><tr><th>Dist</th>' + horizons.map(h => `<th>${h}s</th>`).join('') + '</tr></thead><tbody>';
    distances.forEach((d, rIdx) => {
        html += `<tr><td class="distance-col">${d.toFixed(1)}</td>`;
        horizons.forEach((h, cIdx) => {
            const val = matrix[rIdx][cIdx][mode] || 0;
            const pctVal = Math.round(val * 100);
            const heat = Math.round(pctVal / 10) * 10;
            html += `<td class="reach-cell bg-heat-${heat}">${pctVal}%</td>`;
        });
        html += '</tr>';
    });
    table.innerHTML = html + '</tbody>';
}
