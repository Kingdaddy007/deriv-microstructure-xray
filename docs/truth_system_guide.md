# Cipher Truth System: State Recovery & Architecture

This guide explains how to use the "Truth System" built into the **Cipher Trading Terminal** to understand its stable state, recover from regressions, and continue development with confidence.

---

## 1. The "Truth Documents" (Project Root)

These three files in the root directory ([c:\Users\Oviks\OneDrive\Apps\DERIV\touch-edge-system](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system)) are your primary defense against regressions:

### [STATUS.md](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/STATUS.md) (The Master Truth)

*   **Purpose:** Definitive record of what "working" looks like right now.
*   **Contents:** Verified behaviors (Data Pipeline, Charting, Trading), critical function line numbers, and a complete bug fix history.
*   **When to use:** If a new update breaks something that was working (e.g., "The countdown is stuck"), check this file to see the last verified fix and the exact logic that was used.

### [ARCHITECTURE.md](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/ARCHITECTURE.md)

*   **Purpose:** High-level blueprint and core constraints.
*   **Contents:** Data flow diagrams, "Key Architectural Rules" (e.g., the 1000 bar buffer limit), and component maps.
*   **When to use:** To understand how a change affects the whole system before you start coding.

### [DECISIONS.md](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/DECISIONS.md)

*   **Purpose:** Memory of why things are the way they are.
*   **Contents:** Logs of non-obvious choices and **rejected approaches** (to prevent re-litigating old ideas).
*   **When to use:** If you see something that looks "weird" but works (like the multi-pane resizer logic), check here before "cleaning it up."

---

## 2. Terminal Snapshots (Visual Truth)

Visual records of the terminal's state are stored in your configuration directory:
`C:\Users\Oviks\.config\opencode\`

*   **Example:** `trading_terminal_overview_1773633260401.png`
*   **How to use:** Use these to visually compare the current UI against a known-good state. If elements are missing or displaced, these images show the "perfect" layout as of a specific timestamp.

---

## 3. History & Continuation Command

To see your conversation history or continue a past session in the terminal, use:

```powershell
opencode list
```
*(Alternative subcommands depending on version: `opencode chat --list` or `opencode sessions`)*

> [!TIP]
> If you need to recover a specific sequence of thoughts, checking the **conversation logs** in your brain directory (`C:\Users\Oviks\.gemini\antigravity\brain\...`) provides the full AI reasoning behind every change made.

---

## 4. How to Recover from a "Spill"

If you break something that was perfectly fine:

1.  Open **[STATUS.md](file:///c:/Users/Oviks/OneDrive/Apps/DERIV/touch-edge-system/STATUS.md)**.
2.  Find the component that is failing (e.g., "Overlay System").
3.  Check the "Verified Working Behaviors" table to see what the correct logic is.
4.  Navigate to the "Critical Code Paths" section to find the exact function and file that handles that behavior.
5.  Revert the code to match the verified pattern described.
