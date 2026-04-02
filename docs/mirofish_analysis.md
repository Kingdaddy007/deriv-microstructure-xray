# MiroFish — Research Brief & Cipher Integration Assessment

**Assessed by:** Anti-Gravity
**Date:** 2026-03-30
**Context:** Cipher Trading Terminal (`touch-edge-system`) on Deriv Synthetic Indices

---

## What MiroFish Is (Plain English)

MiroFish is a **swarm intelligence engine**. The idea: instead of running one predictive model and getting one answer, you spawn **thousands of AI agents**, each with a unique personality, memory, and behavior. You feed them a seed (a news event, a market signal, a policy change) and you watch how they collectively react over simulated time.

The prediction doesn't come from a formula — it **emerges** from the crowd behavior.

> Think of it as: *"How would 10,000 people with different risk tolerances and personalities react to this market event?"* — and then you observe what the crowd ends up doing.

### The Technical Stack (Simplified)

```
INPUT (seed data: news, signals, reports)
       ↓
GraphRAG → Knowledge Graph (extracts relationships from seed)
       ↓
Agent Generator → 1,000s of AI agents with unique personas + persistent memory
       ↓
OASIS Simulation Engine:
  ├── Time Engine        ← controls when agents activate (realistic pacing)
  ├── Environment Server ← shared state: what has happened, what is visible
  ├── RecSys             ← what content each agent "sees" (like a social feed)
  └── Scalable Inferencer← batches LLM calls across all agents
       ↓
Simulation Loop (observe → reason → act → feedback)
       ↓
OUTPUT: emergent collective behavior = prediction
```

### Key Properties

| Property | Detail |
| --- | --- |
| **Scale target** | 1 million agents |
| **Built on** | OASIS by CAMEL-AI + GraphRAG + Zep (memory) |
| **Created by** | Undergraduate student, 10 days of vibe coding |
| **Primary use** | Simulating social/market reaction to events |
| **Known weakness** | Agent bias + herd effects at low agent counts (<10k) |
| **Honest caveat** | Not a crystal ball. A rehearsal engine. |

---

## The Core Principle Worth Stealing

MiroFish's power isn't in the complexity of any single component.

**The core idea is:** *Replace a single model's prediction with an emergent signal from many independent agents exercising collective behavior.*

This principle can be scaled down dramatically without needing thousands of agents, LLM APIs, or complex infrastructure. The spirit of the idea is:

> **"Don't ask one thing. Ask many things with different personalities, let them interact, and look at what they agree on."**

---

## Cipher Trading Terminal — Context Check

Before suggesting integrations, here's what Cipher already has:

| What Cipher Does | Relevance |
| --- | --- |
| GBM probability (single model) | **↑ This is exactly what MiroFish replaces** |
| Empirical probability (historical reach rate) | Good ground truth |
| Volatility regime detection | Good state signal |
| Edge = model prob − implied prob | **This is where multi-agent thinking applies** |
| Touch/No-Touch only (binary outcome) | Simplifies the agent decision space |
| Synthetic indices (pure mathematical process) | *Different from human sentiment — important caveat below* |

> [!IMPORTANT]
> **Critical difference:** MiroFish simulates **human crowd behavior** reacting to events. Deriv Volatility indices are **mathematically generated synthetic prices** — there are no human market participants reacting to news. The core sentiment-simulation angle of MiroFish doesn't directly translate.
> 
> **BUT** — the underlying principle (multiple independent estimators with different assumptions, whose disagreement/agreement generates a signal) maps very cleanly onto what Cipher already does.

---

## Three Integration Ideas (Scaled Down, Unique to Your Context)

### Idea 1: Multi-Agent Probability Consensus (Swarm Edge)

**The MiroFish Principle Applied:** Instead of one edge score, run **N mini-agents** — each with a different set of parameters/assumptions — and use their **agreement/disagreement as the signal**.

**How it works in Cipher:**

Right now: `edge = GBM_prob − implied_prob`

With swarm consensus:
```
Agent A (aggressive): edge using tight volatility window (10s)
Agent B (neutral):    edge using medium volatility window (30s)  
Agent C (cautious):   edge using wide volatility window (60s)
Agent D (contrarian): edge using inverted regime signal
Agent E (historical): edge using pure empirical reach rate

Consensus Score = how many agents agree there IS an edge?
Agreement = HIGH CONFIDENCE entry
Disagreement = stay out (noisy regime)
```

**Result:** You don't just know *if* there's an edge. You know *how confident the swarm is* in the edge. That's the MiroFish idea: **emergent signal from collective perspective.**

**Build complexity:** Low. All the data is already there. You're just running your existing `edgeCalculator` with different window configs and aggregating the votes.

---

### Idea 2: Regime Agent Memory (Persistent Behavioral Context)

**The MiroFish Principle Applied:** MiroFish agents have **persistent memory** — they remember what happened and it affects how they behave next. Cipher's current regime detection is **stateless per tick** — it sees the current volatility ratio, calls it expanding/contracting, and that's it.

**The upgrade:** Give your regime engine a memory buffer. The "agent" is your volatility engine. Its current "personality" is shaped by its recent history.

```
Current behavior:
  volt_ratio > 1.2 → "expanding"
  
With regime memory:
  "Expanding for 3+ consecutive 5m blocks" → SUSTAINED_EXPANSION
  "Flipped between expanding/contracting 4x in 30m" → CHAOTIC
  "Stable for 20+ consecutive candles" → DORMANT (breakout risk)
  "Regime just transitioned from stable → expanding" → EARLY_MOMENTUM
```

**Result:** Your regime signal stops being a point-in-time label and becomes a **behavioral context** — which directly feeds your entry logic. "I won't trade TOUCH in CHAOTIC regime" is a rule you now can enforce.

**Build complexity:** Low-Medium. Extend `volatilityEngine.js` with a circular buffer of regime states. No external dependencies.

---

### Idea 3: Pre-Trade Scenario Rehearsal (Micro-Simulation Before Every Trade)

**The MiroFish Principle Applied:** MiroFish "rehearses the future" before it happens. You can do the same — but in milliseconds, before each trade execution.

**How it works in Cipher:**

Before a user clicks TRADE, run a **5-agent micro-simulation** using the last N ticks:

```
Input: current tick state, barrier distance, contract duration

Agent 1 (GBM pessimist):   What's the worst-case reach probability?
Agent 2 (GBM optimist):    What's the best-case reach probability?
Agent 3 (Empirical):       What does history say at this distance/vol combo?
Agent 4 (Trend follower):  Is price moving toward or away from the barrier?
Agent 5 (Vol regime):      Is this a high-conviction or ambiguous moment?

Output:
  ✅ 4/5 agents agree → GREEN confidence ring on TRADE button
  ⚠️ 3/5 agents agree → AMBER ring
  ❌ 2/5 or fewer    → RED ring (still tradeable, but flagged)
```

**Result:** The TRADE button becomes a **swarm-confidence indicator**. You don't block the trade — you just surface the pre-rehearsal result as a visual signal. The trader decides. The system advises.

**Build complexity:** Medium. The agent logic is mostly math you already have. The main work is wiring the confidence output to the UI and running the mini-simulation on proposal fetch (which has a natural latency window already).

---

## Honest Assessment

| Question | Answer |
| --- | --- |
| Should you clone MiroFish? | No. Overkill. Requires LLM APIs. Designed for social systems. |
| Is the core principle useful to Cipher? | **Yes, strongly.** Multiple-perspective consensus is directly applicable. |
| Which idea to prioritize? | **Idea 1 (Swarm Edge)** — lowest complexity, highest signal value |
| Will this work on synthetic indices? | Yes — because it's about your model diversity, not social sentiment |
| Can you build this solo? | Yes. All three ideas use only existing Cipher data and math |

---

## Recommended Next Step

**Idea 1 first.** It's 80% already built — your `edgeCalculator.js` and `volatilityEngine.js` already compute the components. You'd write a `swarmEdge.js` that runs 4-5 edge variants and returns a consensus score. Then surface that in the TradingPanel as a confidence indicator alongside the current edge.

That's MiroFish's core principle — smaller, faster, grounded in your actual data, unique to your context.

---

*Note: The full MiroFish repo is at `github.com/666ghj/MiroFish`. Built on CAMEL-AI's OASIS framework. If you ever want the full-scale version for a research/analytics product (not trading), that's the right tool.*
