---
name: Lightweight Charts Desync Debug
description: A workflow for fixing overlay coordinate collapse (w0.0) caused by logical index desynchronization in Lightweight Charts.
---

# Lightweight Charts Desync Debug

## Objective

To resolve rendering bugs in custom HTML5 Canvas overlays built on top of Lightweight Charts, specifically when coordinate mapping functions like `timeScale().logicalToCoordinate()` or `timeToCoordinate()` fail, return `null`, or evaluate entirely to `0.0`.

## 1. Context & Goal

When drawing custom overlays (like time block sessions or quadrant boxes) on Lightweight Charts, developers often use the chart's timeScale to convert timestamps into X-pixel coordinates. A common severe bug is the "Zero-Width Collapse" — where height calculations work perfectly, but width calculations evaluate to exactly `0.0` or drift wildly. The goal of this skill is to immediately diagnose and fix the array state desynchronization that causes this.

## 2. Data Shape First

- **Incoming Data (The Problem)**: An overlay attempting to map a timestamp to an X-coordinate by doing a binary search on a global data buffer (e.g., `globalTickArray`), finding an index, and passing that index to `timeScale().logicalToCoordinate(idx)`.
- **Outgoing Result (The Fix)**: The overlay must rely exclusively on a localized, exact clone of the array currently rendered by the chart series (`ChartSlot._chartData`).

## 3. Step-by-Step Workflow

**Step 1: Verify the Bug Signature**
If the overlay is not drawing correctly, instrument the exact internal canvas drawing loop (e.g., `_drawBlocks`) with granular diagnostic logs.

- Instead of just checking if `width <= 0`, log exactly *why*: `skips.push(\`w${w}(x1=${x1}, x2=${x2}, idx1=${i1}, idx2=${i2})\`)`.
- If `x1` and `x2` are identical or zero, but `idx1` and `idx2` are correct, you have a **Logical Index Desync**.

**Step 2: Trace the Data Source**
Identify where the overlay gets the array it uses for binary searching timestamps (`lowerBoundTime(data, targetTime)`).

- If it pulls from a global state variable (like a raw WebSocket history dump) that has *not* been perfectly synchronized with `series.setData()`, this is the root cause. Lightweight Charts assigns internal logical indices (0, 1, 2...) strictly based on the array length passed to `setData`.

**Step 3: Implement Local State Caching**
Inside the wrapper class that manages the `LightweightCharts.createChart` instance (e.g., a `ChartSlot` class), introduce a synchronized clone:

1. Add `this._chartData = []` to the constructor.
2. In `setData(data)`, add `this._chartData = [...data];` immediately after `this.series.setData(data)`.
3. In `update(point)`, push or replace the point in `this._chartData` identically to how `this.series.update(point)` handles it.

**Step 4: Reroute the Overlay**
Modify the overlay's data-fetching method (e.g., `overlay.getData()`) to return `chartSlot._chartData` instead of the global array. This ensures the indices found by the overlay's binary search 100% match the indices the chart's `timeScale` expects.

## 4. Verification

- The overlay coordinates should instantly snap to the correct bar edges.
- Print your debug text array to the screen one last time. `width` should now calculate to positive pixel values (e.g., `w14.5`) instead of `w0.0`.
- Once verified, remove the debug text and visual testing backgrounds from the canvas. Ensure cache busters (like `?v=24`) are bumped if working in a standard web environment.

## 5. Anti-Patterns

- **DO NOT** attempt to "fix" the zero-width bug by adding mathematical arbitrary offsets to `x1` or `x2`. The coordinates are broken securely at the logical level.
- **DO NOT** use `timeToCoordinate()` as a permanent fallback for bar-edge anchoring. Use `logicalToCoordinate()` for precise, TradingView-feel bar-edge alignment, falling back to time-based midpoints only if logical bounds fail.
- **DO NOT** guess the logic. Always render the math variables on the canvas directly to see what the numbers are actually doing before rewriting code.
