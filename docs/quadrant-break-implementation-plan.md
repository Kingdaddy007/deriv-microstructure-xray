# Quadrant Break Strategy — Implementation Plan

## Goal

Build the "Quadrant Break" automated trading bot as a standalone strategy module within the existing Cipher Trading Terminal. When complete, the user can toggle between "Cipher Swarm" (the existing agent-based bot) and "Quadrant Break" (the new structural pattern bot) from the UI dashboard. Both share infrastructure (tick feed, blockTracker, tradingEngine, tradeLogger) but have completely independent decision logic.

> [!IMPORTANT]
> **No Swarm Agents.** This bot has ZERO agents. No voting, no consensus. The 5 structural gates are the only decision layer. If all gates pass at Q4 open → fire immediately. If any gate fails → skip the entire block.

---

## Resolved Decisions

| Question | Answer |
|:---------|:-------|
| **Barrier distance** | Reads from UI (`uiConfig.barrier`). Currently 1.6 pts. Whatever the user changes in the UI, both bots use. NOT fixed. |
| **Contract duration** | Reads from UI. Default 2 minutes. Touch can hit during Q4 or even into the next block — doesn't matter, it's a 2-minute contract window. |
| **Gate 1 threshold** | 20% of Q2's tick count. |
| **Trade direction** | Auto-determined from gate analysis. Q3 breaks Q2 High → BUY. Q3 breaks Q2 Low → SELL. UI direction toggle is ignored when this bot is active. |
| **Contract type** | One-Touch (ONETOUCH). Barrier placed in predicted direction. |
| **Stake** | Reads from UI (`botStakeInput`). Same input controls both strategies. |

---

## Proposed Changes

### Component 1: Quadrant Data Tracker (Augmenting BlockTracker)

The existing `blockTracker.js` tracks block-level OHLC and quadrant timing, but does NOT track per-quadrant OHLC (Q1 open/high/low/close, Q2 open/high/low/close, etc.). The new strategy requires this granularity.

#### [MODIFY] [blockTracker.js](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/server/blockTracker.js)

**What changes:**
- Add per-quadrant OHLC tracking: `q1`, `q2`, `q3`, `q4` objects each with `{ open, high, low, close, tickCount }`.
- On every tick, update the current quadrant's OHLC.
- When a quadrant transitions (e.g., Q1→Q2), finalize the previous quadrant's close.
- Expose quadrant OHLC via `getState()` so downstream consumers can read Q1/Q2/Q3 structure at any point.
- Track `q3BreakTick` — the tick index within Q3 at which Q3 first breaks Q2's key level (needed for Gate 1 & Gate 3 checks).

**What stays the same:**
- Block-level OHLC, `prevBlock`, `macroTrend`, micro-candles — all untouched.
- The existing Cipher Swarm bot reads from `getState()` and will not be affected.

---

### Component 2: Quadrant Break Strategy Engine (NEW)

#### [NEW] [quadrantBreakStrategy.js](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/server/quadrantBreakStrategy.js)

**Purpose:** The brain of the Quadrant Break bot. Pure logic — no side effects, no trading execution. Takes block state as input, returns a decision.

**Structure:**
```
class QuadrantBreakStrategy {
    constructor(config = {})    // threshold tolerances
    
    evaluate(blockState)        // Returns { signal, direction, gates, reason }
    
    // Internal gate methods:
    _gate0_Q1Structure(q1)      // Q1 must be ranging, not trending
    _gate1_Q1Clearance(q1, q2)  // Q2 must clear Q1's extreme early  
    _gate2_Q3Rejection(q2, q3)  // Q3 must not snap back after break
    _gate3_Q3Energy(q2, q3)     // Q3 must show clean directional energy
    _gate4_Exhaustion(blockOpen, q3, barrier) // Q1-Q3 displacement not over-extended
    
    // Helper methods:
    _bodyRangeRatio(ohlc)       // |open - close| / (high - low)
    _isQ3SequenceValid(q2, q3, direction)  // "Spring" vs "Trap" check
}
```

**Gate Logic (Pseudocode):**

```javascript
// Gate 0: Q1 Structure
const q1BodyRatio = Math.abs(q1.open - q1.close) / (q1.high - q1.low);
if (q1BodyRatio > 0.80) return SKIP; // Q1 is trending, not ranging

// Gate 1: Q1 Clearance by Q2
// For BUY: Did Q2 take Q1.high within first ~20% of Q2's ticks?
// For SELL: Did Q2 take Q1.low within first ~20% of Q2's ticks?
// (Uses q2.tickAtQ1Clear stored by blockTracker)

// Gate 2: Q3 Rejection
// After Q3 breaks Q2's level, measure snap-back
// If Q3 retraces > 60% of the break displacement → SKIP

// Gate 3: Q3 Energy (Spring vs Trap)
// Good Q3: Dips against trend FIRST, then breaks with trend
// Bad Q3: Breaks with trend FIRST, then reverses  
// Also: Q3 close must be on correct side of Q3 midpoint

// Gate 4: Q1-Q3 Exhaustion
// If price has traveled too far from block open to Q3 close,
// the market is over-extended and Q4 won't have fuel to expand further.
// totalDisplacement = |blockOpen - q3.close|
// IF totalDisplacement > barrier * exhaustionMultiplier → SKIP
```

**Config (tunable thresholds with defaults):**
```javascript
{
    q1BodyRatioMax: 0.80,         // Gate 0: max body/range ratio
    q1ClearanceWindow: 0.20,      // Gate 1: Q2 must clear Q1 within first 20% of ticks
    q3SnapBackMax: 0.60,          // Gate 2: max allowed retrace ratio
    q3CloseSideThreshold: 0.50,   // Gate 3: Q3 close must be on correct side of midpoint
    exhaustionMultiplier: 5.0,    // Gate 4: skip if Q1-Q3 displacement > barrier * this
}
```

---

### Component 3: Quadrant Break Controller (NEW)

#### [NEW] [quadrantBreakController.js](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/server/quadrantBreakController.js)

**Purpose:** The execution controller — equivalent to `botController.js` but for the Quadrant Break strategy. Handles trade lifecycle (fire trade, track outcome, auto-pause after losses).

**Structure:**
```
class QuadrantBreakController extends EventEmitter {
    constructor({ blockTracker, strategy, tradingEngine, broadcast, tradeLogger })
    
    onTick(epoch, price)          // Called every tick from index.js
    setEnabled(enabled)           // Toggle on/off
    setStake(amount)              // Set trade size
    unpause()                     // Resume after auto-pause
    
    // Internal:
    _checkAndFire(epoch, price)   // At Q4 open: evaluate strategy → fire or skip
    _handleOutcome(outcome)       // Win/loss tracking, auto-pause logic
}
```

**Key Design:**
- The controller does NOTHING during Q1, Q2, Q3. It silently watches the blockTracker accumulate quadrant data.
- The INSTANT `blockTracker.quadrant` transitions from Q3 → Q4 (i.e., `elapsed >= 225` for the first time), it calls `strategy.evaluate(blockState)`.
- If signal is GREEN → immediately fire trade via `tradingEngine`.
- If signal is RED → log the reason and do nothing until next block.
- **One trade per block maximum.** Once a trade fires or is skipped, the controller is dormant until the next block.
- Uses the same `TradeLogger` (SQLite) as the Cipher Swarm bot, with a `strategy` column to distinguish trade sources.

---

### Component 4: Server Integration

#### [MODIFY] [index.js](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/server/index.js)

**What changes:**
- Import `QuadrantBreakStrategy` and `QuadrantBreakController`.
- Instantiate both alongside the existing Cipher Swarm modules.
- Add a `activeStrategy` state variable: `'swarm'` or `'quadrant'`.
- In the tick handler (line ~641):
  - If `activeStrategy === 'swarm'` → run existing `botController.onTick()`.
  - If `activeStrategy === 'quadrant'` → run `quadrantBreakController.onTick()`.
  - `blockTracker.update()` always runs (both strategies need it).
- Add WebSocket message handler for `set_strategy` to switch between strategies.
- Broadcast `strategy_changed` event to all clients when strategy switches.
- Broadcast `quadrant_gate_status` with the current gate evaluation every tick (for UI display).

**What stays the same:**
- All existing Cipher Swarm logic is untouched.
- Chart, candle, volatility, probability — all unchanged.
- Trade outcome routing — unchanged (both controllers use the same tradingEngine).

---

### Component 5: UI Dashboard Updates

#### [MODIFY] [terminal.html](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/client/terminal.html)

**What changes:**
- Add a "Strategy Selector" toggle above the bot control panel:
  ```html
  <div class="control-group-label">Strategy</div>
  <div class="toggle-group">
      <button class="toggle-btn active" id="btnSwarm">Cipher Swarm</button>
      <button class="toggle-btn" id="btnQuadrant">Quadrant Break</button>
  </div>
  ```
- The bot control panel (enable/disable, stake, unpause) adapts to whichever strategy is active.
- Add a "Gate Status" display section showing the 4 gates' pass/fail status in real-time (only visible when Quadrant Break is active).

#### [MODIFY] Client JS (App.js or relevant handler)

**What changes:**
- Send `set_strategy` message when user clicks strategy toggle.
- Listen for `strategy_changed` to update UI state.
- Listen for `quadrant_gate_status` to render gate indicators.
- Hide/show swarm-specific UI (agent votes, consensus) vs quadrant-specific UI (gate status, quadrant progress bar).

---

### Component 6: Trade Logger Enhancement

#### [MODIFY] [tradeLogger.js](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/server/tradeLogger.js)

**What changes:**
- Add a `strategy` column to the trades table: `'swarm'` or `'quadrant'`.
- The Quadrant Break controller logs trades with `strategy: 'quadrant'` and includes gate evaluation data (which gates passed, Q1/Q2/Q3 OHLC, direction, etc.).
- Query methods support filtering by strategy.

---

## Open Questions

All original open questions have been resolved (see Resolved Decisions above).

> [!NOTE]
> **Gate 4 exhaustionMultiplier calibration:** Default is 5.0x the barrier distance. This may need tuning during demo testing. If the bot skips too many valid trades, lower it. If it lets through exhausted setups, raise it.

---

## Verification Plan

### Automated Tests

1. **Unit test `quadrantBreakStrategy.js`:**
   - Feed it synthetic Q1/Q2/Q3 OHLC data matching each of the 17+ screenshots.
   - Verify every winning screenshot produces `signal: 'FIRE'`.
   - Verify every losing/skip screenshot produces `signal: 'SKIP'` with the correct failing gate.
   - Target: **100% accuracy against all documented screenshots.**

2. **Unit test `blockTracker.js` quadrant OHLC:**
   - Feed synthetic tick sequences and verify per-quadrant OHLC is computed correctly.

3. **Integration test in demo mode:**
   - Run the full server with Quadrant Break active on demo account.
   - Observe the bot across multiple 5-minute blocks.
   - Verify it correctly skips non-pattern blocks and fires on valid patterns.

### Manual Verification

1. Run the bot on demo for at least 1-2 hours while monitoring the terminal.
2. Verify gate status display updates in real-time.
3. Verify strategy toggle switches cleanly between Swarm and Quadrant Break.
4. Verify trades from both strategies appear correctly in the trade journal with proper `strategy` tags.
