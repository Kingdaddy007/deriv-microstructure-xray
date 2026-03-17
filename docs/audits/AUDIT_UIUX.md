# UI/UX & VISUAL DESIGN AUDIT — Cipher Trading Terminal

**Auditor:** Anti-Gravity (Designer + Reviewer Mode)
**Date:** 2026-03-16
**Based on:** 4 screenshots (split view, single timeframe, fullscreen grid)

---

## OVERALL ASSESSMENT

**UI Quality Score: 58/100**
**Premium Feel Score: 38/100**

The functional skeleton is solid. The chart data renders cleanly, the overlays communicate real structure, and the layout concept is right. But this does not feel premium. It feels like a working prototype that was styled as it was built — there is no unified design language, the visual hierarchy is weak, and the sidebar looks unfinished compared to professional trading terminals like TradingView, Bookmap, or Deriv's own platform.

The gap between "it works" and "it feels professional" is real here, and it is closeable.

---

## FINDINGS

---

### 1. INFORMATION HIERARCHY — Weak

The sidebar has five competing sections at equal visual weight: PARAMETERS, TRADING, Recent Trades, Advanced Metrics, Research. None of them read as primary. The eye has nowhere to anchor.

**What a trader needs first:** Current price + barrier distance. That is the decision-critical signal. Right now it is buried — the current spot price does not appear in the sidebar at all. The trader has to read the chart to find it.

**What is wrong:**

- "PARAMETERS" and "TRADING" headings are the same size, weight, and colour as everything else
- The barrier input (`2.0`) and ROI (`109`) are the most important trading parameters but have no visual emphasis
- The "CHECKING..." badge sits at the same visual weight as a section header
- `GET QUOTE` is the right primary CTA but it competes visually with `ONETOUCH ▲`, `Touch ▲`, `Touch ▼`, `Float`, `Freeze` — all using similar styling

---

### 2. VISUAL CONSISTENCY — Broken in several places

| Element | Problem |
| --------- | --------- |
| Tab bar (Tick / 5s / 10s...) | Active tab uses a blue pill in normal view. In fullscreen it is replaced by a dropdown. Two different navigation patterns for the same action. |
| Overlay controls (`5m L`, `15m L`, `Mid`, `[3]`, `LIVE`) | Rendered as small badges sitting under the timeframe dropdown with no visual grouping. They look like tags, not controls. |
| `LIVE` badge | Filled pill in fullscreen view, outlined pill in normal view. Inconsistent between layouts. |
| Barrier label | `Barrier | 1623.67` in a cyan box on the price axis in one view, `Barrier 1625.78` with a dashed line in another. Slightly different style across timeframes. |
| Drawing toolbar | Icon-only buttons with no visible tooltips. A trader who has not memorised the icons will not know what H, V, →, /, □, △, T, ■, ✕ mean without hovering. Pure mystery meat navigation. |
| `--` button | Appears next to timeframe dropdowns in multiple places. No label, no tooltip, unclear purpose. |

---

### 3. COLOUR SYSTEM — Inconsistent, not premium

The dark background is the right call for a trading terminal. But colour usage is not disciplined.

**Problems:**

- The block overlays (coloured quadrant boxes) mix muted blue, red-brown, green, and purple. With 4 charts in split view the entire canvas reads as a sea of coloured rectangles. The overlays compete with the candles rather than framing them.
- Cyan (`#00e5ff`) is used for the barrier line. Correct for high visibility. But nothing else in the sidebar uses that cyan — it feels disconnected from the design system.
- `CONFIRM TRADE` (green) and `GET QUOTE` (blue) are the same width and visual weight. They should not be. GET QUOTE is exploratory. CONFIRM TRADE is consequential. Consequential actions should look heavier and more deliberate.
- `CANCEL` is plain text with no button styling. So low-emphasis it reads as disabled.
- "Please log in." in red at the bottom of the sidebar is styled like a form validation error. It is actually the login CTA. It needs to be a button.

---

### 4. TYPOGRAPHY — Functional but unrefined

- Font appears to be Inter. Correct choice for a terminal.
- Section labels (`PARAMETERS`, `TRADING`) are ALL CAPS with no spacing rhythm. They read as dividers, not confident section headers.
- `Cost: $1.00` / `Potential Payout: $1.98` — label and value sit on the same line at slightly different sizes. Not properly grid-aligned.
- The contract description text ("Win payout if Volatility 100 (1s) Index touches...") is small grey text that is barely readable. This is the most important communication to the trader before they confirm a trade. It should be easier to read, not harder.
- Price axis numbers: correct, clean, readable. This part works.

---

### 5. THE TRADING FLOW — Incomplete and unsafe

The current flow is:

```
GET QUOTE → [see price] → CONFIRM TRADE → [executed]
```

**Problems:**

1. **No confirmation before real-money execution.** `CONFIRM TRADE` is one click from a live trade. A finger-slip executes a real financial transaction. No "Are you sure?" modal, no 3-second undo window, nothing.

2. **The proposal expires silently.** Deriv proposals expire in ~60 seconds. The UI shows the quote price but gives no indication of when it expires. A trader can quote, think, come back, and confirm on a stale price — the trade will fail at the API with no warning beforehand.

3. **"Please log in." has no action.** The user must already know this means entering a token somewhere. There is no visible login form, no button, no instruction of any kind.

4. **"CHECKING..." never resolves.** It reads as a loading spinner that is permanently stuck. A trader cannot tell if the system is working or broken.

5. **`ONETOUCH ▲`** — the arrow suggests a toggle or direction, but there is no affordance explaining what it controls or what state it represents.

---

### 6. THE CHART AREA — Strong core, overcrowded overlays

The chart rendering itself is clean. LightweightCharts is doing its job well. Candles are readable. Price scale is correct.

**What works:**

- The `LIVE` badge is a good pattern — clear mode indicator
- The barrier line with label is a genuinely useful overlay
- The split grid concept (comparing timeframes side by side) is smart for multi-timeframe analysis

**What does not work:**

- **Block overlays are too opaque.** The coloured quadrant blocks visually dominate the candles. The candles should be the hero — overlays are support structure. They need to be 30-40% more transparent.
- **Split view panels are too small.** Each pane in the 4-panel layout is roughly 350px wide. Candles are cramped, overlay labels (`5m`, `15m`) overlap the price action, and axes become tight. Needs fewer panes or a per-pane fullscreen toggle.
- **`5m` and `15m` block labels** appear directly on the canvas at the top-left of each block. When adjacent blocks are close together they stack and become illegible.
- **The dashed vertical line** (current time marker?) appears in one screenshot but not others. Its meaning is not labeled.

---

### 7. SIDEBAR — Unfinished

The sidebar is the nerve centre — parameters, analytics, trading — but reads as a vertical list of sections with no hierarchy or breathing room.

**Specific issues:**

- `Touch ▲` and `Touch ▼` — what does the arrow mean? Direction of trade? They look like sort controls on a data table.
- `Float` and `Freeze` are styled identically to the Touch buttons directly above them. A new user cannot tell that these are mode controls, not direction controls.
- Barrier field shows `2.0` with no unit. Is that 2.0 points? 2.0%? Dollars? The label says "Barrier" — this is not enough.
- "ROI %" next to `109` — if this means 109% payout, display it as "Payout: 109%", not "ROI %". Use the trader's language, not the system's language.
- `Advanced Metrics ▸` and `Research ▸ (optional)` look identical to section headers. A user may not know they are clickable.
- The lower half of the sidebar below the trading panel is empty space in most views. This surface could show live analytics, win rate, or a position summary.

---

## PREMIUM FEEL — GAP ANALYSIS

| Dimension | Current State | Premium Standard |
| ----------- | -------------- | ----------------- |
| Visual depth | Flat, uniform dark panels | Subtle panel elevation, border separation, micro-shadows |
| Data density | Important metrics hidden in collapsed sections | Key metrics always visible: price, barrier distance, probability, time remaining |
| Interaction feedback | Buttons click without animation | Subtle press state, loading spinners on async actions |
| Type hierarchy | One weight, one size for most text | 3-level hierarchy: headers / values / captions clearly differentiated |
| Colour intentionality | Colours added per element as needed | Unified palette: 2 accent colours max, semantic colours only |
| Whitespace | Cramped sections, no breathing room | Consistent spacing system (4px or 8px grid) |
| Status communication | "CHECKING..." never resolves, "Please log in" with no action | Clear state badges: Connected / Disconnected / Demo / Live with action prompts |
| Trade safety | One-click real-money execution | Confirm modal or arm-then-fire pattern |

---

## PRIORITIZED FIX LIST

| Priority | Fix | Impact |
| ---------- | ----- | -------- |
| 1 | Add trade confirmation modal — arm/fire pattern or timed confirmation | Prevents accidental financial loss |
| 2 | Add proposal expiry timer — countdown next to cost/payout once quoted | Trader knows when quote is stale |
| 3 | Replace "Please log in." with an actual login UI — token input + connect button | System is unusable without it; red text is not a CTA |
| 4 | Fix the "CHECKING..." badge — show Connected / Demo / Live clearly | Removes permanent loading ambiguity |
| 5 | Reduce overlay opacity by ~35% | Charts become readable under the overlays |
| 6 | Add tooltips to drawing toolbar — every icon needs a label on hover | Mystery meat navigation eliminated |
| 7 | Clarify `Touch ▲` / `Touch ▼` / `Float` / `Freeze` — group with labels | "Direction" group vs "Mode" group, visually separated |
| 8 | Rename "ROI %" to "Payout %" and add barrier units | Trader-facing language, not system language |
| 9 | Add current price + barrier distance to sidebar — always visible | Primary decision data should not require reading the chart |
| 10 | Differentiate GET QUOTE vs CONFIRM TRADE visually — CONFIRM should feel heavier | Action hierarchy matches consequence level |
| 11 | Add per-pane fullscreen toggle in split view | Charts are too small at 4-panel layout |
| 12 | Add spacing system to sidebar — group controls by function with visual dividers | Sidebar reads as a list, not a control panel |

---

## BOTTOM LINE

The charts work. The data is real. The overlay concept is genuinely useful for a trader who understands microstructure. But the interface has been built from the developer's perspective, not the trader's — which is normal for a fast-built tool.

The gap to premium is about 3-4 focused design sessions. Not a rewrite. Not a redesign. Targeted improvements to hierarchy, colour discipline, sidebar layout, and the trade flow would move this from 38 to 70+ on premium feel.

The three highest-leverage changes in order:

1. Trade confirmation modal — safety first
2. Sidebar redesign — hierarchy and breathing room
3. Overlay opacity reduction — let the candles breathe
