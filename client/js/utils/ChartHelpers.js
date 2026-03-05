/* ================================================================
   CHART HELPERS & UI UTILS
   ================================================================ */

export const $ = id => document.getElementById(id);
export function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
export function setStyle(id, p, v) { const e = $(id); if (e) e.style[p] = v; }

export let lastPrice = 0;
export function setLastPrice(v) { lastPrice = v; }
export let currentSymbol = null;
export function setCurrentSymbol(v) { currentSymbol = v; }

// ── Chart Theme ───────────────────────────────────────────────────
export const THEME = {
    layout: { background: { color: 'transparent' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
    crosshair: { mode: 0 },   // 0 = Normal (allows free pan/scroll)
    timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#30363d', rightOffset: 5 },
    rightPriceScale: { borderColor: '#30363d' }
};
export const CANDLE_OPTS = { upColor: '#3fb950', downColor: '#f85149', borderVisible: false, wickUpColor: '#3fb950', wickDownColor: '#f85149' };

export function pct(v) { return (v * 100).toFixed(1) + '%'; }

// ---------- Time extraction (seconds) ----------
export function getPointTimeSec(d) {
    if (!d) return null;
    const raw = d.time ?? d.timestamp ?? null;
    if (raw == null) return null;
    return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
}

// ---------- Price extraction (supports candles + ticks/line) ----------
export function getPointHighLow(d) {
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
export function lowerBoundTime(data, targetTimeSec) {
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
export function findMainPaneCanvas(plotEl) {
    const canvases = plotEl.querySelectorAll('canvas');
    if (!canvases.length) return null;
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
 */
export function boundaryTimeToX_edge(timeScale, data, boundaryTimeSec) {
    const n = data.length;
    if (n < 2) return null;
    const idx = lowerBoundTime(data, boundaryTimeSec);
    if (typeof timeScale.logicalToCoordinate === 'function') {
        const xHalf = timeScale.logicalToCoordinate(idx - 0.5);
        if (xHalf != null && !Number.isNaN(xHalf) && xHalf !== 0) return xHalf;
    }
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