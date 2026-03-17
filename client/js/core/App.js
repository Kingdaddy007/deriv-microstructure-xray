'use strict';

import {
    $, setText, setStyle, THEME, CANDLE_OPTS, pct,
    getPointTimeSec, getPointHighLow, lowerBoundTime, findMainPaneCanvas, boundaryTimeToX_edge
} from '../utils/ChartHelpers.js';

import DrawingManager from '../drawing/DrawingManager.js';
import TimeBlockOverlay from '../overlays/TimeBlockOverlay.js?v=2';
import LiquidityEqOverlay from '../overlays/LiquidityEqOverlay.js?v=2';
import TradeOverlay from '../overlays/TradeOverlay.js?v=2';
import { processSimpleMetrics, resetMetrics, setTickBufRef } from '../engines/SimpleMetricsEngine.js';
import TradingPanel from '../trading/TradingPanel.js?v=5';

/* ================================================================
   Micro-Structure X-Ray — App.js (Modular Version)
   ================================================================ */

// ── Crash Black Box Recorder ──
window.__lastSeriesCall = { payload: null, tf: null, type: null, slot: null };
const _prevOnError = window.onerror;
window.onerror = function (msg, url, line, col, error) {
    if (typeof msg === 'string' && msg.toLowerCase().includes('value is null')) {
        console.group('%c CRASH DETECTED: VALUE IS NULL ', 'background: #f00; color: #fff; font-weight: bold; padding: 4px;');
        console.log('Last Series Call Info:', window.__lastSeriesCall);
        console.log('Error Details:', { msg, url, line, col, error });
        console.groupEnd();
    }
    if (_prevOnError) return _prevOnError(msg, url, line, col, error);
};

// --- DIAGNOSTIC HELPERS (dev-mode only) ---
// Enable by running in the browser console: localStorage.setItem('devMode', '1')
if (localStorage.getItem('devMode') === '1') {
    window.debugSnapshot = (blockStart) => {
        if (!ws || ws.readyState !== 1) return console.error("WS not ready (check console)");
        ws.send(JSON.stringify({ type: 'debug_snapshot', blockStart }));
    };
    window.debugCompare = () => {
        if (!ws || ws.readyState !== 1) return console.error("WS not ready (check console)");
        ws.send(JSON.stringify({ type: 'debug_compare' }));
    };
    window.debugCounters = () => {
        if (!ws || ws.readyState !== 1) return console.error("WS not ready (check console)");
        ws.send(JSON.stringify({ type: 'debug_counters' }));
    };
    console.info('[Dev Mode] Debug helpers active: debugSnapshot, debugCompare, debugCounters');
}

// ── Balance Eye Toggle ──
(function initBalanceToggle() {
    const btn = document.getElementById('balanceToggle');
    const val = document.getElementById('balanceValue');
    if (!btn || !val) return;
    let hidden = true; // start hidden
    btn.addEventListener('click', () => {
        hidden = !hidden;
        if (hidden) {
            val.textContent = '$***.** ';
            val.dataset.hidden = '1';
            btn.classList.add('hidden-balance');
        } else {
            delete val.dataset.hidden;
            btn.classList.remove('hidden-balance');
            // Show stored balance if available
            if (window.__currentBalance) {
                const amt = parseFloat(window.__currentBalance.balance).toFixed(2);
                const cur = window.__currentBalance.currency || 'USD';
                val.textContent = `${cur === 'USD' ? '$' : cur + ' '}${amt} `;
            }
        }
    });
})();

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
    if (s.match(/^2m/) || s.includes('2 min')) return '2m';
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
        this.markersPlugin = null; // LWC v5 series markers plugin instance
        this.tradeOverlay = null;
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

        // Create markers plugin for trade entry dots
        this.markersPlugin = LightweightCharts.createSeriesMarkers(this.series, [], { autoScale: true });

        new ResizeObserver(() => {
            if (el.clientWidth > 0 && el.clientHeight > 0) {
                this.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            }
        }).observe(el);

        if (this.containerId === 'gridChartLeft' || this.containerId === 'gridChartRight') {
            // Grid panels always rebuild from candleBuf — this sets activeTf,
            // correct series type, drawing managers, and barrier lines.
            // pendingData is cleared since rebuildGridPanel reads candleBuf directly.
            this.pendingData = null;
            rebuildGridPanel(this.containerId === 'gridChartLeft' ? 'left' : 'right');
        } else {
            // FIX: Read from live candleBuf/tickBuf instead of stale pendingData.
            // pendingData was set during loadHistory() and becomes stale while the
            // tab is unopened. candleBuf is continuously updated by pushCandle() and
            // updateLiveCandle(), so it always has the latest data.
            this.pendingData = null;
            const bufMap = {
                tickChart: () => [...tickBuf],
                chart5s:   () => [...(candleBuf['5s']  || [])],
                chart10s:  () => [...(candleBuf['10s'] || [])],
                chart15s:  () => [...(candleBuf['15s'] || [])],
                chart30s:  () => [...(candleBuf['30s'] || [])],
                chart1m:   () => [...(candleBuf['1m']  || [])],
                chart5m:   () => [...(candleBuf['5m']  || [])],
            };
            const getData = bufMap[this.containerId];
            if (getData) {
                const liveData = getData();
                if (liveData.length) this.setData(liveData);
            }
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
        const tfMap = { 'tick': 1, '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '2m': 120, '5m': 300 };
            intervalSec = tfMap[tf] || 5;
        }

        this.intervalSec = intervalSec;
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

        this.tradeOverlay = new TradeOverlay({
            slotContainerEl: el,
            plotEl: plotEl || el,
            chart: this.chart,
            series: this.series,
            intervalSec,
            getData: () => this._chartData || [],
            getTrades: () => _buildTradeVisualsForSlot(this)
        });

        updateBarrierLines();
    }

    setData(data, opts = {}) {
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
                if (!opts.skipScroll) this.chart?.timeScale().scrollToRealTime();
                if (this.timeBlockOverlay) this.timeBlockOverlay.onDataUpdated();
                if (this.liquidityEqOverlay) this.liquidityEqOverlay.onDataUpdated();
                if (this.tradeOverlay) this.tradeOverlay.onDataUpdated();
            } catch (err) {
                console.warn("LWC Data Alert:", err.message);
            }
        } else { this.pendingData = data; }
    }

    update(point) {
        if (!this.series || this.isSwitching) return;
        const isCandle = this.seriesType === 'candle';
        let clean = isCandle ? sanitizeCandleBar(point) : sanitizeTickPoint(point);
        if (!clean) return;

        // Snap to timeframe bucket to prevent jitter-induced block assignment shifts
        const intervalSec = this.intervalSec || 1;
        clean.time = Math.floor(clean.time / intervalSec) * intervalSec;

        this.series.update(clean);
        if (!this._chartData) this._chartData = [];

        if (isCandle) {
            const last = this._chartData[this._chartData.length - 1];
            if (last && last.time === clean.time) {
                this._chartData[this._chartData.length - 1] = { ...clean };
            } else {
                this._chartData.push({ ...clean });
            }
        } else {
            this._chartData.push(clean);
        }

        if (this.timeBlockOverlay) this.timeBlockOverlay.onDataUpdated();
        if (this.liquidityEqOverlay) this.liquidityEqOverlay.onDataUpdated();
        if (this.tradeOverlay) this.tradeOverlay.onDataUpdated();
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

// ── Trading Panel (isolated module) ──
let tradingPanel = null;

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

function getChartTheme() {
    const isLight = document.body.classList.contains('light-mode');
    return isLight
        ? {
            layout: { background: { color: 'transparent' }, textColor: '#5b667a' },
            grid: { vertLines: { color: '#d9e0ea' }, horzLines: { color: '#d9e0ea' } },
            crosshair: { mode: 0 },
            timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#d5dae3', rightOffset: 5 },
            rightPriceScale: { borderColor: '#d5dae3' }
        }
        : THEME;
}

function applyThemeToCharts() {
    const chartTheme = getChartTheme();
    Object.values(slots).forEach(slot => {
        if (!slot?.chart) return;
        slot.chart.applyOptions(chartTheme);
        slot.timeBlockOverlay?.refreshTheme?.();
        slot.liquidityEqOverlay?.refreshTheme?.();
        slot.tradeOverlay?.onDataUpdated?.();
    });
}

function syncThemeToggleIcon() {
    const btn = $('themeToggle');
    if (!btn) return;
    const isLight = document.body.classList.contains('light-mode');
    btn.innerHTML = isLight
        ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3.25"/><path d="M8 1.5v2"/><path d="M8 12.5v2"/><path d="M1.5 8h2"/><path d="M12.5 8h2"/><path d="M3.4 3.4l1.4 1.4"/><path d="M11.2 11.2l1.4 1.4"/><path d="M12.6 3.4l-1.4 1.4"/><path d="M4.8 11.2l-1.4 1.4"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8.5a5.5 5.5 0 1 1-6-6 4 4 0 0 0 6 6z"/></svg>';
}

let activeFlyoutId = null;

function closeFlyouts() {
    document.querySelectorAll('.flyout-panel').forEach(panel => panel.classList.add('hidden'));
    document.querySelectorAll('.rail-btn[data-flyout]').forEach(btn => btn.classList.remove('is-active'));
    $('flyoutBackdrop')?.classList.add('hidden');
    activeFlyoutId = null;
}

function openFlyout(flyoutId) {
    const target = $(flyoutId);
    if (!target) return;
    const shouldClose = activeFlyoutId === flyoutId;
    closeFlyouts();
    if (shouldClose) return;

    target.classList.remove('hidden');
    $('flyoutBackdrop')?.classList.remove('hidden');
    document.querySelectorAll('.rail-btn[data-flyout]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.flyout === flyoutId);
    });
    activeFlyoutId = flyoutId;
}

// ── UI Interactivity ──

/**
 * After a layout change (fullscreen enter/exit, tab switch) force
 * LWC to resize and then re-sync all canvas overlays once LWC has
 * finished its internal relayout.  Two passes:
 *   50ms  — applyOptions so LWC picks up new container dimensions
 *   150ms — overlays re-sync to the freshly-laid-out LWC pane canvas
 */
function resizeChartsAndOverlays(slotKeys) {
    const targets = slotKeys
        ? slotKeys.map(k => slots[k]).filter(Boolean)
        : Object.values(slots);
    setTimeout(() => {
        targets.forEach(s => {
            if (s.chart) {
                const el = $(s.containerId);
                s.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            }
        });
    }, 50);
    // Second pass — give LWC time to rebuild internal canvases, then
    // force overlays to re-measure the pane canvas position/size.
    setTimeout(() => {
        targets.forEach(s => {
            if (s.timeBlockOverlay) s.timeBlockOverlay.requestRender();
            if (s.liquidityEqOverlay) s.liquidityEqOverlay.requestRender();
            if (s.tradeOverlay) s.tradeOverlay.requestRender();
        });
    }, 150);
}

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
            // Update split-view pane-expand buttons when entering split view in FS
            if (viewId === 'viewGrid') {
                document.querySelectorAll('.pane-expand-btn').forEach(b => { b.innerHTML = '✖'; b.title = 'Exit fullscreen'; });
            }
        } else if (v.id !== viewId) {
            v.classList.remove('fullscreen');
            const btn = v.querySelector('.fullscreen-btn');
            if (btn) btn.innerHTML = '⛶';
        }
    });

    document.body.classList.toggle('is-split-view', viewId === 'viewGrid');
    if (viewId !== 'viewReachGrid' && activeFlyoutId === 'gridConfigFlyout') closeFlyouts();

    // Reset pane-expanded/fullscreen state when leaving split view
    if (viewId !== 'viewGrid') {
        document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('pane-expanded', 'pane-collapsed'));
        $('gridResizer')?.classList.remove('pane-hidden');
        document.querySelectorAll('.pane-expand-btn').forEach(b => { b.innerHTML = '⛶'; b.title = 'Fullscreen'; });
    }

    const slotKeys = TAB_SLOTS[viewId] || [];
    requestAnimationFrame(() => {
        slotKeys.forEach(key => slots[key]?.init());
        if (isFS) {
            resizeChartsAndOverlays(slotKeys);
        }
    });
}
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.view)));

document.querySelectorAll('.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        closeFlyouts();
        const targetEl = $(btn.dataset.target); if (!targetEl) return;
        const isFS = targetEl.classList.toggle('fullscreen');
        document.body.classList.toggle('is-fullscreen', document.querySelector('.chart-view.fullscreen') !== null);
        btn.innerHTML = isFS ? '✖' : '⛶';
        resizeChartsAndOverlays();
    });
});

$('btnExitFullscreen')?.addEventListener('click', () => {
    const fsView = document.querySelector('.chart-view.fullscreen');
    if (fsView) {
        fsView.classList.remove('fullscreen');
        document.body.classList.remove('is-fullscreen');
        const isGridViewActive = fsView.id === 'viewGrid';
        // Reset single-view fullscreen buttons
        const btn = fsView.querySelector('.fullscreen-btn');
        if (btn) btn.innerHTML = '⛶';
        // Reset split-view fullscreen buttons
        document.querySelectorAll('.pane-expand-btn').forEach(b => {
            b.innerHTML = '⛶';
            b.title = 'Fullscreen';
        });
        if (isGridViewActive) {
            document.body.classList.add('is-split-view');
        }
        resizeChartsAndOverlays();
    }
});

// Split-view fullscreen — both ⛶ buttons fullscreen the entire split view
document.querySelectorAll('.pane-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        closeFlyouts();
        const gridView = $('viewGrid'); if (!gridView) return;
        const isFS = gridView.classList.toggle('fullscreen');
        document.body.classList.toggle('is-fullscreen', isFS);
        document.body.classList.toggle('is-split-view', gridView.classList.contains('active'));

        // Update both pane-expand buttons
        document.querySelectorAll('.pane-expand-btn').forEach(b => {
            b.innerHTML = isFS ? '✖' : '⛶';
            b.title = isFS ? 'Exit fullscreen' : 'Fullscreen';
        });

        // Keep header fullscreen buttons in sync while in split view
        document.querySelectorAll('.fullscreen-btn').forEach(b => {
            b.innerHTML = isFS ? '✖' : '⛶';
        });

        // Resize charts after layout change
        resizeChartsAndOverlays(['gridL', 'gridR']);
    });
});

$('themeToggle')?.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    syncThemeToggleIcon();
    applyThemeToCharts();
});

document.querySelectorAll('.rail-btn[data-flyout]').forEach(btn => {
    btn.addEventListener('click', () => openFlyout(btn.dataset.flyout));
});

$('flyoutBackdrop')?.addEventListener('click', closeFlyouts);
document.querySelectorAll('[data-close-flyout]').forEach(btn => btn.addEventListener('click', closeFlyouts));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeFlyoutId) closeFlyouts();
});

const devStatsPanel = $('devStatsPanel');
$('btnDevStats')?.addEventListener('click', () => {
    if (!devStatsPanel) return;
    const nextHidden = !devStatsPanel.classList.contains('hidden');
    devStatsPanel.classList.toggle('hidden', nextHidden);
    $('btnDevStats')?.classList.toggle('is-active', !nextHidden);
});

syncThemeToggleIcon();
applyThemeToCharts();

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
            resizeChartsAndOverlays(['gridL', 'gridR']);
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
        if (slot.tradeOverlay) slot.tradeOverlay.series = null;

        if (slot.series) {
            const slotKey = side === 'left' ? 'gridL' : 'gridR';
            delete barrierLines[slotKey];
            slot.markersPlugin = null; // Old plugin dies with the old series
            slot.chart.removeSeries(slot.series); slot.series = null;
        }
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
        const tfMap = { 'tick': 1, '5s': 5, '10s': 10, '15s': 15, '30s': 30, '1m': 60, '2m': 120, '5m': 300 };
        const intervalSec = tfMap[tf] || 5;
        slot.intervalSec = intervalSec;

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
        if (slot.tradeOverlay) {
            slot.tradeOverlay.series = slot.series;
            slot.tradeOverlay.intervalSec = intervalSec;
        }

        if (tf === 'tick') {
            slot.setData([...tickBuf], { skipScroll: true });
        }
        else {
            const d = candleBuf[tf] ?? [];
            slot.setData([...d], { skipScroll: true });
        }

        // officially running this TF now
        slot.activeTf = tf;

        // ---- LAYER 1: UNLOCK IMMEDIATELY ----
        // CRITICAL: isSwitching must be cleared synchronously, not in a RAF.
        // A delayed RAF creates a window where candles arrive with the correct activeTf
        // but isSwitching=true, causing them to be silently dropped → chart appears frozen.
        slot.isSwitching = false;

        // Re-create trade visualization lines on new series if a trade is active
        const slotKey = side === 'left' ? 'gridL' : 'gridR';
        _restoreTradeLines(slotKey, slot);

        // ---- REFRESH VIEW (RAF) ----
        // fitContent only affects viewport scroll, so RAF is safe here.
        requestAnimationFrame(() => {
            if (slot.chart) {
                slot.chart.timeScale().fitContent();
            }
        });
    } finally {
        // Safety: if an exception was thrown before isSwitching=false was reached, 
        // make sure we don't leave the slot permanently locked.
        if (slot.isSwitching) {
            slot.isSwitching = false;
            console.warn(`[Diagnostic] REBUILD ${side} EXCEPTION PATH: isSwitching cleared in finally`);
        }
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

    // Update grid panel countdowns based on each panel's selected timeframe
    const gridLeftTf = getGridTf('left');
    const gridRightTf = getGridTf('right');
    const leftCd = gridLeftTf !== 'tick' ? data[gridLeftTf] : null;
    const rightCd = gridRightTf !== 'tick' ? data[gridRightTf] : null;
    setText('cdGridLeft', leftCd ? leftCd.remaining.toFixed(1) + 's' : '--');
    setText('cdGridRight', rightCd ? rightCd.remaining.toFixed(1) + 's' : '--');
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
        if (a.edge != null) {
            const eVal = (a.edge * 100);
            setText('edgeNumber', (eVal >= 0 ? '+' : '') + eVal.toFixed(1) + '%');
            const eEl = $('edgeNumber'); if (eEl) eEl.style.color = eVal >= 0 ? '#22c55e' : '#ef4444';
        } else {
            setText('edgeNumber', 'N/A');
            const eEl = $('edgeNumber'); if (eEl) eEl.style.color = '#8b8b9a';
        }
        setText('ourProb', a.ourProb != null ? (a.ourProb * 100).toFixed(1) + '%' : 'N/A');
        setText('derivProb', (a.impliedProb * 100).toFixed(1) + '%');
        setText('theoProb', a.theoretical != null ? (a.theoretical * 100).toFixed(1) + '%' : 'N/A');
        setText('empProb', a.empirical != null ? (a.empirical * 100).toFixed(1) + '%' : 'N/A');
        if ($('sampleSize')) setText('sampleSize', a.sampleSize || '--');
    }
}

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
let ws;
let reconnectAttempts = 0;

function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        const badge = document.getElementById('symbolBadge');
        if (badge) {
            badge.textContent = 'CONNECTED';
            badge.className = 'badge badge-connected';
        }
        reconnectAttempts = 0;

        // Initialize TradingPanel once we have a live WS
        if (!tradingPanel) {
            const panelEl = document.getElementById('tradingPanel');
            if (panelEl) {
                tradingPanel = new TradingPanel({
                    containerEl: panelEl,
                    ws: ws,
                    getParams: () => ({ barrier: barrierOffset, direction: barrierDirection, symbol: window.__derivSymbol }),
                    onTrade: (tradeInfo) => drawTradeLines(tradeInfo),
                    onToggleClosedTradeVisuals: () => toggleClosedTradeVisuals(),
                    onClearClosedTradeVisuals: () => clearClosedTradeVisuals()
                });
                tradingPanel.updateContractDisplay();
            }
        } else {
            tradingPanel.ws = ws; // Update WS reference on reconnect
        }

        // ── Mode Badge & Balance Subscription ──
        const urlMode = new URLSearchParams(window.location.search).get('mode') || 'demo';
        window.__accountMode = urlMode;
        const modeBadge = document.getElementById('modeBadge');
        if (modeBadge) {
            modeBadge.textContent = urlMode.toUpperCase();
            modeBadge.className = 'badge mono ' + (urlMode === 'real' ? 'badge-real' : 'badge-demo');
        }
        // Subscribe to balance for the current mode
        ws.send(JSON.stringify({ type: 'subscribe_balance', mode: urlMode }));
    };
    ws.onclose = () => {
        const badge = document.getElementById('symbolBadge');
        if (badge) {
            badge.textContent = 'RECONNECTING...';
            badge.className = 'badge badge-connecting';
        }
        setText('healthWs', 'DISCONNECTED');
        let delay = Math.min(15000, Math.pow(2, reconnectAttempts) * 1000);
        setTimeout(() => { reconnectAttempts++; connectWebSocket(); }, delay);
    };
    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'debug_info': console.info(`[Diagnostic] ${msg.data}`); break;
                case 'debug_report': {
                    console.group('%c [DIAGNOSTIC REPORT] ', 'background: #222; color: #bada55; font-weight: bold;');
                    console.log('Block Start:', msg.data.blockStart);
                    console.log('Live Ticks:', msg.data.liveCount);
                    console.log('Official Ticks:', msg.data.officialCount);
                    console.log('Total Rejected (Server Store):', msg.data.totalRejectedInStore);
                    if (msg.data.mismatches && msg.data.mismatches.length > 0) {
                        console.warn(`FOUND ${msg.data.mismatches.length} MISMATCHES:`);
                        console.table(msg.data.mismatches);
                    } else {
                        console.log('✓ NO MISMATCHES FOUND. Live matches history perfectly.');
                    }
                    console.groupEnd();
                    break;
                }
                case 'debug_counters': {
                    console.group('[Diagnostic Counters]');
                    console.table(msg.data);
                    console.groupEnd();
                    break;
                }
                case 'tick': {
                    slots.tick.update(msg.data);
                    window.lastKnownEpoch = msg.data.time;
                    tickBuf.push(msg.data); if (tickBuf.length > 3600) tickBuf.shift();

                    if (slots.gridL && slots.gridL.activeTf === 'tick') {
                        if (!slots.gridL.isSwitching && slots.gridL.seriesType === 'line') {
                            slots.gridL.update(msg.data);
                        }
                    }
                    if (slots.gridR && slots.gridR.activeTf === 'tick') {
                        if (!slots.gridR.isSwitching && slots.gridR.seriesType === 'line') {
                            slots.gridR.update(msg.data);
                        }
                    }

                    currentSpot = msg.data.value;
                    updateBarrierLines();
                    updateActiveTradeColors();
                    processSimpleMetrics();
                    break;
                }
                case 'countdown': updateCountdowns(msg.data); break;
                case 'candle_closed': pushCandle(msg.data.timeframe, msg.data.data); break;
                case 'candle_update': updateLiveCandle(msg.data.timeframe, msg.data.data); break;
                case 'history': loadHistory(msg.data); break;
                case 'reach_grid': handleReachGrid(msg.data); break;
                case 'analytics': handleAnalytics(msg.data); break;
                // Trading panel messages (routed to isolated module)
                case 'account_info':
                case 'proposal_result':
                case 'trade_result':
                case 'trade_error':
                    if (tradingPanel) tradingPanel.handleMessage(msg);
                    break;
                case 'balance': {
                    const balEl = document.getElementById('balanceValue');
                    if (balEl && !balEl.dataset.hidden) {
                        const amt = parseFloat(msg.data.balance).toFixed(2);
                        const cur = msg.data.currency || 'USD';
                        balEl.textContent = `${cur === 'USD' ? '$' : cur + ' '}${amt} `;
                    }
                    window.__currentBalance = msg.data;
                    break;
                }
                // Trade outcome — route to both TradingPanel (history) and App (barrier cleanup)
                case 'trade_outcome':
                    if (tradingPanel) tradingPanel.handleMessage(msg);
                    handleTradeSettlement(msg.data);
                    break;
                // Live contract update — route to both TradingPanel and App (color changes)
                case 'contract_update':
                    if (tradingPanel) tradingPanel.handleMessage(msg);
                    handleContractUpdate(msg.data);
                    break;
            }
        } catch (err) { console.error(err); }
    };
}
connectWebSocket();


function routeCandleToGrid(tf, candle) {
    if (slots.gridL && slots.gridL.activeTf === tf) {
        if (!slots.gridL.isSwitching && slots.gridL.seriesType === 'candle') {
            slots.gridL.update(candle);
        }
    }
    if (slots.gridR && slots.gridR.activeTf === tf) {
        if (!slots.gridR.isSwitching && slots.gridR.seriesType === 'candle') {
            slots.gridR.update(candle);
        }
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
    // Write forming candle to candleBuf so TF switches include it
    if (candleBuf[tf]) {
        const buf = candleBuf[tf];
        const last = buf[buf.length - 1];
        if (last && last.time === candle.time) {
            buf[buf.length - 1] = { ...candle };
        } else {
            buf.push({ ...candle });
            if (buf.length > 1000) buf.shift();
        }
    }
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
    const map = { '5s': 'historicalC5s', '10s': 'historicalC10s', '15s': 'historicalC15s', '30s': 'historicalC30s', '1m': 'historicalC1m', '2m': 'historicalC2m', '5m': 'historicalC5m' };
    for (const [tf, key] of Object.entries(map)) {
        if (h[key]?.length) {
            candleBuf[tf] = [...h[key]];
            // Only setData on slots that are already initialized (have a series).
            // Uninitialized tabs will read from candleBuf when they init().
            if (slots[tf]?.series) slots[tf].setData(h[key]);
            if (getGridTf('left') === tf && slots.gridL?.series) slots.gridL.setData(h[key]);
            if (getGridTf('right') === tf && slots.gridR?.series) slots.gridR.setData(h[key]);
        }
    }
}

// ── Barrier System ──
const BARRIER_LINE_OPTS = { color: '#00e5ff', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Barrier' };

function updateBarrierLines() {
    if (currentSpot == null) return;
    const p = barrierMode === 'freeze' ? frozenBarrierPrice : (barrierDirection === 'up' ? currentSpot + barrierOffset : currentSpot - barrierOffset);
    if (!Number.isFinite(p)) return; // CRITICAL: Stop NaNs from crashing LWC

    // Update barrier distance display in sidebar
    const dist = Math.abs(p - currentSpot);
    setText('barrierDistance', dist.toFixed(2) + ' pts');

    ['tick', '5s', '10s', '15s', '30s', '1m', '5m', 'gridL', 'gridR'].forEach(k => {
        const s = slots[k]; if (!s?.series) return;
        if (!barrierLines[k]) barrierLines[k] = s.series.createPriceLine({ ...BARRIER_LINE_OPTS, price: p });
        else barrierLines[k].applyOptions({ price: p });
    });
}

// ── Trade Visualization (entry markers + finite contract overlays) ──
const ALL_SLOT_KEYS = ['tick', '5s', '10s', '15s', '30s', '1m', '5m', 'gridL', 'gridR'];
const tradeEntryMarkers = [];
const MAX_ENTRY_MARKERS = 20;
const activeTradeContracts = new Map();
const MAX_ACTIVE_CONTRACTS = 10;
const CLOSED_TRADE_RETENTION_MS = 600000;
let hideClosedTradeVisuals = false;

function _inferDirection(entrySpot, barrierPrice, fallback = 'up') {
    if (Number.isFinite(entrySpot) && Number.isFinite(barrierPrice)) {
        return barrierPrice >= entrySpot ? 'up' : 'down';
    }
    return fallback;
}

function _computeTradeColor(direction, entrySpot, barrierPrice, spotNow, isClosedVisual = false, outcome = null) {
    if (outcome === 'won') return '#22c55e';
    if (outcome === 'lost') return '#ef4444';
    if (isClosedVisual) return '#22c55e';
    if (!Number.isFinite(spotNow) || !Number.isFinite(entrySpot) || !Number.isFinite(barrierPrice)) return '#22c55e';
    if (direction === 'up') return spotNow >= entrySpot ? '#22c55e' : '#ef4444';
    return spotNow <= entrySpot ? '#22c55e' : '#ef4444';
}

function _snapToInterval(timeSec, intervalSec) {
    if (!intervalSec || intervalSec <= 1) return timeSec;
    return Math.floor(timeSec / intervalSec) * intervalSec;
}

function _buildMarkersForSlot(slot) {
    const intervalSec = slot.intervalSec || 1;
    return tradeEntryMarkers.map(m => ({
        ...m,
        time: _snapToInterval(m.time, intervalSec)
    }));
}

function _syncMarkersToAllSlots() {
    ALL_SLOT_KEYS.forEach(k => {
        const s = slots[k];
        if (!s?.markersPlugin) return;
        try {
            const markers = _buildMarkersForSlot(s);
            markers.sort((a, b) => a.time - b.time);
            s.markersPlugin.setMarkers(markers);
            if (s.tradeOverlay) s.tradeOverlay.onDataUpdated();
        } catch (err) {
            console.warn(`[TradeViz] Failed to set markers on ${k}:`, err.message);
        }
    });
}

function _buildTradeVisualsForSlot(slot) {
    const intervalSec = slot?.intervalSec || 1;
    return [...activeTradeContracts.values()]
        .filter(contract => !(hideClosedTradeVisuals && contract.isClosedVisual))
        .map(contract => ({
        ...contract,
        entryTimeSec: _snapToInterval(contract.entryTimeSec, intervalSec),
        visualEndTimeSec: _snapToInterval(contract.visualEndTimeSec, intervalSec)
        }));
}

function _refreshTradeOverlays() {
    ALL_SLOT_KEYS.forEach(k => {
        const s = slots[k];
        if (s?.tradeOverlay) s.tradeOverlay.onDataUpdated();
    });
}

function _upsertEntryMarker(contractKey, entryTimeSec, entrySpot, color) {
    if (!Number.isFinite(entryTimeSec) || !Number.isFinite(entrySpot)) return;
    let marker = tradeEntryMarkers.find(m => m.id === `entry-${contractKey}`);
    if (!marker) {
        marker = {
            time: entryTimeSec,
            position: 'atPriceMiddle',
            shape: 'circle',
            color,
            size: 0.5,
            text: '',
            id: `entry-${contractKey}`,
            price: entrySpot
        };
        tradeEntryMarkers.push(marker);
        while (tradeEntryMarkers.length > MAX_ENTRY_MARKERS) tradeEntryMarkers.shift();
    } else {
        marker.time = entryTimeSec;
        marker.price = entrySpot;
        marker.color = color;
    }
}

function _removeContractBarrier(contractKey) {
    const contract = activeTradeContracts.get(contractKey);
    if (contract?.cleanupTimer) clearTimeout(contract.cleanupTimer);
    activeTradeContracts.delete(contractKey);
    _refreshTradeOverlays();
}

function toggleClosedTradeVisuals() {
    hideClosedTradeVisuals = !hideClosedTradeVisuals;
    _refreshTradeOverlays();
    return hideClosedTradeVisuals;
}

function clearClosedTradeVisuals() {
    let removed = 0;
    for (const [contractKey, contract] of activeTradeContracts) {
        if (contract.isClosedVisual) {
            _removeContractBarrier(contractKey);
            removed++;
        }
    }
    return removed;
}

function _scheduleContractCleanup(contractKey, delayMs = CLOSED_TRADE_RETENTION_MS) {
    const contract = activeTradeContracts.get(contractKey);
    if (!contract) return;
    if (contract.cleanupTimer) clearTimeout(contract.cleanupTimer);
    contract.cleanupTimer = setTimeout(() => {
        const latest = activeTradeContracts.get(contractKey);
        if (latest?.isClosedVisual) _removeContractBarrier(contractKey);
    }, delayMs);
}

function _closeVisualTrade(contractKey, contract, data = {}) {
    const closeTimeSec = data.exitTimeSec || data.currentSpotTimeSec || data.entryTimeSec || contract.visualEndTimeSec || Math.floor(Date.now() / 1000);
    contract.visualEndTimeSec = Math.max(contract.entryTimeSec || closeTimeSec, closeTimeSec);
    contract.isClosedVisual = true;
    contract.isSettled = data.isSettled ?? contract.isSettled ?? false;
    contract.outcome = data.outcome || contract.outcome || 'won';
    contract.color = _computeTradeColor(contract.direction, contract.entrySpot, contract.barrierPrice, data.currentSpot ?? currentSpot, true, contract.outcome);
    activeTradeContracts.set(contractKey, contract);
    _upsertEntryMarker(contractKey, contract.entryTimeSec, contract.entrySpot, contract.color);
    _syncMarkersToAllSlots();
    _scheduleContractCleanup(contractKey);
}

function drawTradeLines(tradeInfo) {
    const { entrySpot, entryTimeSec, barrierPrice, direction, duration, durationUnit, contractId, buyPrice, payout } = tradeInfo;
    const contractKey = String(contractId || Date.now());
    const durationSec = _durationToSec(duration, durationUnit);
    const tradeDirection = _inferDirection(entrySpot, barrierPrice, direction);
    const visualEndTimeSec = Number.isFinite(entryTimeSec) && Number.isFinite(durationSec)
        ? entryTimeSec + durationSec
        : entryTimeSec;
    const color = _computeTradeColor(tradeDirection, entrySpot, barrierPrice, currentSpot);

    _upsertEntryMarker(contractKey, entryTimeSec, entrySpot, color);
    _syncMarkersToAllSlots();

    activeTradeContracts.set(contractKey, {
        contractId: contractKey,
        barrierPrice,
        entrySpot,
        direction: tradeDirection,
        entryTimeSec,
        durationSec,
        visualEndTimeSec,
        expiryTimeSec: visualEndTimeSec,
        currentSpot: currentSpot,
        buyPrice,
        payout,
        color,
        outcome: 'pending',
        isClosedVisual: false,
        isSettled: false,
        touchedBarrier: false,
        cleanupTimer: null
    });

    if (activeTradeContracts.size > MAX_ACTIVE_CONTRACTS) {
        const oldest = activeTradeContracts.keys().next().value;
        _removeContractBarrier(oldest);
    }
    _refreshTradeOverlays();
}

function handleTradeSettlement(data) {
    handleContractUpdate({ ...data, isSettled: true });
}

function handleContractUpdate(data) {
    const contractKey = String(data.contractId);
    const existing = activeTradeContracts.get(contractKey) || { contractId: contractKey };
    const entrySpot = Number.isFinite(data.entrySpot) ? data.entrySpot : existing.entrySpot;
    const barrierPrice = Number.isFinite(data.barrier) ? data.barrier : existing.barrierPrice;
    const direction = data.direction || existing.direction || _inferDirection(entrySpot, barrierPrice, 'up');
    const entryTimeSec = Number.isFinite(data.entryTimeSec) ? data.entryTimeSec : existing.entryTimeSec;
    const expiryTimeSec = Number.isFinite(data.expiryTimeSec) ? data.expiryTimeSec : (existing.expiryTimeSec || existing.visualEndTimeSec || entryTimeSec);
    const currentSpotNow = Number.isFinite(data.currentSpot) ? data.currentSpot : currentSpot;

    const contract = {
        ...existing,
        barrierPrice,
        entrySpot,
        direction,
        entryTimeSec,
        expiryTimeSec,
        visualEndTimeSec: existing.isClosedVisual ? existing.visualEndTimeSec : (expiryTimeSec || existing.visualEndTimeSec || entryTimeSec),
        currentSpot: currentSpotNow,
        currentSpotTimeSec: data.currentSpotTimeSec || existing.currentSpotTimeSec || entryTimeSec,
        exitTimeSec: data.exitTimeSec || existing.exitTimeSec || null,
        buyPrice: Number.isFinite(data.buyPrice) ? data.buyPrice : existing.buyPrice,
        payout: Number.isFinite(data.payout) ? data.payout : existing.payout,
        outcome: data.outcome || existing.outcome || 'pending',
        isSettled: Boolean(data.isSettled || existing.isSettled),
        touchedBarrier: Boolean(data.touchedBarrier || existing.touchedBarrier),
        cleanupTimer: existing.cleanupTimer || null,
        isClosedVisual: Boolean(existing.isClosedVisual)
    };

    const isWinningTouch = Boolean(contract.touchedBarrier) || (Number.isFinite(contract.barrierPrice) && Number.isFinite(currentSpotNow)
        ? (contract.direction === 'up' ? currentSpotNow >= contract.barrierPrice : currentSpotNow <= contract.barrierPrice)
        : false);

    if (isWinningTouch || contract.isSettled) {
        _closeVisualTrade(contractKey, contract, {
            ...data,
            outcome: data.outcome || contract.outcome || (isWinningTouch ? 'won' : 'pending'),
            currentSpot: currentSpotNow,
            currentSpotTimeSec: data.currentSpotTimeSec || contract.currentSpotTimeSec,
            exitTimeSec: data.exitTimeSec || contract.exitTimeSec || data.currentSpotTimeSec || contract.currentSpotTimeSec,
            isSettled: data.isSettled || contract.isSettled || false
        });
        _refreshTradeOverlays();
        return;
    }

    contract.color = _computeTradeColor(contract.direction, contract.entrySpot, contract.barrierPrice, currentSpotNow, false, contract.outcome);
    activeTradeContracts.set(contractKey, contract);
    _upsertEntryMarker(contractKey, contract.entryTimeSec, contract.entrySpot, contract.color);
    _syncMarkersToAllSlots();
    _refreshTradeOverlays();
}

function updateActiveTradeColors() {
    if (activeTradeContracts.size === 0) return;
    let markersChanged = false;
    let overlaysChanged = false;

    for (const [contractKey, contract] of activeTradeContracts) {
        if (contract.isClosedVisual) continue;
        const expiredWithoutTouch = Number.isFinite(contract.expiryTimeSec)
            ? (window.lastKnownEpoch || Math.floor(Date.now() / 1000)) >= contract.expiryTimeSec
            : false;

        if (expiredWithoutTouch) {
            const expiryTimeSec = contract.expiryTimeSec || window.lastKnownEpoch || Math.floor(Date.now() / 1000);
            if (tradingPanel) {
                tradingPanel.handleMessage({
                    type: 'contract_update',
                    data: {
                        contractId: contractKey,
                        currentSpot,
                        currentSpotTimeSec: expiryTimeSec,
                        expiryTimeSec,
                        contractStatus: 'expired',
                        outcome: 'lost'
                    }
                });
            }
            _closeVisualTrade(contractKey, contract, {
                outcome: 'lost',
                currentSpot,
                currentSpotTimeSec: expiryTimeSec,
                exitTimeSec: expiryTimeSec
            });
            overlaysChanged = true;
            continue;
        }

        const locallyTouched = Number.isFinite(contract.barrierPrice) && Number.isFinite(currentSpot)
            ? (contract.direction === 'up' ? currentSpot >= contract.barrierPrice : currentSpot <= contract.barrierPrice)
            : false;

        if (locallyTouched) {
            const touchTimeSec = window.lastKnownEpoch || Math.floor(Date.now() / 1000);
            if (tradingPanel) {
                tradingPanel.handleMessage({
                    type: 'contract_update',
                    data: {
                        contractId: contractKey,
                        touchedBarrier: true,
                        currentSpot,
                        currentSpotTimeSec: touchTimeSec,
                        outcome: 'won',
                        profit: Number.isFinite(contract.payout) && Number.isFinite(contract.buyPrice)
                            ? contract.payout - contract.buyPrice
                            : undefined
                    }
                });
            }
            _closeVisualTrade(contractKey, contract, {
                outcome: 'won',
                currentSpot,
                currentSpotTimeSec: touchTimeSec,
                exitTimeSec: touchTimeSec
            });
            overlaysChanged = true;
            continue;
        }

        const newColor = _computeTradeColor(contract.direction, contract.entrySpot, contract.barrierPrice, currentSpot, false, contract.outcome);
        if (newColor !== contract.color) {
            contract.color = newColor;
            const marker = tradeEntryMarkers.find(m => m.id === `entry-${contractKey}`);
            if (marker) {
                marker.color = newColor;
                markersChanged = true;
            }
            overlaysChanged = true;
        }
    }

    if (markersChanged) _syncMarkersToAllSlots();
    if (overlaysChanged) _refreshTradeOverlays();
}

function clearAllTradeBarriers() {
    for (const contractKey of [...activeTradeContracts.keys()]) {
        _removeContractBarrier(contractKey);
    }
}

function _restoreTradeLines(slotKey, slot) {
    if (!slot?.series) return;
    slot.markersPlugin = LightweightCharts.createSeriesMarkers(slot.series, [], { autoScale: true });
    if (tradeEntryMarkers.length > 0) {
        try {
            const markers = _buildMarkersForSlot(slot);
            markers.sort((a, b) => a.time - b.time);
            slot.markersPlugin.setMarkers(markers);
        } catch (err) {
            console.warn(`[TradeViz] Failed to restore markers on ${slotKey}:`, err.message);
        }
    }
    if (slot.tradeOverlay) slot.tradeOverlay.onDataUpdated();
}

function _durationToMs(duration, unit) {
    switch (unit) {
        case 't': return duration * 2000;   // ~2s per tick
        case 's': return duration * 1000;
        case 'm': return duration * 60000;
        case 'h': return duration * 3600000;
        case 'd': return duration * 86400000;
        default: return duration * 60000;   // default to minutes
    }
}

function _durationToSec(duration, unit) {
    const ms = _durationToMs(duration, unit);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function setDirection(dir) {
    barrierDirection = dir;
    $('btnUp')?.classList.toggle('active', dir === 'up');
    $('btnDown')?.classList.toggle('active', dir === 'down');
    tradingPanel?.updateContractDisplay();
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

    // Validate mode is a safe CSS class fragment (alphanumeric/underscore only)
    const safeMode = typeof mode === 'string' && /^\w+$/.test(mode) ? mode : '';

    // Build table using DOM APIs to prevent XSS — no innerHTML with server-origin strings
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.textContent = 'Dist';
    headerRow.appendChild(th0);
    (Array.isArray(horizons) ? horizons : []).forEach(h => {
        const th = document.createElement('th');
        th.textContent = `${Number(h)}s`;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    (Array.isArray(distances) ? distances : []).forEach((d, rIdx) => {
        const distNum = Number(d);
        if (!Number.isFinite(distNum)) return;
        const tr = document.createElement('tr');
        const td0 = document.createElement('td');
        td0.className = 'distance-col';
        td0.textContent = distNum.toFixed(1);
        tr.appendChild(td0);
        (Array.isArray(horizons) ? horizons : []).forEach((h, cIdx) => {
            const cell = matrix?.[rIdx]?.[cIdx];
            const val = (cell && safeMode && typeof cell[safeMode] === 'number') ? cell[safeMode] : 0;
            const pctVal = Math.round(Math.max(0, Math.min(1, val)) * 100);
            const heat = Math.round(pctVal / 10) * 10;
            const td = document.createElement('td');
            td.className = `reach-cell bg-heat-${heat}`;
            td.textContent = `${pctVal}%`;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    table.replaceChildren(thead, tbody);
}
