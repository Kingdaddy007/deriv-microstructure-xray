# Micro-Structure X-Ray v1.0.0

A high-frequency trading visualization terminal for Deriv, focused on microstructure analysis, liquidity levels, and backtesting.

## 🚀 Features

- **Real-time Visualization**: High-performance charting using Lightweight Charts.
- **Microstructure Overlays**: 5m and 15m block quadrants and liquidity levels (H/L/Mid50).
- **Backtesting Mode**: Scroll back to enter `VIEW` mode. Levels are calculated with a context-aware offset so you can study price reaction.
- **Modular Design**: Clean ES6 module structure for easy maintenance and low token usage.
- **Multi-view Support**: Split-pane grid for comparing timeframes side-by-side.

## 🛠️ Installation

1. **Clone the repository**:

    ```bash
    git clone [repository-url]
    cd touch-edge-system
    ```

2. **Install dependencies**:

    ```bash
    npm install
    ```

3. **Configure Environment**:
    Create a `.env` file in the root directory:

    ```env
    DERIV_TOKEN=your_api_token_here
    APP_ID=your_app_id_here
    ```

4. **Run the application**:

    ```bash
    npm start
    ```

    The dashboard will be available at `http://localhost:8080`.

## 📈 Guide

### LIVE vs VIEW Mode

- **LIVE** (Blue Badge): The chart is at the current edge. Overlays update in real-time.
- **VIEW** (Amber Badge): Triggered when you scroll back more than 1 minute.
  - **Focus Point**: Levels are computed based on historical focus (e.g., 10-15 mins before the visible edge).
  - **Right Context**: Levels are drawn forward to the visible edge so you can see "future" price interaction.

### Controls

- **Sidebar**: Adjust Barrier, ROI, and toggle Overlays.
- **Bottom Toolbar**: Drawing tools (Rectangle, Trendline, etc.) and Color Picker.
- **Tabs**: Switch between single timeframe views, the Split Grid, or the Reach Grid.

## 🧪 Testing

Run unit tests with:

```bash
npm test
```

## ⚠️ Maintenance

- **Tick Buffers**: Capped at 3600 ticks to ensure performance.
- **Memory**: The system is designed for single-session use. Refresh to clear long-term memory.
