# Cipher Trading Terminal

A low-latency synthetic index trading visualization system built for Deriv. Designed for speed-critical touch/no-touch contract execution with real-time microstructure analysis, multi-timeframe overlays, and single-click HFT trading.

---

## Table of Contents

- [What This Is](#what-this-is)
- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [How It Works](#how-it-works)
- [Documentation Map](#documentation-map)
- [Testing](#testing)
- [Cache Busting](#cache-busting)
- [Known Constraints](#known-constraints)

---

## What This Is

Cipher is a purpose-built trading terminal for executing touch/no-touch contracts on Deriv synthetic indices (Volatility 75, Volatility 100, etc.). It is not a general-purpose charting application.

**Design philosophy:** Direct-to-metal. No framework overhead, no unnecessary abstractions. Raw WebSocket data flows through a Node.js server that aggregates candles, computes probabilities, and measures volatility, then streams everything to a vanilla JavaScript client that renders via Lightweight Charts v5 with custom canvas overlays.

**Primary use case:** A single trader executing rapid-fire barrier trades where latency and visual clarity directly affect profitability.

---

## Architecture

```
Deriv API (WS)
      |
      v
server/derivClient.js ---- Reconnection, auth, tick stream
      |
      v
server/index.js ---------- Orchestrator: tick pipeline, WS broadcast
      |
      +-- server/candleAggregator.js ---- Tick-to-candle conversion (7 timeframes)
      +-- server/tickStore.js ----------- Circular buffer (30k ticks)
      +-- server/volatilityEngine.js ---- Rolling vol, vol ratio, regime detection
      +-- server/probabilityEngine.js --- GBM + empirical touch probability
      +-- server/edgeCalculator.js ------ Edge = model prob - implied prob
      +-- server/tradingEngine.js ------- Proposal/buy/settlement lifecycle
      +-- server/reachGridEngine.js ----- Barrier reach rate matrix
      |
      v
WebSocket Broadcast (all clients)
      |
      v
client/js/core/App.js ---- Root module: ChartSlot, buffers, routing
      |
      +-- client/js/overlays/TimeBlockOverlay.js ---- 5m/15m block boundaries
      +-- client/js/overlays/LiquidityEqOverlay.js -- Liquidity & equilibrium levels
      +-- client/js/overlays/TradeOverlay.js --------- Active trade barrier visualization
      +-- client/js/drawing/DrawingManager.js -------- User annotations (rect, line, ray)
      +-- client/js/trading/TradingPanel.js ---------- Single-click trade execution
      +-- client/js/engines/SimpleMetricsEngine.js --- Efficiency, flip-rate, texture
      +-- client/js/utils/ChartHelpers.js ------------ DOM, theme, coordinate math
      |
      v
Lightweight Charts v5 + Canvas 2D Overlays
```

For detailed architecture documentation, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Features

### Charting

| Feature | Description |
|---------|-------------|
| **8 Timeframes** | Tick, 5s, 10s, 15s, 30s, 1m, 2m, 5m |
| **Split Grid** | Side-by-side comparison with independent timeframe selectors |
| **Fullscreen** | Any chart view can go fullscreen; split view can fullscreen together |
| **Live Countdowns** | Per-tab countdown bars showing time until next candle close |
| **Dark/Light Mode** | Full theme toggle with CSS custom properties |

### Overlays

| Feature | Description |
|---------|-------------|
| **Time Block Boundaries** | 5-minute and 15-minute block visualization with quadrant stripes |
| **Liquidity & Equilibrium** | High/Low/Mid50 levels computed from block structure |
| **Trade Barriers** | Finite-length barrier lines for active contracts (canvas overlay) |
| **Drawing Tools** | Rectangle, trendline, horizontal line, vertical line, ray, text |

### Trading

| Feature | Description |
|---------|-------------|
| **Single-Click Execution** | Auto-quote + auto-buy in one click (hidden two-step Deriv API flow) |
| **Touch/No-Touch Contracts** | Barrier direction (up/down), freeze/follow modes |
| **Live Contract Tracking** | Real-time P&L color updates during contract lifetime |
| **Trade History** | Scrollable history with outcome, profit, and contract duration |
| **Multi-Contract Support** | Multiple simultaneous trades with individual barrier overlays |

### Analytics

| Feature | Description |
|---------|-------------|
| **GBM Probability** | Geometric Brownian Motion theoretical touch probability |
| **Empirical Probability** | Historical reach rate from observed data |
| **Model Estimate** | Blended probability with breakeven comparison |
| **Volatility Meters** | Rolling log-return sigma at 10s, 30s, 60s windows |
| **Regime Detection** | Volatility state (expanding/contracting/stable) |
| **Reach Grid** | Barrier distance vs. time window probability matrix |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Server** | Node.js, Express, ws (WebSocket), better-sqlite3 |
| **Client** | Vanilla JavaScript (ES6 modules), Canvas 2D API |
| **Charting** | Lightweight Charts v5 (TradingView) |
| **Data Source** | Deriv WebSocket API (synthetic indices) |
| **Testing** | Jest (CommonJS) |

---

## Project Structure

```
touch-edge-system/
|
+-- client/                          # Frontend (served as static files)
|   +-- js/
|   |   +-- core/App.js              # Root module: ChartSlot, buffers, WS, UI
|   |   +-- drawing/DrawingManager.js # User annotation tools
|   |   +-- engines/SimpleMetricsEngine.js  # Tick efficiency & texture
|   |   +-- overlays/
|   |   |   +-- TimeBlockOverlay.js   # 5m/15m block boundaries
|   |   |   +-- LiquidityEqOverlay.js # Liquidity & equilibrium levels
|   |   |   +-- TradeOverlay.js       # Active trade barrier visualization
|   |   +-- trading/TradingPanel.js   # Trade execution UI
|   |   +-- utils/ChartHelpers.js     # DOM helpers, coordinate math
|   +-- lib/                          # Lightweight Charts library
|   +-- index.html                    # Entry point
|   +-- style.css                     # Main stylesheet
|   +-- trading.css                   # Trading panel styles
|
+-- server/                          # Backend
|   +-- index.js                      # WS server, orchestrator
|   +-- derivClient.js                # Deriv API WebSocket client
|   +-- tradingEngine.js              # Trade lifecycle management
|   +-- candleAggregator.js           # Tick-to-candle conversion
|   +-- tickStore.js                  # Circular tick buffer (30k)
|   +-- volatilityEngine.js           # Rolling volatility computation
|   +-- probabilityEngine.js          # GBM + empirical probability (SQLite)
|   +-- edgeCalculator.js             # Edge calculation
|   +-- reachGridEngine.js            # Reach rate matrix
|   +-- microStructure.js             # (deprecated, unused)
|   +-- config.js                     # Constants, API config, thresholds
|
+-- tests/                           # Integration tests
|   +-- core_logic.test.js            # Buffer hygiene, anchor logic
|
+-- research/                        # Historical analysis scripts
|
+-- ARCHITECTURE.md                   # Detailed architecture & data flow
+-- DECISIONS.md                      # Non-obvious decisions log
+-- AUDIT.md                          # Full system audit (security + performance)
+-- AUDIT_UIUX.md                     # UI/UX visual design audit
+-- AUDIT_CHECKPOINT_2026-03-16.md    # Cipher UI stability checkpoint
+-- STATUS.md                         # Current working state (truth document)
+-- CHANGELOG.md                      # Version history
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Deriv API token (demo account recommended)
- A Deriv App ID

### Setup

1. Clone the repository:

```bash
git clone https://github.com/Kingdaddy007/deriv-microstructure-xray.git
cd deriv-microstructure-xray
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root:

```env
DERIV_API_TOKEN=your_demo_token_here
DERIV_APP_ID=your_app_id_here
```

4. Start the server:

```bash
npm start
```

5. Open `http://localhost:8080` in your browser.

---

## How It Works

### Data Flow

1. **Server connects to Deriv** via WebSocket and subscribes to the tick stream for the configured synthetic index.
2. **Ticks are aggregated** into candles across 7 timeframes (5s, 10s, 15s, 30s, 1m, 2m, 5m) by `candleAggregator.js`.
3. **Closed candles are broadcast** to all connected browser clients over a local WebSocket.
4. **The client receives candles** and routes them to the appropriate `ChartSlot` (one per tab/grid panel).
5. **Overlays render** on canvas layers positioned over the Lightweight Charts canvas, using `_syncToPane()` to track the chart's internal canvas geometry.

### Trading Flow

1. User sets barrier direction and distance in the right sidebar.
2. User clicks **TRADE** — a `get_proposal` request is sent to the server.
3. Server forwards to Deriv, receives a `proposal_id` with payout/stake details.
4. Client auto-buys immediately using the `proposal_id` (no confirmation modal — speed is critical).
5. Server subscribes to contract updates from Deriv and streams them to the client.
6. Client renders the trade as a finite barrier line on the canvas overlay, updating color in real-time.
7. On settlement, the outcome is logged to trade history with visual indicators.

### Chart Initialization (Lazy)

Charts are only created when their tab is first visited. This prevents creating 9 charts on page load. When a tab is activated, `ChartSlot.init()` creates the chart, reads current data from `candleBuf` (the live source of truth), and initializes all overlays.

---

## Documentation Map

| Document | Purpose | Read When |
|----------|---------|-----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component map, data flow, buffer rules, test approach | Understanding the system |
| [DECISIONS.md](DECISIONS.md) | Why things are built the way they are | Before changing anything |
| [AUDIT.md](AUDIT.md) | Full security + performance + architecture audit | Planning improvements |
| [AUDIT_UIUX.md](AUDIT_UIUX.md) | Visual design and UX audit | Planning UI changes |
| [STATUS.md](STATUS.md) | Current working state, verified behaviors | After a break or handoff |
| [CHANGELOG.md](CHANGELOG.md) | What changed and when | Catching up on recent work |

---

## Testing

```bash
npm test
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| `tests/core_logic.test.js` | 7 | VIEW/LIVE anchor logic, buffer hygiene, tick dedup |
| `server/candleAggregator.test.js` | 5 | Candle construction, boundary handling, gap-fill |
| `server/reachGridEngine.test.js` | 5 | Reach rate computation, incomplete windows |
| `server/tradingEngine.test.js` | 3 | Buy flow, outcome normalization, barrier detection |

Tests are behavior-focused with concrete inputs and outputs. Every bug fix should get a regression test.

---

## Cache Busting

CSS and JS files use `?v=N` query parameters in `index.html`. After modifying a client file, bump its version number or the browser will serve stale content.

| File | Current Version |
|------|----------------|
| `style.css` | `?v=19` |
| `trading.css` | `?v=11` |
| `App.js` | `?v=55` |

---

## Known Constraints

- **Single-user system.** No authentication on the local WebSocket. Config changes affect all connected tabs.
- **Demo account only.** Not hardened for real-money trading. See [AUDIT.md](AUDIT.md) for security findings.
- **Browser-dependent.** Requires a modern browser with ES6 module support, Canvas 2D, and ResizeObserver.
- **No persistent trade history.** Trade records exist only for the current session. Refresh clears everything.
- **Synthetic indices only.** Designed specifically for Deriv's Volatility indices. Not tested with forex or other instruments.
