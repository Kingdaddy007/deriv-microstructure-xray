# FULL SYSTEM AUDIT — Touch Edge Trading Terminal

**Auditor:** Anti-Gravity (Reviewer + Security + Performance + Architect)
**Date:** 2026-03-16
**Codebase:** `touch-edge-system/` — Micro-Structure X-Ray v1.0.0
**Stack:** Node.js + Express + WebSocket + better-sqlite3 + LightweightCharts
**Files audited:** 35+ files across server, client, tests, and research

---

## OVERALL ASSESSMENT

**Health Score: 42/100**

**Production Readiness: ~35-40%**

This is a **functional prototype**, not a production system. The core domain logic (candle aggregation, reach grid, probability engine) is thoughtful and shows real statistical sophistication. But the engineering shell around it — security, error handling, performance, architecture, testing — is at prototype level. Deploying this with real money at stake would be dangerous.

Honest assessment: the interesting math works. The software engineering around it does not meet production standards.

---

## FINDINGS

### CRITICAL (Must Fix Before Any Real Use)

---

**C1. `.env` file contains live API token**
- **File:** `.env:2-3`
- **What:** `DERIV_APP_ID=1089` and `DERIV_API_TOKEN=aYExV1FBk1d9p5K` are in plaintext on disk in a OneDrive-synced folder.
- **Why it matters:** Anyone with access to this machine, OneDrive, or a backup can extract the API token. If this token has trade execution scope, it's a direct financial risk.
- **Fix:** Rotate the token immediately on Deriv's dashboard. Verify the `.env` was never committed to git history (`git log --all -- .env`). Ensure the token is read-scoped only.

---

**C2. No WebSocket authentication — any client can execute trades**
- **File:** `server/index.js:75-214`
- **What:** The WebSocket server accepts any connection with zero authentication. Once connected, a client can send `execute_trade`, `get_proposal`, `update_config`, or `debug_snapshot` commands freely.
- **Why it matters:** Any process or browser tab can connect and execute real-money trades. The `execute_trade` handler at `index.js:115-138` forwards requests directly to Deriv's API.
- **Fix:** Add a token-based handshake on WS connection. Gate trading commands behind verified auth.

---

**C3. No trade parameter validation — server blindly forwards to Deriv**
- **File:** `server/tradingEngine.js:33-44`, `server/index.js:115-138`
- **What:** Trade amount, barrier, duration all forwarded to Deriv with zero server-side validation. The client-side `maxStake = 100` at `client/js/trading/TradingPanel.js:15` is trivially bypassed from the browser console.
- **Why it matters:** A bug or malicious actor could submit a trade with an arbitrary stake amount. No confirmation step, no demo-account gate, no balance check.
- **Fix:** Server-side validation: max stake cap, duration bounds, contract type whitelist. Add a confirmation step. Check demo vs real account before allowing execution.

---

**C4. XSS vulnerabilities — server data injected via innerHTML without escaping**
- **Files:** `client/js/core/App.js:874`, `client/js/trading/TradingPanel.js:279-286`
- **What:** Reach grid `horizons` array and trade `contractId` values from the server are injected directly into the DOM via `innerHTML` without sanitization.
- **Why it matters:** A malicious or compromised server response containing `<img src=x onerror=alert(1)>` in the `contractId` field would execute in the browser.
- **Fix:** Use `textContent` for string values. For HTML construction, escape all server-provided data or use DOM APIs (`createElement`/`textContent`).

---

**C5. Debug commands exposed in production browser console**
- **File:** `client/js/core/App.js:30-41`
- **What:** `window.debugSnapshot()`, `window.debugCompare()`, `window.debugCounters()` are globally accessible and send commands to the server over WebSocket.
- **Why it matters:** Any script on the page can exfiltrate server analytics data. Combined with no WS auth, this is a data exfiltration vector.
- **Fix:** Remove from production. Gate behind a `DEBUG` environment variable or dev-mode flag.

---

### HIGH (Strongly Recommended)

---

**H1. `Array.shift()` on 30,000-element buffer — O(N) per tick**
- **File:** `server/tickStore.js:70`
- **What:** When the tick buffer is full, every new tick triggers `this.ticks.shift()` which copies all 30,000 elements.
- **Why it matters:** At 1 tick/sec, this is 30,000 array element relocations per second continuously. Unnecessary GC pressure and CPU waste.
- **Fix:** Replace with a proper circular buffer using head/tail pointers. O(1) insertion and eviction.

---

**H2. `volatilityEngine.update()` recomputes ALL log returns on every tick**
- **File:** `server/volatilityEngine.js:45-64`
- **What:** On every tick, the engine iterates all 30,000 ticks to compute log returns from scratch, then slices for each of 5 windows. ~150,000 operations per tick.
- **Why it matters:** Should be incremental — compute only the new log return and maintain a rolling buffer.
- **Fix:** Maintain a `logReturns` array incrementally. On each new tick, push one new log return. Use slice indices for windowed volatility.

---

**H3. 9 permanent `requestAnimationFrame` loops — 540 render calls/sec**
- **File:** `client/js/drawing/DrawingManager.js:52-53`
- **What:** Each `DrawingManager` instance (one per chart slot = 9) starts an infinite RAF loop on construction, redrawing the canvas every frame regardless of whether anything changed.
- **Why it matters:** 540 canvas clear-and-redraw operations per second when most charts have zero drawings. Largest client-side CPU waste.
- **Fix:** Add a dirty flag. Only schedule RAF when a drawing is added, modified, or the chart pans/zooms.

---

**H4. `uiConfig` is a global singleton shared across all WS clients**
- **File:** `server/index.js:59`
- **What:** One `uiConfig` object with `barrier`, `payoutROI`, `direction`. When any client sends `update_config`, it changes for ALL connected clients.
- **Why it matters:** If two browser tabs are open, one user's config change silently affects the other's analytics.
- **Fix:** Store config per-connection. Associate each WS client with its own config state.

---

**H5. Edge calculator silently maps null probability to 0%**
- **File:** `server/edgeCalculator.js:39,42`
- **What:** When probability is unknown (null), the fallback is `0`, which means the trader sees "0% probability" and "0% edge."
- **Why it matters:** "Unknown" is not "zero." A trader seeing "0% edge" may conclude the trade is bad when the system simply lacks enough data.
- **Fix:** Preserve null. Have the UI display "Insufficient data" or "--" instead of "0%."

---

**H6. Race condition: Deriv auth and tick subscription fire simultaneously**
- **File:** `server/derivClient.js:129-147`
- **What:** On WebSocket open, the client sends `authorize` and immediately sends `ticks` subscription without waiting for auth confirmation.
- **Why it matters:** The tick stream may be rejected if Deriv processes the subscribe before auth completes. Silent data loss.
- **Fix:** Wait for the `authorize` response before sending the `ticks` subscription.

---

**H7. No graceful shutdown — database handles leak**
- **File:** `server/probabilityEngine.js:142-144`
- **What:** `probabilityEngine.close()` exists but is never called on server shutdown. No SIGINT/SIGTERM handlers. No interval cleanup.
- **Why it matters:** SQLite handles left open can cause WAL corruption. Intervals and WS connections persist as zombie resources.
- **Fix:** Add process signal handlers that call `probabilityEngine.close()`, clear intervals, and close WebSocket connections.

---

**H8. Test coverage is critically thin**
- **Files:** `tests/core_logic.test.js`, `server/candleAggregator.test.js`, `server/reachGridEngine.test.js`
- **What:** 292 total lines of tests across 3 files. Zero tests for: derivClient, tradingEngine, edgeCalculator, volatilityEngine, probabilityEngine, entire client side. The anchor test re-implements production logic locally instead of importing it — if real code diverges, tests pass but production is wrong.
- **Fix:** Prioritize tests for `tradingEngine` (trade validation), `derivClient` (reconnection, error handling), and `probabilityEngine` (math correctness).

---

### MEDIUM (Should Fix)

---

**M1. Dead code: `microStructure.js` has bugs and is never imported**
- **File:** `server/microStructure.js`
- **What:** Has an off-by-one bug at line 29 (`ticks[-1]` = `undefined` producing `NaN`) and is never imported anywhere. `volatilityEngine.js` replaced it.
- **Fix:** Delete the file.

---

**M2. Massive code duplication between overlay files**
- **Files:** `client/js/overlays/TimeBlockOverlay.js`, `client/js/overlays/LiquidityEqOverlay.js`
- **What:** ~150 lines of near-identical code: `_getAnchorTime()`, `_syncToPane()`, `_createToggles()`, `destroy()`, badge creation.
- **Fix:** Extract a shared `BaseOverlay` class or utility module.

---

**M3. `App.js` is an 875-line god module**
- **File:** `client/js/core/App.js`
- **What:** Handles WebSocket, UI events, data buffering, barrier logic, reach grid, grid panels, tab switching, fullscreen, theme, countdowns, analytics, health monitoring — all in one file.
- **Fix:** Split into: `WebSocketManager`, `BarrierController`, `AnalyticsDisplay`, `TabManager`, `GridPanelManager`.

---

**M4. Console logging on every tick in production**
- **Files:** `client/js/core/App.js:683-700`, `client/js/overlays/TimeBlockOverlay.js:383-399`
- **What:** `console.log` fires on every tick, every candle update, every boundary transition. Thousands of log entries per minute.
- **Fix:** Remove or gate behind a `DEBUG` flag.

---

**M5. `getAll()` returns internal array reference — mutation risk**
- **File:** `server/tickStore.js:85-87`
- **What:** Returns `this.ticks` directly. Any caller that mutates the array corrupts the store.
- **Fix:** Return `this.ticks.slice()` or document the contract explicitly.

---

**M6. Hardcoded colors bypass CSS theme system**
- **Files:** `App.js`, `TradingPanel.js`, `DrawingManager.js`, `ChartHelpers.js`, `trading.css`
- **What:** 30+ instances of hardcoded hex/rgba colors in JS and CSS that won't adapt to light mode.
- **Fix:** Use CSS custom properties consistently. For canvas rendering, read computed styles.

---

**M7. Config inconsistency across research scripts**
- **Files:** `research/01_api_exploration.js`, `research/02_download_history.js`
- **What:** `config.DERIV_WS_URL` (string) vs `config.DERIV_WS_URLS[0]` (array). One of these will throw at runtime.
- **Fix:** Standardize on one config shape.

---

**M8. No Content Security Policy**
- **File:** `client/index.html`
- **What:** No CSP meta tag or header. External fonts loaded without SRI hashes.
- **Fix:** Add CSP header via Express middleware. Add SRI hashes to external resources.

---

### LOW (Nice to Have)

| # | Issue | Location |
|---|-------|----------|
| L1 | `EDGE_STRONG/MODERATE/MINIMUM` — dead config, never referenced | `server/config.js:45-47` |
| L2 | `_toPx` defined twice, first definition is dead code | `client/js/drawing/DrawingManager.js:92-109` |
| L3 | Intermediate candles lost silently during disconnects | `server/candleAggregator.js:22-28` |
| L4 | `HISTORY_DAYS: 7` — dead config | `server/config.js:27` |
| L5 | `deploys.json` is UTF-16 encoded instead of UTF-8 | `deploys.json` |
| L6 | Missing `</body>` closing tag | `client/index.html` |
| L7 | Unused `fs` import | `test_matrix.js:1`, `test_range.js:1` |
| L8 | One-time migration scripts with hardcoded line numbers should be deleted | `extract_*.js`, `fix_classes.js`, `inject_dm.js` |

---

## STRENGTHS

1. **Honest research pipeline.** `phase0_findings.md` directly contradicts the project's initial thesis and says so. That takes discipline.
2. **CandleAggregator is clean.** Pure functions, well-tested, handles OHLC correctly. Best-quality module in the codebase.
3. **ReachGridEngine is solid domain logic.** Pure function, no side effects, correct statistical approach.
4. **TickStore rejection logic is sound.** Duplicate and out-of-order tick handling is correct (even if the implementation is inefficient).
5. **Reconnection with exponential backoff in derivClient.** The pattern is correct even if details need polish.
6. **CSS custom properties for theming.** The foundation is there — it just isn't used consistently.
7. **Modular client-side structure.** The ES6 module split (core/drawing/engines/overlays/trading/utils) shows architectural intent.

---

## PRIORITIZED FIX LIST

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| 1 | Rotate the exposed API token | 5 min | Eliminates immediate financial risk |
| 2 | Add WS authentication | 2-3 hrs | Prevents unauthorized trade execution |
| 3 | Add server-side trade validation (max stake, demo gate, balance check) | 2-3 hrs | Prevents catastrophic financial loss |
| 4 | Fix XSS in `App.js:874` and `TradingPanel.js:279` | 30 min | Prevents script injection |
| 5 | Remove debug globals from production | 30 min | Closes data exfiltration vector |
| 6 | Replace `Array.shift()` with circular buffer in `tickStore.js` | 1-2 hrs | Eliminates O(N) per-tick CPU waste |
| 7 | Make volatilityEngine incremental | 1-2 hrs | Eliminates O(30K) per-tick recomputation |
| 8 | Add dirty flag to DrawingManager RAF loop | 1 hr | Eliminates 540 unnecessary renders/sec |
| 9 | Fix uiConfig singleton — per-client state | 1 hr | Prevents cross-client config pollution |
| 10 | Fix auth/subscribe race condition in derivClient | 30 min | Prevents silent data loss |
| 11 | Add graceful shutdown handlers | 1 hr | Prevents DB corruption |
| 12 | Fix null → 0 fallback in edgeCalculator | 30 min | Prevents misleading trade signals |
| 13 | Add tests for tradingEngine, derivClient, probabilityEngine | 4-6 hrs | Enables safe refactoring |
| 14 | Remove console.log noise from production paths | 30 min | Reduces client/server CPU waste |
| 15 | Delete dead code (microStructure.js, migration scripts, dead config) | 30 min | Reduces confusion |

---

## FINAL VERDICT

**This is a 35-40% production-ready system.**

The math and domain logic are the strongest part — maybe 70% of the way there. The engineering infrastructure (security, error handling, testing, performance, architecture) is at 20-30%.

The critical path is clear:
- **Fixes 1-5** address safety
- **Fixes 6-8** address performance
- **Fixes 9-12** address correctness
- **Fixes 13-15** address maintainability

Nothing here requires a rewrite. The architecture has the right shape — it needs the engineering discipline tightened. Focused sprint work on the top 10 items would move the score from 42 to ~65-70.
