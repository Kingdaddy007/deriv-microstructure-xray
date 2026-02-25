/* ================================================================
   Micro-Structure X-Ray — app.js (v3 Clean Rebuild)
   Fixes applied:
   1. Neutral language — no TRADE/WAIT, just raw probability data
   2. Auto-resize charts via ResizeObserver (TradingView behaviour)
   3. Proper 10s candle handling
   4. Safe setText/setStyle helpers — no more null.textContent crashes
   ================================================================ */

'use strict';

// ── Safe DOM helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}
function setStyle(id, prop, value) {
    const el = $(id);
    if (el) el.style[prop] = value;
}

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

const candleColors = {
    upColor: '#3fb950', downColor: '#f85149', borderVisible: false,
    wickUpColor: '#3fb950', wickDownColor: '#f85149'
};

// ── Auto-Resize Chart Factory ─────────────────────────────────────
// Creates a chart that fills its container and stays full-size on window resize.
function createResizableChart(containerId, options = {}) {
    const container = $(containerId);
    if (!container) return null;

    const chart = LightweightCharts.createChart(container, {
        ...chartTheme,
        ...options,
        width: container.clientWidth,
        height: container.clientHeight,
    });

    const ro = new ResizeObserver(() => {
        chart.applyOptions({
            width: container.clientWidth,
            height: container.clientHeight,
        });
        chart.timeScale().fitContent();
    });
    ro.observe(container);

    return chart;
}

// ── Initialise All Charts ─────────────────────────────────────────
// Tick line
const tickChartObj = createResizableChart('tickChart');
const tickSeries = tickChartObj?.addSeries(LightweightCharts.LineSeries, {
    color: '#58a6ff', lineWidth: 2, priceLineVisible: true, lastValueVisible: true
});

// 5s candles
const chart5sObj = createResizableChart('chart5s');
const candle5sSeries = chart5sObj?.addSeries(LightweightCharts.CandlestickSeries, candleColors);

// 10s candles
const chart10sObj = createResizableChart('chart10s');
const candle10sSeries = chart10sObj?.addSeries(LightweightCharts.CandlestickSeries, candleColors);

// 15s candles
const chart15sObj = createResizableChart('chart15s');
const candle15sSeries = chart15sObj?.addSeries(LightweightCharts.CandlestickSeries, candleColors);

// Grid: 5s grid cell
const gridChart5Obj = createResizableChart('gridChart5');
const gridCandle5Series = gridChart5Obj?.addSeries(LightweightCharts.CandlestickSeries, candleColors);

// Grid: 15s grid cell
const gridChart15Obj = createResizableChart('gridChart15');
const gridCandle15Series = gridChart15Obj?.addSeries(LightweightCharts.CandlestickSeries, candleColors);

// ── Tab Switching ─────────────────────────────────────────────────
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.chart-view');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.view;
        tabs.forEach(t => t.classList.remove('active'));
        views.forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        const targetView = $(target);
        if (targetView) targetView.classList.add('active');
        // Force a resize pass so newly visible charts fill their containers
        window.dispatchEvent(new Event('resize'));
    });
});

// ── WebSocket ─────────────────────────────────────────────────────
const ws = new WebSocket(`ws://${location.host}`);

ws.onopen = () => { setText('symbolBadge', 'CONNECTED'); };
ws.onclose = () => { setText('symbolBadge', 'DISCONNECTED'); setTimeout(() => location.reload(), 3000); };
ws.onerror = () => { setText('symbolBadge', 'ERROR'); };

ws.onmessage = (event) => {
    try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
            case 'symbol': setText('symbolBadge', msg.data); break;
            case 'config': applyConfig(msg.data); break;
            case 'history': {
                const h = msg.data;
                if (h.historicalTicks?.length) tickSeries?.setData(h.historicalTicks);
                if (h.historicalC5s?.length) { candle5sSeries?.setData(h.historicalC5s); gridCandle5Series?.setData(h.historicalC5s); }
                if (h.historicalC10s?.length) candle10sSeries?.setData(h.historicalC10s);
                if (h.historicalC15s?.length) { candle15sSeries?.setData(h.historicalC15s); gridCandle15Series?.setData(h.historicalC15s); }
                [tickChartObj, chart5sObj, chart10sObj, chart15sObj, gridChart5Obj, gridChart15Obj]
                    .forEach(c => c?.timeScale().scrollToRealTime());
                break;
            }
            case 'tick': tickSeries?.update(msg.data); break;
            case 'candle5s': candle5sSeries?.update(msg.data); gridCandle5Series?.update(msg.data); break;
            case 'candle10s': candle10sSeries?.update(msg.data); break;
            case 'candle15s': candle15sSeries?.update(msg.data); gridCandle15Series?.update(msg.data); break;
            case 'analytics': handleAnalytics(msg.data); break;
        }
    } catch (e) { console.error('[WS parse error]', e); }
};

// ── Config ────────────────────────────────────────────────────────
function applyConfig(cfg) {
    const barrierEl = $('barrierInput');
    const roiEl = $('roiInput');
    if (barrierEl) barrierEl.value = cfg.barrier;
    if (roiEl) roiEl.value = cfg.payoutROI;
    if (cfg.direction) setDirection(cfg.direction);
}

// ── Analytics Display ─────────────────────────────────────────────
function handleAnalytics(d) {
    const a = d.active;

    // Price
    const priceColor = d.price > lastPrice ? '#3fb950' : d.price < lastPrice ? '#f85149' : '#c9d1d9';
    setText('currentPrice', d.price.toFixed(2));
    setStyle('currentPrice', 'color', priceColor);
    lastPrice = d.price;
    setText('tickCounter', `${d.tickCount} ticks`);

    // Warmup pill
    const warmupEl = $('warmupBadge');
    if (warmupEl) {
        if (d.warmupDone) {
            warmupEl.style.display = 'none';
        } else {
            warmupEl.style.display = 'inline-block';
            warmupEl.textContent = `Warming up ${d.tickCount}/300`;
        }
    }

    // Probabilities — neutral labels only
    setText('theoProb', a.theoretical != null ? pct(a.theoretical) : 'N/A');
    setText('empProb', a.empirical != null ? pct(a.empirical) : 'N/A');
    setText('ourProb', pct(a.ourProb));
    setText('derivProb', pct(a.impliedProb));
    setText('sampleSize', a.sampleSize > 0 ? a.sampleSize.toLocaleString() : '--');

    // Difference (edge) — number only, no directive
    const edgePct = a.edge * 100;
    const edgeStr = (edgePct >= 0 ? '+' : '') + edgePct.toFixed(1) + '%';
    setText('edgeNumber', edgeStr);
    setStyle('edgeNumber', 'color', edgePct >= 0 ? '#3fb950' : '#f85149');

    // Warnings — neutral context
    const warnEl = $('warningsList');
    if (warnEl) {
        if (a.warnings.length === 0) {
            warnEl.innerHTML = '<span class="no-warnings">No active warnings</span>';
        } else {
            warnEl.innerHTML = a.warnings.map(w => `<div class="warning-item">${w}</div>`).join('');
        }
    }

    // Volatility bars
    const vol = d.volatility;
    const baseVal = vol.rollingVol[300] || vol.rollingVol[60] || 0.0001;
    for (const w of [10, 30, 60]) {
        const v = vol.rollingVol[w];
        const bar = $('bar' + w);
        if (bar && v != null) {
            const pctFill = Math.min((v / (baseVal * 2)) * 100, 100);
            bar.style.width = pctFill + '%';
            bar.className = 'bar-fill' + (v > baseVal * 1.2 ? ' hot' : v < baseVal * 0.8 ? ' cold' : '');
        }
    }

    setText('volRatio', vol.volRatio != null ? vol.volRatio.toFixed(2) + ' · ' + vol.volRatioLabel : '--');
    const trendChar = vol.volTrend === 'EXPANDING' ? '↑' : vol.volTrend === 'CONTRACTING' ? '↓' : '→';
    setText('volTrend', `${trendChar} ${vol.volTrend}`);
    const momChar = vol.momentum?.direction === 'UP' ? '↑' : vol.momentum?.direction === 'DOWN' ? '↓' : '→';
    setText('momentum', `${momChar} ${vol.momentum?.direction ?? '--'}`);
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
