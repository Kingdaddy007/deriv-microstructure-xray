# QUADRANT BREAK STRATEGY — Complete Technical Specification

> **Version:** 1.0
> **Date:** 2026-04-02
> **Status:** Finalized Research, Ready for Build
> **Author:** Beloved (Strategy Discovery) + Anti-Gravity (Documentation)

This document is a COMPLETE, SELF-CONTAINED specification for building the Quadrant Break automated trading bot. Any developer or AI reading this should be able to implement the bot without additional context.

---

## TABLE OF CONTENTS

1. [What This Bot Does](#1-what-this-bot-does)
2. [The Market](#2-the-market)
3. [The Contract](#3-the-contract)
4. [Core Concept](#4-core-concept)
5. [How Time Is Divided](#5-how-time-is-divided)
6. [The 4 Gates (Decision Logic)](#6-the-4-gates-decision-logic)
7. [Entry Execution](#7-entry-execution)
8. [DOs and DON'Ts](#8-dos-and-donts)
9. [What the Bot Skips](#9-what-the-bot-skips)
10. [Risk Management](#10-risk-management)
11. [Architecture](#11-architecture)
12. [Data Requirements](#12-data-requirements)
13. [Evidence Base](#13-evidence-base)
14. [Glossary](#14-glossary)

---

## 1. What This Bot Does

This bot watches the **internal structure** of 5-minute price blocks on the Volatility 100 (1s) Index. It looks for a specific pattern where institutional liquidity sweeps create a predictable continuation move. When the pattern is detected, it fires exactly ONE trade at the exact start of the 4th quadrant. When the pattern is not detected, it does **nothing**.

**Philosophy: No trade is ALWAYS better than a bad trade.**

The bot does NOT use AI agents, machine learning, consensus voting, or momentum analysis. It uses 5 simple mathematical checks (gates) applied to price structure. If all 5 gates pass → trade. If any gate fails → skip.

---

## 2. The Market

- **Asset:** Volatility 100 (1s) Index — Symbol: `1HZ100V`
- **Platform:** Deriv (via WebSocket API)
- **Tick frequency:** 1 tick per second
- **This is a synthetic index.** It is not affected by news, earnings, or real-world events. It runs 24/7 and is driven by a random number generator with defined statistical properties (100% volatility).

---

## 3. The Contract

- **Type:** One-Touch (ONETOUCH)
- **How it works:** You predict that the price will TOUCH a specific barrier price at least once before the contract expires. If it touches the barrier at any point — even briefly — you WIN, regardless of where the price ends up.
- **Why One-Touch:** Our pattern produces high-momentum moves in Q4. We don't care about where price closes, only that it reaches the barrier. A brief spike is enough.
- **Direction:** Determined automatically by the pattern. If Q3 breaks Q2's HIGH → BUY (barrier placed above). If Q3 breaks Q2's LOW → SELL (barrier placed below).
- **Barrier distance:** Reads from the UI (same input as Cipher Swarm). Currently 1.6 points. User-adjustable.
- **Duration:** Reads from the UI. Default 2 minutes. The touch can hit during Q4 or even into the next block's Q1 — the 2-minute window doesn't care about block boundaries.

---

## 4. Core Concept

The strategy is called **"Sweep → Break → Continue."**

In a 5-minute block, price goes through a predictable institutional cycle:

1. **Q1 — Accumulation/Distribution:** Price ranges. No clear direction. Energy builds. A "coiled spring."
2. **Q2 — Structure Creation:** Price creates a significant high or low. This is the "trap" — it attracts traders who think price is trending.
3. **Q3 — Liquidity Sweep (The Break):** Price breaks Q2's level, sweeping stop-loss orders. This is the TRIGGER. The break must be clean.
4. **Q4 — Displacement (The Payoff):** Price continues past the break. This is where the trade runs. The momentum from Q3's break carries into Q4.

The bot enters at Q4's exact opening price. By that point, Q1-Q3 have already proven the pattern is valid.

---

## 5. How Time Is Divided

Every 5-minute block (300 seconds) is divided into 4 quadrants:

| Quadrant | Time Range | Duration | Elapsed (sec) |
|:---------|:-----------|:---------|:---------------|
| Q1 | Block start → +75s | 75 seconds | 0 – 74 |
| Q2 | +75s → +150s | 75 seconds | 75 – 149 |
| Q3 | +150s → +225s | 75 seconds | 150 – 224 |
| Q4 | +225s → +300s | 75 seconds | 225 – 300 |

**Block alignment:** Blocks are aligned to UTC time. A block start epoch is always divisible by 300.
Formula: `blockStart = Math.floor(epoch / 300) * 300`

**Critical timing edge:** The Q3→Q4 transition happens at `elapsed === 225`. The bot MUST fire on the very first tick where `elapsed >= 225`. Not the second tick, not after a delay — the FIRST tick.

---

## 6. The 5 Gates (Decision Logic)

All 5 gates must PASS for a trade to be fired. If ANY gate fails → no trade for the entire block.

### Gate 0: Q1 Structure Check

**Purpose:** Ensure Q1 was ranging/choppy (energy accumulation), not trending (energy already spent).

**Math:**
```
q1BodyRatio = |Q1.open - Q1.close| / (Q1.high - Q1.low)

IF q1BodyRatio > THRESHOLD (default 0.80):
    → Q1 is trending → SKIP
ELSE:
    → Q1 is ranging → PASS
```

**Edge case:** If Q1's total range is extremely small (less than a minimum threshold), treat it as ranging regardless of body ratio. A tight consolidation that drifts slightly to one end is still ranging behavior.

**What it catches:**
- Pure directional Q1 (opens at one end, closes at the other)
- Blocks where the trend started at tick 1 and never paused

---

### Gate 1: Q1 Liquidity Clearance

**Purpose:** Q2 must take out Q1's key extreme early. If Q1's resistance/support survives until Q3, the path ahead is blocked.

**Math:**
```
For BUY direction:
    Q2 must have a tick above Q1.high within the first N ticks of Q2
    N = Q2.tickCount * CLEARANCE_WINDOW (default 0.20 = first 20%)

For SELL direction:
    Q2 must have a tick below Q1.low within the first N ticks of Q2

IF Q1 extreme is NOT cleared by Q2 within the window:
    → SKIP (Q3 will have to fight Q1's level AND Q2's level)
ELSE:
    → PASS
```

**Important nuance (from SS10/SS11):** If Q2 clears Q1's extreme AND Q2 close is near Q2's high (for buys), this is acceptable as long as Q2 was TRENDING upward, not V-shaping. The distinction:
- **Trending Q2:** Price climbs steadily with small pullbacks → Q2 close near high is fine
- **V-shape Q2:** Price dumps violently to the opposite extreme, then recovers → This is exhaustion → Should be caught by Gate 2 or Gate 3 indirectly

---

### Gate 2: Q3 Rejection Filter

**Purpose:** After Q3 breaks Q2's level, it must NOT violently snap back. A violent snap-back means the breakout was a false (a "spring" trap).

**Math:**
```
After Q3 breaks Q2's key extreme:
    Record Q3's maximum displacement past the break level (Q3_maxBreakDisplacement)
    Record Q3's retrace FROM that maximum (Q3_retrace)

snapBackRatio = Q3_retrace / Q3_maxBreakDisplacement

IF snapBackRatio > THRESHOLD (default 0.60):
    → False breakout → SKIP
ELSE:
    → Breakout held → PASS
```

**Additional check (The "Spring vs Trap" Rule):**
- **Good Q3 ("The Spring"):** Q3 opens → dips AGAINST the trend first → finds support → then breaks WITH the trend. The initial dip gathers liquidity. The break has conviction.
- **Bad Q3 ("The Trap"):** Q3 opens → immediately shoots WITH the trend to break the level → runs out of gas → reverses hard AGAINST the trend → closes on wrong side.

To measure this:
```
Q3_midTime = Q3's 50% elapsed time (tick count / 2)

Good Q3 (for BUY): Q3 creates its LOW before Q3_midTime, then breaks later
Bad Q3 (for BUY): Q3 creates its HIGH before Q3_midTime, then reverses

Good Q3 (for SELL): Q3 creates its HIGH before Q3_midTime, then breaks later  
Bad Q3 (for SELL): Q3 creates its LOW before Q3_midTime, then reverses
```

---

### Gate 3: Q3 Energy / Consolidation Filter

**Purpose:** Q3 must show clean directional energy. If Q3 is choppy, with multiple highs and lows oscillating aimlessly, the breakout lacks conviction and Q4 will not continue.

**Math:**
```
Count direction changes (reversals) in Q3's tick sequence:
    A reversal = price was going up, now going down (or vice versa)
    Use a minimum movement threshold to filter noise ticks

IF reversal_count > MAX_REVERSALS (calibrate from data):
    → Q3 is too choppy → SKIP

ALSO CHECK:
    Q3 close must be on the correct side of Q3's midpoint:
    - For BUY: Q3.close > (Q3.high + Q3.low) / 2
    - For SELL: Q3.close < (Q3.high + Q3.low) / 2

IF Q3 close is on wrong side:
    → Q3 reversed direction → SKIP
```

---

### Gate 4: Q1-Q3 Exhaustion Filter

**Purpose:** If price has already traveled a very long distance from Q1 through Q3, the market is over-extended. There is no fuel left for Q4 to expand further. The bot should skip.

**Math:**
```
totalDisplacement = |blockOpen - Q3.close|

IF totalDisplacement > barrier_distance * EXHAUSTION_MULTIPLIER (default 5.0):
    → Market is over-extended → SKIP
ELSE:
    → PASS
```

**What it catches:**
- Blocks where Q1-Q3 have been one long continuous expansion (up or down)
- Setups that technically pass Gates 0-3 but where Q4 has no remaining energy
- The "car ran out of gas" scenario — 3/4 of the track is done, no fuel left

**Config:** `exhaustionMultiplier` (default 5.0). If the bot skips too many valid trades, lower it. If it lets through exhausted setups, raise it.

---

## 7. Entry Execution

**When:** The INSTANT `quadrant` transitions from Q3 to Q4 (first tick where `elapsed >= 225`).

**What happens:**
1. Strategy evaluates all 5 gates using Q1, Q2, Q3 OHLC data.
2. If ALL gates pass:
   a. Determine direction: Q3 broke Q2 HIGH → BUY. Q3 broke Q2 LOW → SELL.
   b. Calculate barrier: current price + barrier_distance (BUY) or - barrier_distance (SELL).
   c. Send proposal request to Deriv API for ONETOUCH contract.
   d. Execute buy immediately upon proposal receipt.
   e. Log the trade (strategy: 'quadrant', gate details, Q1/Q2/Q3 OHLC).
3. If ANY gate fails:
   a. Log the skip reason (which gate failed, why).
   b. Do nothing for the rest of the block.

**After execution:**
- The controller is dormant until the next block starts.
- Only ONE trade per 5-minute block. No re-entry, no averaging in.

---

## 8. DOs and DON'Ts

### DOs
- ✅ Fire at Q4 open — immediately, no hesitation
- ✅ Use percentage-based thresholds — never exact price matches
- ✅ Log every decision (fire or skip) with full gate details
- ✅ Auto-pause after 2 consecutive losses
- ✅ Allow the user to toggle between Cipher Swarm and Quadrant Break
- ✅ Keep all threshold values configurable for tuning
- ✅ Track per-quadrant OHLC (Q1, Q2, Q3 individually)
- ✅ Treat Q4 as pure execution — no analysis needed

### DON'Ts
- ❌ DO NOT use Swarm Engine agents (no voting, no consensus)
- ❌ DO NOT wait for "confirmation" after Q4 opens — fire immediately
- ❌ DO NOT try to trade mid-quadrant (entry is ONLY at Q4 open)
- ❌ DO NOT use exact value comparisons — always use tolerance windows
- ❌ DO NOT try to catch every market condition — skip anything that isn't the exact pattern
- ❌ DO NOT enter more than 1 trade per 5-minute block
- ❌ DO NOT use the macroTrend or any higher-timeframe analysis (the 5-minute block structure is self-contained)
- ❌ DO NOT let gate thresholds be hardcoded — they must be in a config object

---

## 9. What the Bot Skips

The bot will correctly SKIP in the following conditions (validated against 17+ screenshots):

| Condition | What Happens | Gate That Catches It |
|:----------|:-------------|:--------------------|
| Q1 is a sheer displacement (open ≈ high, close ≈ low or vice versa) | Q1 was trending, not accumulating energy | Gate 0 |
| Q2 fails to clear Q1's extreme within early ticks | Q3 has to fight old resistance AND new levels | Gate 1 |
| Q3 breaks Q2's level then violently snaps back >60% | False breakout / liquidity trap | Gate 2 |
| Q3 is choppy with 3-4+ oscillations after the break | No directional conviction | Gate 3 |
| Q3 breaks first then reverses (trap sequence) | Institutional stop-hunt, not real break | Gate 2 |
| Q3 close is on the wrong side of Q3's midpoint | Q3 reversed direction | Gate 3 |
| Q2 was a violent V-shape (dump then full recovery) | Energy was spent in Q2, nothing left for Q4 | Gate 1 + Gate 2 combination |
| Q1-Q3 total displacement exceeds barrier × 5 | Market over-extended, no fuel left for Q4 | Gate 4 |

---

## 10. Risk Management

- **Auto-pause:** After 2 consecutive losses, the bot pauses and requires manual unpause.
- **Max 1 trade per block:** Cannot over-trade within a single block.
- **Stake size:** User-configurable, minimum $0.35.
- **No martingale:** Losing a trade does NOT increase the next stake.
- **Circuit breaker:** If the user disables the bot, all pending operations stop.

---

## 11. Architecture

### Files to Create

```
server/
├── quadrantBreakStrategy.js    ← The brain (5 gates, pure logic, no side effects)
├── quadrantBreakController.js  ← The executor (trade lifecycle, outcome tracking)
```

### Files to Modify

```
server/
├── blockTracker.js            ← Add per-quadrant OHLC tracking (q1, q2, q3, q4)
├── index.js                   ← Wire up strategy + controller, strategy switching
├── tradeLogger.js             ← Add 'strategy' column to trades table

client/
├── terminal.html              ← Add strategy selector UI
├── js/core/App.js             ← Handle strategy toggle WS messages
```

### Files NOT Modified (Left Untouched)

```
server/
├── botController.js           ← Cipher Swarm brain — unchanged
├── swarmEngine.js             ← Swarm agents — unchanged
├── gatekeeper.js              ← Cipher Swarm gates — unchanged
├── tradingEngine.js           ← Shared trade execution — unchanged
├── derivClient.js             ← WebSocket client — unchanged
├── microStructure.js          ← Momentum calc — unchanged
├── volatilityEngine.js        ← Volatility calc — unchanged
```

### Data Flow

```
Deriv API → tick → blockTracker.update() → per-quadrant OHLC

On Q3 → Q4 transition:
  blockState → quadrantBreakStrategy.evaluate() → { signal, direction, gates }
  
  If signal === 'FIRE':
    → quadrantBreakController → tradingEngine.getProposal() → tradingEngine.executeBuy()
    → tradeLogger.logTrade() → broadcast(trade_executed)
  
  If signal === 'SKIP':
    → log skip reason → broadcast(gate_status) → do nothing
```

### Strategy Switching

```
Active strategy stored in index.js as `activeStrategy = 'swarm' | 'quadrant'`

Tick handler:
  blockTracker.update()     ← ALWAYS runs
  
  if activeStrategy === 'swarm':
    gatekeeper.evaluate()
    botController.onTick()
  
  if activeStrategy === 'quadrant':
    quadrantBreakController.onTick()
```

Both controllers share:
- `blockTracker` (read-only for both)
- `tradingEngine` (for executing trades)
- `tradeLogger` (for recording trades, with `strategy` column)
- `broadcast()` (for sending state to UI)

---

## 12. Data Requirements

The strategy needs the following data per quadrant:

| Field | Type | Description |
|:------|:-----|:------------|
| `q1.open` | number | First tick price in Q1 |
| `q1.high` | number | Highest tick in Q1 |
| `q1.low` | number | Lowest tick in Q1 |
| `q1.close` | number | Last tick price in Q1 |
| `q1.tickCount` | number | Number of ticks in Q1 |
| `q2.open` | number | First tick price in Q2 |
| `q2.high` | number | Highest tick in Q2 |
| `q2.low` | number | Lowest tick in Q2 |
| `q2.close` | number | Last tick price in Q2 |
| `q2.tickCount` | number | Number of ticks in Q2 |
| `q2.tickAtQ1HighClear` | number or null | Tick index in Q2 where price first exceeded Q1.high |
| `q2.tickAtQ1LowClear` | number or null | Tick index in Q2 where price first went below Q1.low |
| `q3.open` | number | First tick price in Q3 |
| `q3.high` | number | Highest tick in Q3 |
| `q3.low` | number | Lowest tick in Q3 |
| `q3.close` | number | Last tick price in Q3 |
| `q3.tickCount` | number | Number of ticks in Q3 |
| `q3.highTick` | number | Tick index within Q3 where the high was made |
| `q3.lowTick` | number | Tick index within Q3 where the low was made |
| `q3.reversalCount` | number | Number of direction changes in Q3 |
| `prevBlock.high` | number | Previous block's highest price |
| `prevBlock.low` | number | Previous block's lowest price |

---

## 13. Evidence Base

This strategy was developed by analyzing 17+ real-time market screenshots. The gate system has been validated against ALL screenshots with:

- **8 winning trades** correctly identified as FIRE ✅
- **5 losing/skip trades** correctly filtered out ✅
- **2 risky trades** correctly filtered out ✅
- **0 false negatives** (no winner would be skipped)
- **0 false positives** (no loser would be fired)

The full screenshot analysis with per-trade gate evaluation is in: `docs/quadrant-break-strategy.md`

---

## 14. Glossary

| Term | Meaning |
|:-----|:--------|
| **Block** | A 5-minute window of price data (300 seconds) |
| **Quadrant** | One quarter of a block (75 seconds) |
| **OHLC** | Open, High, Low, Close — the 4 prices that summarize a period |
| **Gate** | A mathematical check that must PASS for a trade to fire |
| **Sweep** | Price briefly breaks a level to trigger stop-losses, then reverses |
| **Break** | Price pushes through a significant level with conviction |
| **Displacement** | A strong, clean directional move (low choppiness) |
| **V-shape** | Price dumps to one extreme, then immediately reverses to the other |
| **Spring** | A false move against the trend that gathers energy for the real move |
| **Trap** | A false breakout designed to lure traders into the wrong trade |
| **Body/Range Ratio** | How much of a candle is "body" (open-to-close) vs "wick" (high-to-low). High ratio = trending. Low ratio = ranging. |
| **One-Touch** | A contract that pays if price touches the barrier at ANY point before expiry |
| **Barrier** | The target price level for a One-Touch contract |
