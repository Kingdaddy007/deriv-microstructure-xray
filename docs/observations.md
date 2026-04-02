# Cipher Swarm Bot — Live Observations Log

## Observation 1: Pullback Candle Breaks Trend Detection
**Date:** 2026-04-01  
**Status:** Saved for future consideration — not acting yet  

### What happened
During a clear upward expansion, the micro-trend detector showed `↑↓ = NONE` because:
- Candle 1: O:1229.07 C:1230.81 → bullish ↑ ✅
- Candle 2: O:1231.33 C:1230.47 → bearish ↓ ❌ (even though overall price was higher)

The second candle opened higher (gap up) but closed slightly below its own open. The overall move was UP but one pullback/doji candle broke the "2 consecutive bullish" rule.

### The pattern
In real market action, strong uptrends frequently include small red pullback candles:
- Green → Green → **small Red** → Green → Green (trend continues)
- The current bot sees `↑↓` at the red candle and resets to NONE, missing the continuation.

### Possible fixes (not implemented)
1. **"2 out of 3" rule:** Require 2 of the last 3 candles to be bullish + net direction up. Tolerates 1 pullback.
2. **Rising closes:** Compare candle closes to each other (`close[n] > close[n-1]`) instead of requiring each candle to close above its own open.
3. **Hybrid:** Current logic OR rising closes — either condition triggers trend.

### Why we're waiting
- The bot is currently working and producing wins with the strict 2-consecutive rule.
- The strict rule also CORRECTLY prevented bad trades (e.g., 2 consecutive bearish candles that turned out to be a trap).
- Need more observations to know if the false-NONE problem costs us more trades than the strict filter saves us from.

---

## Observation 2: V2 First Live Results — 2/2 Wins
**Date:** 2026-04-01  

### What happened
After V2 deployment, the bot:
1. Detected trend via 2 consecutive ↑ 1m candle closes
2. First swarm check: rejected 2/4 → 30s cooldown (working as designed)
3. After cooldown: GREEN LIGHT 3/4 consensus, FR edge=0.17, SH edge=0.0655
4. Took 2 trades in the block (hit the 2/2 limit gate)
5. Both WON — Profit $1.58 each ($3.16 total)
6. Payout ratio: 2.58x on $1 stake

### What worked well
- Micro-trend detection caught the expansion
- 30s cooldown prevented proposal spam
- Swarm correctly filtered (rejected at 2/4, approved at 3/4)
- Trade limit gate stopped overtrading (2/2)
- Loss counter reset confirmed on wins

---

## Observation 3: Late-Entry Loss — Expansion Exhaustion
**Date:** 2026-04-02  
**Status:** Fixed (V3)

### What happened
Bot took a DOWN trade at the LOW of the 3rd consecutive red candle. The expansion was already spent.

**Sequence:**
1. 2 consecutive ↓ candles → Gate UNLOCKED DOWN
2. Swarm rejected 1/4 → 30s cooldown (correctly — market wasn't ready)
3. Kill switch fired: dead market (volRatio 0.60 < 0.65)
4. After 30s cooldown, gate re-opened, swarm approved 3/4
5. **Steady Hand had NEGATIVE edge (SH=-0.0483)** — 60s energy was gone
6. But 3/4 consensus override let it through → entered at worst point → LOSS

### Root cause
- **30s rejection cooldown was too short** — let the bot re-enter the same exhausted move
- **Steady Hand negative edge was not a hard veto** — the one agent designed to detect exhaustion was overruled by consensus

### Fixes applied (V3)
1. **Rejection cooldown raised: 30s → 60s** — prevents re-entering same move after rejection
2. **Steady Hand veto rule** — if SH edge is negative, trade is rejected regardless of consensus count
3. **Gate 2 (temporal/quadrant) removed** — was redundant with kill-switch Q1 protection

### Why this matters
The bot's philosophy is "no trades > losing trades." Steady Hand exists specifically to answer "is this energy sustained?" A negative answer must be respected. The consensus system should not override the exhaustion detector.

---

## Observation 4: Missed Stair-Step Downtrend
**Date:** 2026-04-02  
**Status:** Saved for future consideration

### What happened
A clear visual downtrend (stair-stepping down over many blocks) produced no trades. Each step had small green pullback candles that broke the "2 consecutive bearish" micro-trend rule.

### Pattern
↓ ↓ ↑ ↓ ↓ ↑ ↓ — single green pullback candles reset trend to NONE every time.

### Possible future fix
"2 of last 3" rule for micro-trend: require 2 of the last 3 candles bearish AND net price direction agrees. Tolerates one pullback.

### Why we're waiting
- The strict 2-consecutive rule also correctly prevented the loss in Observation 3
- Need to fix the immediate exhaustion detection problem first (V3 done)
- The "2 of 3" change needs careful testing — it widens the entry window which could let in bad trades
