# Cipher Swarm Bot — Complete Flow Guide

## How the Bot Decides to Trade (Step by Step)

Every **1 second**, a new price tick arrives. Here's what happens on EVERY tick:

---

### Step 0: Is the Bot Even On?

```
Bot OFF?     → STOP. Nothing happens. No logs. Complete silence.
Bot PAUSED?  → STOP. (2-loss circuit breaker triggered)
In cooldown? → STOP. Log: "⏳ Cooldown active — Xs remaining"
Trade in flight? → STOP. Already executing something.
```

> **You must click ENABLE in the dashboard panel.** If you see "OFF" in the panel, the bot is completely dormant.

---

### Step 1: Micro-Trend Detection (BlockTracker)

Every 60 seconds (on clock-minute boundaries like 17:10:00, 17:11:00, etc.), a 1-minute candle closes.

**Bullish candle (↑):** The candle's close price > its own open price  
**Bearish candle (↓):** The candle's close price < its own open price

The bot checks the **last 2 closed candles:**

| Last 2 candles | macroTrend | 
|---|---|
| ↑↑ | **UP** |
| ↓↓ | **DOWN** |
| ↑↓ | NONE |
| ↓↑ | NONE |

> **Key:** The "last 2" spans across blocks! If the last candle of the previous block was ↑ and the first candle of the new block is also ↑, the trend is UP.

---

### Step 2: Gatekeeper (5 Gates)

**ALL 5 must pass** for the gate to UNLOCK. If ANY ONE fails, the bot does nothing.

#### Gate 1 — Trend (macroTrend)
**What it checks:** Is `macroTrend` UP or DOWN?  
**Passes when:** The last 2 closed 1-minute candles are both bullish OR both bearish  
**Fails when:** `macroTrend = NONE` (mixed candles ↑↓ or ↓↑)  
**Why it exists:** Don't trade when there's no clear directional flow

#### Gate 2 — Temporal (Block Timing)
**What it checks:** How many seconds have passed since the 5-minute block started?  
**Passes when:** `elapsed >= 75 seconds` (Q2 or later in the block)  
**Fails when:** Less than 75 seconds into the block (Q1 — too early)  
**Why it exists:** The first ~75 seconds of a block is noisy. The market needs time to establish direction. Blocks start at XX:X0:00 and XX:X5:00.

**Quadrant timing:**
```
Q1: 0s  - 74s   (LOCKED — too early)
Q2: 75s - 149s  (OPEN for trading)
Q3: 150s - 224s (OPEN for trading)
Q4: 225s - 300s (OPEN for trading)
```

#### Gate 3 — Discount (BYPASSED)
**What it checks:** Nothing. Always passes.  
**V2 change:** This gate was removed because it blocked strong trending moves.

#### Gate 4 — Kill Switches (4 Checks)
If any kill fires, the gate LOCKS:

| Kill | Name | Trigger | Threshold |
|------|------|---------|-----------|
| A | Q1 Sweep No Retrace | Q1 took out prev block high, but price hasn't pulled back below block open or prev Q4 low | — |
| B | Q1 Sweep No Momentum | Q1 sweep happened + retrace happened, but momentum direction isn't aligned with trend | — |
| C | Dead Market | `volRatio < 0.65 AND volTrend = CONTRACTING` | volRatio < 0.65 |
| D | Ranging After Sweep | Q1 sweep + price sitting at block open + momentum neutral | — |

> **Kill C** is the most common one. If the market's recent volatility is MUCH lower than baseline AND shrinking, the bot won't trade.

#### Gate 5 — Trade Limit
**What it checks:** How many trades have been taken in this 5-minute block?  
**Passes when:** `tradeCount < 2`  
**Fails when:** 2 trades already executed in this block  
**Why it exists:** Prevents overtrading in a single block

---

### Step 3: Cooldown Check

If the bot recently:
- **Took a trade** → 60-second cooldown (forces next entry to be a fresh signal)
- **Got rejected by swarm** → 30-second cooldown (avoids spamming proposals)

During cooldown, even if gates are open, the bot waits silently.

---

### Step 4: Proposal Request

If all gates pass AND no cooldown, the bot asks the Deriv API:

> "What's the current price for a 2-minute ONETOUCH contract with a ±2 barrier on V100(1s)?"

The API returns:
- **askPrice:** What you pay (your stake, ~$1)
- **payout:** What you get if you win (~$2.58)
- **impliedProb = askPrice / payout** (~38.8%)

> The `impliedProb` is what the market THINKS the touch probability is. The swarm calculates what it ACTUALLY is and looks for an edge.

---

### Step 5: Swarm Votes (4 Agents)

Each agent answers YES or NO. **3 out of 4** must say YES for a GREEN LIGHT.

#### Agent 1 — Fast Reader (7-tick energy)
**Question:** "Right NOW, is there enough energy to reach the barrier?"  
**How:** Takes the last 7 ticks of price movement → calculates short-term volatility (sigma) → uses GBM formula to estimate touch probability → compares to the market's impliedProb  
**Votes YES when:** `calculatedProb - impliedProb >= 0.03` (3%+ edge)  
**Votes NO when:** Not enough current energy to beat the market price

#### Agent 2 — Steady Hand (60-tick energy)
**Question:** "Is that energy SUSTAINED, not just a blip?"  
**How:** Same math as Fast Reader, but uses 60 ticks (1 minute) of data  
**Votes YES when:** `calculatedProb - impliedProb >= 0.03` (3%+ edge over 60 ticks)  
**Votes NO when:** The longer-term volatility doesn't support the move

#### Agent 3 — Trend Surfer (momentum direction)
**Question:** "Are the last 10 ticks flowing in my direction?"  
**How:** Checks the `momentumScore` from the volatility engine (-1 to +1)  
**Votes YES when:**
- Direction UP and momentumScore > 0.3 (ticks are moving upward)
- Direction DOWN and momentumScore < -0.3 (ticks are moving downward)  
**Votes NO when:** Momentum is flat or opposite to the trade direction

#### Agent 4 — Climate Check (market liveliness)
**Question:** "Is the market alive enough for this trade to work?"  
**How in simple terms:** 
- It compares the **recent movement** (last few minutes) to the **baseline movement** (last hour). This is the `volRatio`.
- If `volRatio` = 1.0, the market is moving at normal speed.
- If `volRatio` = 0.5, the market is dead (moving half as fast as usual).
- If `volRatio` = 2.0, the market is very active.
- It also looks at `volTrend` — is the market speeding up (EXPANDING) or slowing down (CONTRACTING)?
**Votes YES when:** `volRatio >= 0.75 AND volTrend != CONTRACTING` (Market is at least 75% as lively as usual, AND not slowing down).
**Votes NO when:** Market is dead (volRatio < 0.75) or volatility is shrinking.

---

### Step 6: Trade or Reject

| Consensus | Result |
|-----------|--------|
| 4/4 | ✅ GREEN LIGHT — Execute trade |
| 3/4 | ✅ GREEN LIGHT — Execute trade |
| 2/4 | ❌ Rejected — 30s cooldown |
| 1/4 | ❌ Rejected — 30s cooldown |
| 0/4 | ❌ Rejected — 30s cooldown |

If GREEN LIGHT: Execute the ONETOUCH buy → log to database → 60s cooldown  
If REJECTED: Log the rejection → 30s cooldown → try again later

---

## Timing: How Long From Signal to Trade?

Here's the critical timeline:

```
XX:X0:00  5-minute block opens
XX:X1:00  1st micro candle closes (need 2, so not yet)
XX:X2:00  2nd micro candle closes → IF both ↑ → macroTrend = UP
          BUT elapsed = 120s → Q2 → Gate 2 PASSES
          → All gates can pass → proposal → swarm → maybe trade
```

**"How fast do the agents actually think?"**
The agents' brains are **blazing fast**. Here is what happens in that 3rd candle:
1. **At exact 0.0 seconds:** The 2nd candle closes. Gates UNLOCK.
2. **At 0.1 seconds:** The bot asks Deriv for a contract proposal.
3. **At ~0.4 seconds:** Deriv replies with the price.
4. **At 0.401 seconds:** All 4 agents run their math (takes less than 1 millisecond). 
5. **Vote result:**
   - **If YES (3/4):** The bot instantly executes the trade. Total time taken: under 1 second.
   - **If NO (e.g. 2/4):** The bot logs "Swarm rejected" and **goes to sleep for 30 seconds**.

**Why does it wait 30 seconds? And does it keep checking for the next candles?**
If the agents say NO, the bot does **not** check every single second. It goes on a 30-second cooldown. Why? Because if the edge isn't there right now, spamming the API every second won't help and could get us blocked.

After those 30 seconds pass:
- If the gates are **still open** (for example, the 3rd candle is still forming, or the 3rd candle closed bullish too so the trend is still UP), the bot will ask the agents again.
- If the agents say YES this time, it takes the trade (this might be deep into the 3rd or 4th candle).
- But if during that 30 seconds a candle closes bearish and ruins the trend, the gate **locks entirely**, and the bot stops asking the agents until a new trend forms.
1. The first 2 candles might not align (↑↓ = NONE, need to wait for another ↑)
2. A kill-switch might be active
3. Cooldown from a previous trade/rejection
4. Swarm might reject (agents don't see enough edge)

---

## Common Scenarios: "Why Didn't It Trade?"

| You see... | Reason |
|------------|--------|
| No logs at all | **Bot is OFF** — click ENABLE |  
| Micro candles but no Gate log | Gate state didn't change (still LOCKED from before) |
| Gate UNLOCKED but no trade | **Cooldown active** (look for ⏳ log) OR swarm rejected |
| Swarm rejected 0/4 | All agents see low/no edge — market might look trending to you but the math says the barrier won't be touched |
| Swarm rejected 2/4 | Close but not enough — usually Climate Check or Trend Surfer disagree |
| Trend:NONE (micro:↑↓) | One pullback candle broke the streak — see Observation 1 in docs/observations.md |
