# Project State: Micro-Structure X-Ray (Refactoring Session)

## Core Accomplishments

1. **Backtesting Engine (VIEW Anchor):**
    * Implemented `_getAnchorTime` logic in `TimeBlockOverlay` and `LiquidityEqOverlay`.
    * The chart now supports `LIVE` (real-time) and `VIEW` (scrolled-back) modes automatically using the visible logical range.
    * Guardrails: 30s threshold to prevent jitter, clamping to current time to prevent "future vision".
2. **UX Features:**
    * **Depth Selector:** [1/2/3] toggle in the overlay panel to limit historical logic blocks.
    * **Mode Badges:** Integrated `LIVE` (Blue) and `VIEW` (Amber) badges for visual status.
    * **Micro-Improvements:** Rectangle midline tool, higher quad visibility (0.14 opacity), and "Scroll Now" logic.
3. **Stability:**
    * Removed defunct "Mark Now" pins that crashed the UI.
    * Fixed all `lastT` ReferenceErrors from the initial refactor.
    * Cache busting implemented in `index.html` (currently `v=28`).

## Current Architecture (client/app.js)

The app is currently a single ~2600 line file containing:

* `DrawingManager`: Logic for all canvas-based chart drawings.
* `TimeBlockOverlay`: Background quadrant logic (5m/15m).
* `LiquidityEqOverlay`: H/L/Mid line logic for closed blocks.
* `Impulse/Texture Engines`: High-frequency tick analytics.
* `App`: Main controller, LWC initialization, and L1 websocket management.

## Next Phase: Modular Refactoring

The goal is to split `app.js` into a structure like:

* `/client/js/core/App.js`
* `/client/js/drawing/DrawingManager.js`
* `/client/js/overlays/TimeBlockOverlay.js`
* `/client/js/overlays/LiquidityEqOverlay.js`
* `/client/js/engines/Analytics.js`
* `/client/js/utils/Helpers.js`

This will drastically reduce token costs for future edits and make the codebase "builder-friendly" for Nigeria's infrastructure.
