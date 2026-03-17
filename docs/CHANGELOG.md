# Changelog

All notable changes to this project will be documented in this file.

---

## [1.2.0] - 2026-03-16

### Comprehensive Bug Audit & Fix

Two rounds of intensive auditing identified 22 issues across the terminal. 19 were fixed, 1 was
intentionally skipped (DrawingManager continuous RAF — documented in DECISIONS.md), and 2 were
verified as non-bugs after investigation.

### Fixed — First Audit Round

- **Overlay misalignment after fullscreen exit** (root cause 1): `findMainPaneCanvas()` in
  `ChartHelpers.js` now excludes the 4 overlay canvases (`timeblock-canvas`, `liqeq-canvas`,
  `trade-overlay-canvas`, `drawing-canvas`) from its search. Previously, after fullscreen exit,
  an overlay canvas could be the largest canvas during the resize transition, causing
  `_syncToPane()` to position overlays relative to themselves.

- **Overlay misalignment after fullscreen exit** (root cause 2): Created
  `resizeChartsAndOverlays()` centralized helper in `App.js` that handles both chart
  `applyOptions` (50ms delay) and overlay `requestRender` (150ms delay). Replaced all 4
  fullscreen toggle paths to use this helper instead of ad-hoc resize logic.

- **2m timeframe broken in grid panel init**: Added `'2m': 120` to the init-time `tfMap` in
  `ChartSlot` constructor so grid panels correctly compute `intervalSec` for 2m candles.

- **Grid countdown stuck on `--`**: `updateCountdowns()` now reads the grid panel's selected
  timeframe via `getGridTf()` to compute the correct interval instead of defaulting.

- **Grid resizer height not applied**: Added `height: el.clientHeight` to `chart.applyOptions()`
  in the grid resizer mouseup handler.

- **Duplicate `window.onerror` handlers**: `App.js` now captures the existing inline handler via
  `_prevOnError` and chains to it, ensuring both the visual error banner and the crash recorder
  fire without conflict.

- **CSS dead duplicate `.tab-bar` selector**: Removed copy-paste duplicate that was overriding
  intended styles.

- **CSS triple declarations for grid layout**: Consolidated `.grid-view.active`, `.grid-cell`,
  `.grid-resizer`, `.grid-header` into single authoritative declarations. Eliminated conflicting
  padding, flex, and gap values that relied on fragile cascade ordering.

- **Duration select dark mode contrast**: Increased border opacity from 6% to 15% in
  `trading.css` for visibility in dark mode.

- **Drawing toolbar dead CSS**: Removed dead declaration in `style.css` that was overridden
  immediately.

### Fixed — Second Audit Round

- **`rebuildGridPanel()` tfMap missing `'2m': 120`**: The grid panel TF switch path had its own
  `tfMap` copy that was missing the 2m entry. When a user switched a grid panel to 2m,
  `intervalSec` defaulted to 5 instead of 120, corrupting overlay snapping and DrawingManager
  interval.

- **`TradeOverlay._render()` missing `_syncToPane()`**: Unlike `TimeBlockOverlay` and
  `LiquidityEqOverlay`, `TradeOverlay` did not re-measure the LWC canvas geometry on each render.
  After fullscreen exit or grid resizer drag, trade barrier lines rendered at stale coordinates.
  Now calls `_syncToPane()` at the start of `_render()` to match the other overlays.

- **Grid resizer mouseup missing overlay re-sync**: The mouseup handler only called
  `chart.applyOptions()` without triggering overlay re-sync. Replaced with
  `resizeChartsAndOverlays(['gridL', 'gridR'])` to handle both chart and overlay updates.

- **`normalizeTf()` missing `'2m'` case**: Added `if (s.match(/^2m/) || s.includes('2 min'))`
  to the normalizer. Previously worked by accident (fell through to `return s`), but would
  break on inputs like `'2 min'`.

- **CSS `var(--text-muted)` undefined**: `.panel-content` used `var(--text-muted)` which was
  never defined. Changed to `var(--muted)` (used consistently in 30+ other places).

- **CSS truncated class `.panel-content-inden`**: Dead rule with a typo in the class name.
  Matched nothing in the DOM. Removed.

### Skipped (Intentional)

- **DrawingManager continuous RAF loop**: Has no pan/zoom subscriptions. Adding a dirty flag
  without also adding `subscribeVisibleLogicalRangeChange` would freeze drawings during chart
  interaction. Documented in DECISIONS.md as intentional architecture.

### Verified Non-Bugs

- **Stale `getData` after TF switch**: The `getData` closure in `ChartSlot.init()` references
  `slot.data` (a live array), not a snapshot. When data updates, the overlay reads the current
  data correctly.

- **Stale drawing canvas after TF switch**: `DrawingManager` receives the new series reference
  via `rebuildGridPanel()` and re-renders correctly.

### Cache Bust

- `style.css` bumped to `?v=19`
- `trading.css` bumped to `?v=11`
- `App.js` bumped to `?v=55`

### Documentation

- Added `STATUS.md` — current working state truth document with verified behaviors and fix history
- Updated `README.md` — professional documentation with architecture diagram, feature matrix,
  project structure, and documentation map
- Updated `ARCHITECTURE.md` — current file versions and component descriptions
- Updated `DECISIONS.md` — new entries for all non-obvious architectural choices

---

## [1.1.0] - 2026-03-16

### Changed

- **Terminal Shell Restructure (Cipher)**: Replaced the legacy left-sidebar-first shell with a
  top bar + left tool rail + dominant chart canvas + right trading sidebar layout.
- **Trading Surface Placement**: Moved direction, barrier mode, barrier/payout controls, and
  `TradingPanel` mount into the right sidebar.
- **Flyout Panels**: Migrated Health, Advanced Metrics, Research, and Reach Grid Config into
  chart-overlay flyouts triggered from the left rail.
- **Theme-Aware Overlays**: Updated `TimeBlockOverlay` and `LiquidityEqOverlay` controls and
  draw styles for dark/light mode readability.

### Fixed

- **Duplicate trades in history**: `_mergeTradeUpdate()` `else` branch created new entries when
  `contract_update` arrived before `trade_result`. Removed the `else` branch.
- **Status stuck PENDING**: Outcome downgrade guard prevents `pending` from overwriting `won/lost`.
- **Long contract IDs overflow UI**: Truncated to `#...{last6}`.
- **Negative profit during PENDING**: Shows "settling" instead of misleading negative numbers.
- **Split/Fullscreen Stability**: Resolved CSS collision between legacy and new layout rules.
- **Grid Fullscreen Behavior**: Chart area occupies full shell width in fullscreen.
- **Toolbar Visibility in Split Fullscreen**: Removed conflicting rule that hid drawing toolbar.
- **Fullscreen Button Sync**: Synchronized split-pane and view header fullscreen icon states.

### Verified

- Regression tests: 4 suites / 20 tests passing (`npm test`).
- DOM hook audit: No missing ID references between JS selectors and declared HTML/template IDs.

---

## [1.0.0] - 2026-03-05

### Added

- **Modular Architecture**: Complete refactor into ES6 modules (`core`, `drawing`, `overlays`,
  `engines`, `utils`).
- **VIEW Mode Logic**: Backtesting with scroll-back, automatic `LIVE`/`VIEW` badge switching.
- **TimeBlock Overlays**: 5m and 15m block visualization with quadrant stripes.
- **Liquidity/Equilibrium Levels**: Multi-timeframe H/L/Mid50 with cluster merging.
- **Drawing Toolbar**: Rectangle, trendline, horizontal ray, text overlays.
- **Sidebar Analytics**: Volatility meters, edge/probability calculations, tick counter.
- **Multi-Pane View**: Split-screen for comparing timeframes side-by-side.
- **Theme Toggle**: Dark/light mode support.

### Fixed

- Chart coordinate desync by syncing overlays to series data source of truth.
- Reference errors after modularization.
- Tick count and UI update failures in split-pane views.

### Security

- Explicit `.env` management and secret redaction.
