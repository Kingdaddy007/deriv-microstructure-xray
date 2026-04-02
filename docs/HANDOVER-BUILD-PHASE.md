# PROJECT HANDOVER: Quadrant Break Strategy (Build Phase)

**To the AI Assistant taking over this workspace:**
Hello! We are starting a new session to begin the **Build Phase** of the "Quadrant Break" trading strategy bot. 

The previous session was entirely dedicated to research, pattern discovery, and architecture planning. We have finalized the strategy logic and the step-by-step build plan. Your job is to read the specs and start writing the code.

---

## 1. Context & Architecture

We are adding a new, independent trading strategy to the existing `touch-edge-system`. 

- **Current Bot:** "Cipher Swarm" (uses agents, voting, consensus).
- **New Bot:** "Quadrant Break" (purely structural, no agents, fast mechanical execution).
- **Goal:** Build the Quadrant Break bot as a new controller and strategy engine, and wire it up to the existing dashboard so the user can toggle between "Cipher Swarm" and "Quadrant Break".

The physical infrastructure (Deriv WebSocket, tick feed, charting, trading execution loop, trade database) is already built and handles the current Cipher Swarm bot. You are adding a new brain and a new controller that shares those resources.

## 2. Required Reading (Do this first)

Before you write any code, you MUST use your `view_file` tool to read these two documents. They contain all the rules and step-by-step instructions.

1. **The Strategy Bible:** `docs/QUADRANT_BREAK_SPEC.md`
   *Read this to understand exactly what the bot is supposed to do, how the 5 "Gates" work, and what the "No Trade > Bad Trade" philosophy means.*

2. **The Build Plan:** `docs/quadrant-break-implementation-plan.md`
   *Read this to see the 6 exact components we need to build and modify. All open questions about barrier sizes and durations have already been resolved here.*

## 3. Your First Task

Once you have read the two documents above, begin executing **Component 1** from the implementation plan: augmenting `server/blockTracker.js` to track `q1`, `q2`, `q3`, and `q4` per-quadrant OHLC. 

Create a task list to track your progress and let's get building!
