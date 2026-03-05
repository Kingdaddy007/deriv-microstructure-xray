---
name: debugging_reliability
description: Methodology for diagnosing and fixing complex data-rendering bugs in charting libraries (LWC focus).
---

# Charting Reliability & Data-Stream Debugging Skill

## 1. The Core Philosophy
When a bug takes hours to fix, it is usually because we are **guessing** the cause instead of **capturing** it. In complex charting (Multi-pane/Split mode), the failure usually happens at the boundary where your code hands data to the third-party library.

## 2. The "Black Box" Methodology
If the library (like Lightweight Charts) crashes or empties the chart, you must treat the series methods as a "Black Box" and wrap them.

### Step 1: Wrap the Library Boundary
Overwrite the library's methods (`setData`, `update`) to see what is **actually** being passed in right before the failure.

```javascript
function wrapSeries(series) {
    const originalSetData = series.setData.bind(series);
    series.setData = (data) => {
        console.log("CRITICAL SENTINEL - setData called with:", data);
        // Add your own validation/guards here
        originalSetData(data); 
    };
}
```

### Step 2: Global Error Catching
LWC usually throws `Value is null` or `Value is undefined` when data shape is wrong. Pair the wrapper with a global error listener to identify the *last known call* before the crash.

## 3. Common Charting Pitfalls (Why it was difficult)
We failed for 3 hours because we looked at "Visual Symptoms" (candles disappearing) instead of "Data Requirements".
1. **The Strictly Increasing Rule**: LWC requires `time` to be strictly increasing. If `setData` receives two points with the same timestamp, it may blank out the entire series.
2. **Type Coercion**: Markets often send strings or high-precision numbers. Charting libraries expect clean Numbers.
3. **The Race Condition**: In Split Mode, TFs change so fast that a "Candle" update might arrive while the slot is set to "Tick" mode. If you send Tick data to a Candle series, it crashes.

## 4. The 3-Layer Defense Pattern
To fix these issues permanently, apply this 3-layer architecture:

### Layer 1: The Sanity Filter (Mapping/Normalization)
Coerce every incoming point into a pure, numeric object. Fix common issues (ms vs s timestamps) immediately.

### Layer 2: The Logical Buffer (Deduplication)
Never `push` blindly to a buffer. Always check if the incoming data replaced the previous timeframe.
```javascript
if (last && last.time === newPoint.time) {
    buffer[lastIndex] = newPoint; // Dedupe by replacement
}
```

### Layer 3: The Boundary Guard
The final guard inside the series object itself. Sort by time and dedupe one last time before calling the library's true `setData`.

## 5. Swift Resolution Checklist
When candles disappear:
1. [ ] Check the console for "Value is null" (Library internal crash).
2. [ ] Verify `time` is a Number (Epoch seconds, not MS).
3. [ ] Check for duplicate timestamps in the array.
4. [ ] Ensure the series type (Candle vs Line) matches the data shape.
