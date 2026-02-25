# Phase 0 — Final Statistical Findings (Corrected)

## Date: 2026-02-25

## Data: V75 (1HZ75V), 88,648 ticks (~1 day), reference price ~3,247

---

## 1. Tick Return Distribution

| Metric | Value | Interpretation |
|--------|-------|---------------|
| Mean return | 5.4e-7 | Effectively zero drift |
| Per-tick σ | 1.334e-4 | ~0.013% per second |
| Skewness | 0.0009 | Perfectly symmetric |
| Kurtosis | 3.025 | Almost exactly normal (3.0 = Gaussian) |
| Excess Kurtosis | 0.025 | No fat tails whatsoever |

> **Verdict: Returns are indistinguishable from Gaussian white noise.** This is unusual for financial data (which typically has fat tails). Deriv's synthetic engine appears to use a clean random walk generator.

---

## 2. Autocorrelation

| Lag | Autocorrelation | Significant? |
|-----|----------------|-------------|
| 1 | -0.003 | ❌ No |
| 2 | +0.003 | ❌ No |
| 5 | +0.006 | ❌ No |
| 10 | -0.005 | ❌ No |
| 30 | -0.004 | ❌ No |

> **Verdict: Returns are completely independent.** No serial correlation at any lag. No "momentum" or "mean reversion" patterns exist in V75 at the tick level.

---

## 3. Volatility Regime Analysis

| Metric | Value |
|--------|-------|
| Min σ (120-tick) | 1.024e-4 |
| Max σ (120-tick) | 1.690e-4 |
| Max/Min ratio | **1.7x** |
| P10 σ | 1.220e-4 |
| P90 σ | 1.439e-4 |

> **Verdict: Volatility barely varies.** The P10-to-P90 range is only 1.18x. There is no meaningful "high vol" vs "low vol" regime in V75 1s. This DIRECTLY contradicts the core assumption of most source documents.

### Regime-Conditioned Touch Rates (the critical test)

| Barrier D | Low-Vol Touch+ | High-Vol Touch+ | Difference |
|-----------|---------------|-----------------|-----------|
| 2.0 | 64.0% | 65.2% | +1.2% |
| 3.0 | 51.7% | 50.9% | -0.8% |
| 4.0 | 39.1% | 38.4% | -0.7% |
| 5.0 | 27.3% | 27.2% | -0.1% |

> **Verdict: REGIME CONDITIONING PROVIDES ZERO EDGE on V75.** Low-vol and high-vol windows give essentially identical touch rates. The differences are within noise.

---

## 4. Empirical Touch Rates vs GBM Prediction

| Barrier (abs) | GBM P(touch either) | Empirical P(touch either) | Gap |
|--|--|--|--|
| 1.0 | 83.3% | 100.0% | +16.7% |
| 2.0 | 67.3% | 99.4% | +32.1% |
| 3.0 | 52.7% | 90.0% | +37.3% |
| 5.0 | 29.2% | 52.4% | +23.2% |
| 8.0 | 9.2% | 14.5% | +5.3% |
| 10.0 | 3.5% | 5.4% | +1.9% |

> **Verdict: Empirical touch rate CONSISTENTLY exceeds GBM.** The gap is large (20-37% at typical barriers). This means either: (a) using overlapping windows inflates the count, or (b) the empirical "either direction" includes BOTH up and down touches which is higher than one-directional GBM.

### One-Directional Touch Rates (what you actually trade)

| Barrier D | Touch+ (Up only) | Touch- (Down only) |
|-----------|-----------------|-------------------|
| 2.0 | 64.4% | 61.3% |
| 3.0 | 51.0% | 46.3% |
| 4.0 | 38.7% | 34.2% |
| 5.0 | 28.1% | 24.5% |

> **This is what matters for trading.** When you pick Touch+ with barrier D=3.0, price reaches that barrier ~51% of the time. If Deriv offers ~100% payout (implying 50%), then your edge is ~1%. But after Deriv's 2.4% house cut, you may be underwater.

---

## 5. Where Is Your 103-107% ROI Zone?

You said you trade barriers that give ~103-107% ROI.

- 105% ROI = payout of 2.05x → implied prob = 48.8%
- For Touch+ on V75, a 48.8% hit rate corresponds to barrier D ≈ **3.0 to 3.5**
- NOT D=2.0 (which gives 64% touch rate, which Deriv would price at much lower ROI)

---

## 6. Honest Assessment

### What the data says

1. **V75 is nearly a perfect random walk** — Gaussian, zero autocorrelation, minimal volatility variation
2. **Regime conditioning does NOT help** — volatility barely fluctuates, and when it does, touch rates don't meaningfully change
3. **The GBM formula underestimates touch rates** — but this may be due to how we're comparing (overlapping windows, both directions vs one)
4. **The practical edge question**: If Deriv's model is well-calibrated (and they have every incentive to make it so), the payout they offer already accounts for the true touch rate. Your edge would only exist if Deriv uses a cruder model than the empirical reality.

### What this means for the project

- The "volatility regime" approach (the core idea from most AI sources) has **weak support on V75**
- We should also analyze V100 (which has 100% annualized vol vs V75's 75% — it may show more regime variation)
- The tool can still be useful as a **decision-support system** that shows you the empirical touch rate for YOUR chosen barrier, even if the edge over Deriv is thin
- The primary value may be in **preventing bad trades** (e.g., showing when touch rate at your barrier is well below breakeven)

---

## Next Steps

1. Download and analyze V100 data (higher volatility may show more regime variation)
2. Proceed to build the dashboard — even without a large statistical edge, the tool provides **transparency** into the math behind your trades
3. Focus the tool on the "barrier helper" and "trade filter" use cases rather than claiming a large edge exists
