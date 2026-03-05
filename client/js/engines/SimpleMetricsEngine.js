import { $, setText } from '../utils/ChartHelpers.js';

/* ================================================================
   SIMPLE METRICS ENGINE
   ================================================================ */

let tickBuf = [];
let textureHistEff = [];
let textureHistFlip = [];
let texturalHysteresis = { current: 'WARMING', candidate: '', count: 0 };
let lastPercentileUpdate = 0;
let cachedThresholds = { eff20: 0, eff80: 0, flip20: 0, flip80: 0 };

export function setTickBufRef(ref) {
    tickBuf = ref;
}

export function resetMetrics() {
    textureHistEff = [];
    textureHistFlip = [];
    texturalHysteresis = { current: 'WARMING', candidate: '', count: 0 };
    lastPercentileUpdate = 0;
}

export function processSimpleMetrics() {
    const N = tickBuf.length;
    if (N < 2) return;

    const currentPrice = tickBuf[N - 1].value;
    const nowSec = tickBuf[N - 1].time;

    // --- 1. IMPULSE METER ---
    const m = Math.min(300, N);
    const mSlice = tickBuf.slice(N - m).map(t => t.value).sort((a, b) => a - b);
    const median = mSlice[Math.floor(m / 2)];
    const currentMag = Math.abs(currentPrice - median);

    let deltas = [];
    for (let i = N - m + 1; i < N; i++) deltas.push(Math.abs(tickBuf[i].value - tickBuf[i - 1].value));
    deltas.sort((a, b) => a - b);
    const thr = deltas.length > 0 ? deltas[Math.floor(deltas.length * 0.8)] : 0;
    const bigThresh = Math.max(thr * 1.5, 0.5);

    let big60 = 0, big120 = 0;
    for (let i = N - 1; i > 0; i--) {
        const dt = nowSec - tickBuf[i].time;
        if (dt > 120) break;
        const dPrice = Math.abs(tickBuf[i].value - tickBuf[i - 1].value);
        if (dPrice >= bigThresh) {
            if (dt <= 60) big60++;
            if (dt <= 120) big120++;
        }
    }

    setText('impulseMag', currentMag.toFixed(2));
    setText('impulseBig60', big60);
    setText('impulseBig120', big120);

    // --- 2. TEXTURE METER ---
    let eff = 0, flipRate = 0;
    const nTicks = [];
    for (let i = N - 1; i >= 0; i--) {
        if (nowSec - tickBuf[i].time <= 120) nTicks.unshift(tickBuf[i].value);
        else break;
    }

    if (nTicks.length >= 2) {
        let pathLen = 0, flips = 0, lastSign = 0;
        for (let i = 1; i < nTicks.length; i++) {
            const d = nTicks[i] - nTicks[i - 1];
            pathLen += Math.abs(d);
            const sign = Math.sign(d);
            if (sign !== 0) {
                if (lastSign !== 0 && sign !== lastSign) flips++;
                lastSign = sign;
            }
        }
        const netDist = Math.abs(nTicks[nTicks.length - 1] - nTicks[0]);
        eff = pathLen > 0 ? (netDist / pathLen) : 0;
        flipRate = flips / nTicks.length;
    }

    textureHistEff.push(eff);
    textureHistFlip.push(flipRate);
    if (textureHistEff.length > 3600) textureHistEff.shift();
    if (textureHistFlip.length > 3600) textureHistFlip.shift();

    if (nowSec - lastPercentileUpdate > 10 && textureHistEff.length >= 120) {
        lastPercentileUpdate = nowSec;
        const sEff = [...textureHistEff].sort((a, b) => a - b);
        const sFlip = [...textureHistFlip].sort((a, b) => a - b);
        const len = sEff.length;
        cachedThresholds.eff20 = sEff[Math.floor(len * 0.2)];
        cachedThresholds.eff80 = sEff[Math.floor(len * 0.8)];
        cachedThresholds.flip20 = sFlip[Math.floor(len * 0.2)];
        cachedThresholds.flip80 = sFlip[Math.floor(len * 0.8)];
    }

    setText('textureEff', eff.toFixed(3));
    setText('textureFlip', flipRate.toFixed(3));

    let candidate = 'MIXED';
    if (textureHistEff.length < 120) {
        candidate = 'WARMING';
    } else {
        const highEff = eff > cachedThresholds.eff80, lowEff = eff < cachedThresholds.eff20;
        const highFlip = flipRate > cachedThresholds.flip80, lowFlip = flipRate < cachedThresholds.flip20;
        if (highEff && lowFlip) candidate = 'FLOW';
        else if (lowEff && highFlip) candidate = 'CHOP';
        else if (lowEff && lowFlip) candidate = 'QUIET';
    }

    if (candidate === texturalHysteresis.candidate) {
        texturalHysteresis.count++;
        if (texturalHysteresis.count >= 8 || candidate === 'WARMING') {
            texturalHysteresis.current = candidate;
        }
    } else {
        texturalHysteresis.candidate = candidate;
        texturalHysteresis.count = 1;
    }

    const tLabel = $('textureLabel');
    if (tLabel) {
        tLabel.textContent = texturalHysteresis.current;
        tLabel.style.color = '#fff';
        switch (texturalHysteresis.current) {
            case 'FLOW': tLabel.style.background = 'rgba(63, 185, 80, 0.2)'; tLabel.style.color = '#3fb950'; break;
            case 'CHOP': tLabel.style.background = 'rgba(248, 81, 73, 0.2)'; tLabel.style.color = '#f85149'; break;
            case 'QUIET': tLabel.style.background = 'rgba(163, 113, 247, 0.2)'; tLabel.style.color = '#a371f7'; break;
            case 'MIXED': tLabel.style.background = 'rgba(255, 255, 255, 0.05)'; break;
            case 'WARMING': tLabel.style.background = 'rgba(210, 153, 34, 0.2)'; tLabel.style.color = '#d29922'; break;
        }
    }
}