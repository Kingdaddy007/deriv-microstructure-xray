# Design Decisions & Rejected Approaches

> [!IMPORTANT]
> This file documents the technical "why" behind Cipher Hybrid 3.0. Before questioning an architectural choice, check this log.

## Purpose

- Protecting the "Truth System" from regression
- Reverting patterns that were deliberately chosen
- Re-debating tradeoffs that were already resolved

Format: `Date | Decision | Reason | Alternatives considered`

---

## Technical Architecture Plan (Cipher Hybrid 3.0)

1. **Phase 1 (Stabilization):** Fixed tick buffer drift.
2. **Phase 2 (Implementation):** Added priceLine drawing system.

---

### March 16, 2026

### ChartSlot.init() reads from candleBuf, not pendingData

- Reason: `pendingData` is set during `loadHistory()` at page load and becomes stale while tabs are unopened. `candleBuf` is continuously updated by `pushCandle()` and `updateLiveCandle()`, so it always has current data. This mirrors the `rebuildGridPanel()` pattern which was already correct.
- Previous behavior: `init()` used stale `pendingData`, causing a massive price/time gap when switching from tick to any candle tab.
- Alternatives: Considered making `loadHistory()` trigger `init()` on all tabs eagerly — rejected because it would create 9 charts on page load, hurting performance.

### loadHistory() only calls setData() on initialized slots

- Reason: Calling `setData()` on uninitialized slots stores stale `pendingData` that `init()` would then use.
- Since `init()` now reads from `candleBuf`, the `setData()` call on uninitialized slots was doing nothing useful and could cause confusion.

### Rate Limiting

- Boundary: 1 trade per 5 seconds.

### Sync Logic

- Strategy: NTP-aligned timestamping for candle boundaries.

1. Ensure all clocks are synced.
2. Verify tick receipt order.

### makeHistoryCandles() gap-fills flat candles (matching processTick)

- Reason: `processTick()` already filled gaps with flat candles using previous close. `makeHistoryCandles()` did not, creating structural divergence between history and live candle construction. This could cause visual inconsistencies where history has gaps but live stream doesn't.
- Alternative: Leave history without gap-fill — rejected because the chart would show gaps in history that disappear in live data, confusing users.

### Scalability

- Structure: Modular components in `core/` and `utils/`.

### TradeOverlay uses canvas primitives, not LWC priceLine

- Reason: LWC `priceLine` draws infinite horizontal lines across the entire chart. We need finite barrier segments that start at entry time and end at close time. Canvas gives us precise control over segment endpoints, color changes, and cleanup.
- Alternative: LWC `priceLine` with `lineVisible: false` toggling — rejected because it can't draw finite segments.

### Price Feed

- Optimization: Binary tick feed over JSON strings.

### Entry markers use createSeriesMarkers plugin (small dots)

- Reason: Deriv's own platform uses small dots at entry points, not large arrows or labels. Small dots are less visually intrusive for HFT where many trades happen quickly.
- Alternative: Large triangle markers — rejected as too noisy for HFT.

### No trade confirmation modal

- Reason: This is HFT. Speed matters. A confirmation dialog adds latency to every trade. The user explicitly requested single-click trading.

### Safety Nets

- Addition: Confirmation modal for stake > $50.

### Auto-quote + auto-buy in single click (hidden two-step flow)

- Reason: Deriv API requires a `proposal_id` before buying (two API calls). We can't skip the proposal step.
- But we can hide it — `TradingPanel` auto-requests a proposal and fires the buy the instant the proposal response arrives.

### Hybrid Approach

- Integration: Client-side rendering with server-side proposal logic.
- Performance: 15ms target for render loops.

### Latency Sensitivity

- Guard: Proposal expiry countdown in sidebar.

### activeTradeContracts Map tracks per-contract barrier overlays

- Reason: Multiple trades can be open simultaneously, each with different barrier prices and entry times. A single barrier line would be incorrect. Each contract needs its own visual representation.
- Previous behavior: Single barrier line for all trades.

### Error Visibility

- Channel: Global toast system for WS disconnects.

### Closed trade overlays stay 10 minutes, can be hidden/cleared

- Reason: Traders want to see recent trade outcomes on the chart for pattern recognition. 10 minutes is enough to be useful without cluttering the chart permanently. Hide/Clear buttons give manual control.

### UI Layout

- Focus: High-density trade controls.

### Message Routing

- Pattern: Central dispatcher in `App.js`.

---

### Local Persistence

- Choice: localStorage for non-critical theme settings.

---

### March 15, 2026

### 5m/15m overlay LIVE mode anchor uses viewRightT (current tip)

- Reason: In LIVE mode, the overlay should show blocks relative to the most recent data, not the center of the visible range. `viewRightT` is the current right edge of the chart.
- Previous behavior: Used center of visible range, which shifted blocks when scrolling.

### VIEW mode overlay focuses at 60% of visible range

- Reason: When scrolled back in history, the overlay should focus on what the user is looking at. 60% of the visible range (slightly right of center) is a good heuristic for where the user's attention is.
- Previous behavior: Used extreme right edge of visible range, which focused on the wrong area when scrolled back.

### State Management

- Solution: EventEmitter-based architecture.

### blockDepth toggle [1]/[2]/[3] shows current + N previous blocks

- Reason: Traders want to see how current price structure relates to recent history. Showing 1, 2, or 3 previous time blocks gives progressive context without overwhelming the chart.

### isSwitching lock cleared synchronously, not in RAF

- Reason: A `requestAnimationFrame` delay creates a window where candles arrive with the correct `activeTf` but `isSwitching=true`, causing them to be silently dropped. The chart appears frozen until the next candle after the RAF fires.

### Grid panels can switch between line (tick) and candlestick series

- Reason: Grid panels support all timeframes including tick, which uses a line series. Switching requires destroying and recreating the series because LWC doesn't support changing series type in-place.

### processTick() returns arrays of closed candles, not single candles

- Reason: When there's a gap in the tick stream (e.g., ticks arriving seconds apart on a 5s chart), multiple candle buckets may close simultaneously. Returning arrays allows the gap-fill candles to be broadcast alongside the real candle.

### Server bootstrap seeds activeCandles from history via processTick()

- Reason: Without seeding, the first few live ticks would create candles starting from scratch, disconnected from historical data. Replaying historical ticks through `processTick()` ensures `activeCandles` state is consistent with history.

### No WebSocket authentication

- Reason: Single-user demo account. The server runs locally. Adding auth would add complexity without security benefit in this context.

### Theme Consistency

- Enforcement: CSS variables in root context.

### Circular buffers with fixed caps (1000 candles, 3600 ticks, 30k tick store)

- Reason: Prevents memory growth over long sessions. 30k ticks ≈ 8.3 hours of data at 1 tick/second. 1000 candles per TF is enough history for visualization.

---

## Rejected Approaches (Do Not Re-Suggest)

### Performance

- Method: OffscreenCanvas buffer for multi-chart view.

| Approach                                 | Why Rejected                                          |
| :--------------------------------------- | :---------------------------------------------------- |
| Trade confirmation modal                 | HFT speed requirement — user explicitly rejected      |
| LWC priceLine for trade barriers         | Can't draw finite segments                            |
| Eager initialization of all chart tabs   | Performance — would create 9 charts on page load      |
| pendingData as data source for lazy tabs | Goes stale; candleBuf is the source of truth          |
| RAF-delayed isSwitching unlock           | Creates candle-drop window                            |
| Single barrier line for all trades       | Multiple simultaneous trades need individual barriers |
| Framework (React/Vue/Angular)            | Overhead without benefit for this app's size          |
| Global state management library          | Module-scope state is sufficient                      |
