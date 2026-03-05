# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-03-05

### Added

- **Modular Architecture**: Complete refactor of the monolithic client-side logic into ES6 modules (`core`, `drawing`, `overlays`, `engines`, `utils`).
- **VIEW Mode Logic**: Enhanced backtesting system with manual scroll-back, automatic `LIVE`/`VIEW` badge switching, and right-context padding.
- **Improved Anchoring**: Implementation of `focusT` logic for level selection in `VIEW` mode (5m uses 2-block offset, 15m uses 1-block offset).
- **TimeBlock Overlays**: Visualization of 5m and 15m blocks with quadrant stripes.
- **Liquidity/Equilibrium Levels**: Multi-timeframe level tracking (H/L/Mid50) with cluster merging logic.
- **Drawing Toolbar**: Functional tools for Rectangle, Trendline, Horizontal Ray, and Text overlays.
- **Sidebar Analytics**: Volatility rolling meters, Edge/Probability calculations, and real-time tick counter.
- **Multi-Pane View**: Split-screen support for multiple timeframes with independent toggle controls.
- **Theme Toggle**: Support for Dark/Light mode.

### Fixed

- Chart coordinate desync issues by syncing overlays to the series data source of truth.
- Reference errors after modularization.
- Tick count and UI update failures in split-pane views.

### Security

- Explicit `.env` management and secret redaction.
