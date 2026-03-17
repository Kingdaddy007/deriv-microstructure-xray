# Cipher Trading Terminal — Current Status

**Last verified:** 2026-03-16
**Verified by:** Anti-Gravity + OpenCode dual audit
**Terminal version:** 1.2.0 (post-audit)
**Overall state:** Functional. All identified bugs fixed. Ready for live trading sessions on demo account.

---

## Purpose of This Document

This is the **truth document.** When something breaks and you need to know what "working" looks like, this file is the reference. It records:

1. What is currently functional and verified
2. What the correct behavior looks like for each component
3. What was broken, what was fixed, and why
4. File versions and line numbers for critical code paths

If a future change causes a regression, compare the current behavior against this document to identify what diverged.

---

## Verified Working Behaviors

### Data Pipeline

| Behavior | Status | Notes |
|----------|--------|-------|
| Deriv WS connection + auth | Working | `derivClient.js` handles reconnection with exponential backoff |
| Tick stream ingestion | Working | Ticks stored in `tickStore.js` (30k circular buffer) |
| Candle aggregation (7 TFs) | Working | 5s, 10s, 15s, 30s, 1m, 2m, 5m via `candleAggregator.js` |
| Gap-fill with flat candles | Working | Both `processTick()` and `makeHistoryCandles()` gap-fill consistently |
| History load on connect | Working | `loadHistory()` populates `candleBuf` for all TFs |
| WS broadcast to clients | Working | `index.js` broadcasts tick, candle_closed, candle_update, countdown |

### Chart Rendering

| Behavior | Status | Notes |
|----------|--------|-------|
| Lazy chart initialization | Working | Charts created on first tab visit, read from `candleBuf` (not stale `pendingData`) |
| Tab switching | Working | `activateTab()` inits chart if needed, then resizes |
| Fullscreen toggle (single view) | Working | `resizeChartsAndOverlays()` handles chart + overlay re-sync |
| Fullscreen toggle (split view) | Working | Both `pane-expand-btn` buttons toggle together |
| Exit fullscreen button | Working | Resets all fullscreen states, triggers overlay re-sync |
| Grid panel TF switching | Working | `rebuildGridPanel()` destroys/recreates series correctly |
| Grid resizer drag | Working | `resizeChartsAndOverlays(['gridL', 'gridR'])` syncs charts + overlays |
| Dark/light mode toggle | Working | Theme applied to charts, overlays, and all UI elements |
| Live countdowns | Working | `updateCountdowns()` reads grid panel TF via `getGridTf()` |
| 2m timeframe support | Working | Added to `normalizeTf()`, init tfMap, `rebuildGridPanel()` tfMap, `loadHistory()` map |

### Overlay System

| Behavior | Status | Notes |
|----------|--------|-------|
| `findMainPaneCanvas()` accuracy | Working | Excludes all 4 overlay canvas classes from search |
| TimeBlockOverlay `_syncToPane()` on every render | Working | Line 371 of `TimeBlockOverlay.js` |
| LiquidityEqOverlay `_syncToPane()` on every render | Working | Line 395 of `LiquidityEqOverlay.js` |
| TradeOverlay `_syncToPane()` on every render | Working | Added during audit — matches other overlays |
| Overlay alignment after fullscreen exit | Working | `resizeChartsAndOverlays()` handles 50ms chart resize + 150ms overlay re-sync |
| Overlay alignment after grid resizer drag | Working | Now uses `resizeChartsAndOverlays()` instead of manual `applyOptions` |
| ResizeObserver re-sync | Working | All overlays observe `slotContainerEl` for size changes |
| `subscribeSizeChange` re-sync | Working | All overlays subscribe to LWC's internal size change callback |

### Trading System

| Behavior | Status | Notes |
|----------|--------|-------|
| Single-click trade execution | Working | Auto-quote + auto-buy, no confirmation modal |
| Trade result handling | Working | `_mergeTradeUpdate()` correctly handles race conditions |
| No duplicate trades | Working | Removed `else` branch that created duplicates |
| Status not stuck PENDING | Working | Outcome downgrade guard prevents `pending` overwriting `won/lost` |
| Contract ID display | Working | Truncated to `#...{last6}` for readability |
| Negative profit during PENDING | Working | Shows "settling" instead of misleading negative number |
| Trade barrier overlay | Working | Finite segments with entry/exit markers, color updates in real-time |
| Closed trade cleanup | Working | 10-minute retention, hide/clear buttons functional |

### CSS/Layout

| Behavior | Status | Notes |
|----------|--------|-------|
| `.panel-content` color | Working | Uses `var(--muted)` (was broken: `var(--text-muted)` undefined) |
| Grid layout (split view) | Working | CSS consolidated — no conflicting triple declarations |
| Tab bar styling | Working | Removed dead duplicate `.tab-bar` selector |
| Duration select dark mode | Working | Border opacity increased from 6% to 15% |
| Drawing toolbar | Working | Dead CSS declaration removed |
| Dead `.panel-content-inden` rule | Removed | Truncated class name matched nothing in DOM |

---

## Critical Code Paths (with line numbers)

These are the functions that matter most. If something breaks, check these first.

**Note:** Line numbers are approximate and may shift by a few lines after edits. Use function names to search.

### App.js (client/js/core/App.js)

| Function/Section | ~Line | What It Does |
|-----------------|-------|--------------|
| `normalizeTf()` | 80 | Normalizes TF strings (tick, 5s, 10s, 15s, 30s, 1m, 2m, 5m) |
| `ChartSlot` class | 130 | Chart lifecycle: init, setData, update, destroy |
| `ChartSlot.init()` | 170 | Lazy chart creation, reads from `candleBuf`, creates overlays |
| Grid init tfMap | 216 | `{ tick:1, 5s:5, 10s:10, 15s:15, 30s:30, 1m:60, 2m:120, 5m:300 }` |
| `const slots` | 328 | All 9 chart slots (tick, 5s-5m, gridL, gridR) |
| `resizeChartsAndOverlays()` | 417 | Central resize handler: 50ms chart + 150ms overlay re-sync |
| `activateTab()` | 440 | Tab switching with lazy init |
| Fullscreen handlers | 482-537 | Three fullscreen paths, all use `resizeChartsAndOverlays()` |
| Grid resizer | 590-605 | Mouse drag resize, calls `resizeChartsAndOverlays(['gridL','gridR'])` |
| `rebuildGridPanel()` | 616 | Series destroy/recreate for TF switch |
| `rebuildGridPanel()` tfMap | 651 | Must match init tfMap (including 2m:120) |
| `updateCountdowns()` | 713 | Reads grid TF via `getGridTf()` for correct interval |
| `pushCandle()` | 930 | Writes to candleBuf + routes to grid panels |
| `loadHistory()` | 962 | History map includes `'2m': 'historicalC2m'` |
| `handleContractUpdate()` | 1187 | Live trade color updates |

### ChartHelpers.js (client/js/utils/ChartHelpers.js)

| Function | ~Line | What It Does |
|----------|-------|--------------|
| `findMainPaneCanvas()` | 45 | Finds LWC's internal canvas, excluding overlay canvases |

### TradingPanel.js (client/js/trading/TradingPanel.js)

| Function | ~Line | What It Does |
|----------|-------|--------------|
| `_mergeTradeUpdate()` | 370 | Handles race condition: no duplicate creation, no outcome downgrade |
| `_renderHistory()` | 430 | Trade history display with truncated IDs, "settling" for pending |

### TradeOverlay.js (client/js/overlays/TradeOverlay.js)

| Function | ~Line | What It Does |
|----------|-------|--------------|
| `_render()` | 119 | Calls `_syncToPane()` then draws barrier lines + flags |
| `_syncToPane()` | 61 | Measures LWC canvas position relative to container |

---

## File Versions (Cache Bust)

| File | Version | Updated |
|------|---------|---------|
| `style.css` | `?v=19` | 2026-03-16 |
| `trading.css` | `?v=11` | 2026-03-16 |
| `App.js` | `?v=55` | 2026-03-16 |

After modifying any client file, bump the version in `index.html` or the browser will serve stale content.

---

## Complete Bug Fix History

### Session 1 (prior session)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Duplicate trades in history | `_mergeTradeUpdate()` `else` branch created new entries when contract_update arrived before trade_result | Removed the `else` branch |
| Status stuck PENDING | Server's `contract_update` with `outcome:'pending'` overwrote locally-detected `outcome:'won'` | Added outcome downgrade guard |
| Long contract IDs overflow UI | Full Deriv contract IDs too wide for history panel | Truncated to `#...{last6}` |
| Negative profit during PENDING | P&L displayed before settlement complete | Shows "settling" for pending contracts |

### Session 2 — First Audit (16 issues found, 13 fixed, 1 skipped, 2 non-bugs)

| # | Bug | Fix | File |
|---|-----|-----|------|
| 1 | 2m timeframe broken in grid init | Added `'2m': 120` to init tfMap | `App.js` |
| 2 | Grid countdown shows `--` for grid panels | `updateCountdowns()` reads grid TF via `getGridTf()` | `App.js` |
| 3 | Dead duplicate `.tab-bar` CSS selector | Removed duplicate | `style.css` |
| 4 | Grid resizer doesn't update chart height | Added `height` to `applyOptions` | `App.js` |
| 5 | Overlay misaligns after fullscreen exit (TWO root causes) | (a) `findMainPaneCanvas()` excludes overlay canvases (b) Created `resizeChartsAndOverlays()` helper, replaced all fullscreen paths | `ChartHelpers.js`, `App.js` |
| 6 | Duplicate `window.onerror` handlers | Chains via `_prevOnError` | `App.js` |
| 7 | Drawing toolbar dead CSS | Removed dead declaration | `style.css` |
| 8 | Stale drawing canvas after TF switch | Verified non-issue (DrawingManager gets new series ref) | None |
| 9 | Duration select dark mode contrast | Border opacity 6% to 15% | `trading.css` |
| 10 | Stale `getData` after TF switch | Verified non-bug (closure reads live data) | None |
| 11-12 | CSS triple declarations (grid layout) | Consolidated into single declarations | `style.css` |
| 13 | DrawingManager continuous RAF | **Skipped** — intentional per DECISIONS.md | None |

### Session 2 — Second Audit (6 issues found, 6 fixed)

| # | Bug | Fix | File |
|---|-----|-----|------|
| 1 | `rebuildGridPanel()` tfMap missing `'2m': 120` | Added `'2m': 120` to rebuild tfMap | `App.js` |
| 2 | `TradeOverlay._render()` doesn't call `_syncToPane()` | Added `_syncToPane()` at start of `_render()` | `TradeOverlay.js` |
| 3 | Grid resizer mouseup doesn't trigger overlay re-sync | Replaced manual `applyOptions` with `resizeChartsAndOverlays()` | `App.js` |
| 4 | `normalizeTf()` missing `'2m'` case | Added `if (s.match(/^2m/) ...)` | `App.js` |
| 5 | `var(--text-muted)` undefined CSS variable | Changed to `var(--muted)` | `style.css` |
| 6 | Truncated class `.panel-content-inden` dead code | Removed dead rule | `style.css` |

---

## What "Working" Looks Like

When the terminal is functioning correctly:

1. **On load:** Tick chart initializes immediately. Other tabs lazy-init on first visit.
2. **Tab switching:** Chart appears with current data from `candleBuf`. No stale data, no gaps.
3. **Grid panels:** Both panels render independently. TF dropdown changes correctly rebuild the series.
4. **Grid resizer:** Dragging resizes both panels smoothly. Overlays re-align automatically.
5. **Fullscreen:** Any view can go fullscreen. Exiting fullscreen restores all views and overlays.
6. **Overlays:** Time blocks, liquidity levels, and trade barriers align precisely with the chart canvas.
7. **Trading:** Click TRADE, barrier line appears, color updates live, outcome logged correctly.
8. **Countdowns:** Each tab shows time remaining until next candle close. Grid panels show correct countdown for their selected TF.
9. **Dark/light mode:** Toggle switches everything cleanly. No broken colors or invisible text.
10. **2m timeframe:** Works in grid panels — correct interval snapping, correct countdown, correct history load.

If any of these behaviors deviate, compare against the fix history above to identify the regression.
