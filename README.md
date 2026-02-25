# Touch Edge System — Micro-Structure X-Ray

A real-time micro-structure visualizer for Deriv synthetic indices (V100 1s, V75 1s). Built for manual traders who want to see micro-candle timeframes (5s, 10s, 15s) and volatility diagnostics that Deriv's platform doesn't expose.

## What It Does

- **Live tick stream** from Deriv WebSocket API
- **5s, 10s, 15s candle charts** built from raw ticks (TradingView Lightweight Charts)
- **Historical pre-fill** on startup — loads past ticks so charts aren't blank
- **Volatility diagnostics** — log-return σ across 5 windows, Vol Ratio, Vol Trend
- **Probability analysis** — GBM theoretical + empirical database lookup (88k+ samples)
- **Flexible grid view** — choose any candle timeframe for each panel
- **Neutral display** — raw data only, no prescriptive signals. Decision stays with you.

## Tech Stack

- **Backend:** Node.js, Express, ws (WebSocket)
- **Frontend:** Vanilla JS, TradingView Lightweight Charts
- **DB:** better-sqlite3 (local empirical tick dataset)
- **Source:** Deriv WebSocket API (wss://ws.derivws.com)

## Prerequisites

- Node.js v18+
- npm

## Install & Run

```bash
git clone <this-repo>
cd touch-edge-system
npm install
node server/index.js
```

Then open **<http://localhost:8080>** in your browser.

## Configuration

Edit `server/config.js` to change:

- `SYMBOLS` — which Deriv synthetic index to watch
- `WARMUP_TICKS` — how many ticks before probability calculations activate
- `VOL_WINDOWS` — volatility rolling window sizes

## Note

This tool does **not** place trades. It is a decision-support visualizer only. All trade execution remains on DTrader.
