/**
 * Audio feature analysis for the Audio Intelligence panel.
 *
 * This is a port of DRMVYZ's offline feature pass (src/features/musicIntelligence/offlineTrackAnalyzer.ts and the per-bar aggregation
 * in musicalGridAnalysis.ts): the same radix-2 FFT, the same band edges and curve normalization, the same chroma accumulation and
 * Krumhansl-Schmuckler key detection, and the same per-bar measurements. Beats and bars come from the Rekordbox beat grid, as DRMVYZ
 * does when an imported grid is present, so no tempo detection is done here.
 */

export interface FeaturePoint { timeSec: number; value: number }
export type FeatureCurve = FeaturePoint[];
export interface ChromaFrame { timeSec: number; values: number[] }

export const BAND_NAMES = ['Sub', 'Bass', 'LMid', 'Mid', 'High', 'Air'] as const;
const BAND_EDGES: Array<[number, number]> = [[20, 60], [60, 250], [250, 1000], [1000, 4000], [4000, 10000], [10000, 20000]];

const FFT_SIZE = 2048;
const HOP_SIZE = 1024;
const FEATURE_INTERVAL_SEC = 0.05;
const CHROMA_INTERVAL_SEC = 0.25;
const CHROMA_DECAY = 0.999;
const YIELD_EVERY_FRAMES = 256;
const EPS = 1e-9;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface BarWindow { barIndex: number; startSec: number; endSec: number }

export interface BarMeasurements {
  barIndex: number;
  startSec: number;
  endSec: number;
  meanEnergy: number;
  peakEnergy: number;
  energySlope: number;
  dynamicRange: number;
  bassAverage: number;
  midAverage: number;
  highAverage: number;
  spectralFlux: number;
  spectralCentroid: number;
  spectralComplexity: number;
  overallTransientDensity: number;
  lowFrequencyOnsetDensity: number;
  midFrequencyOnsetDensity: number;
  highFrequencyOnsetDensity: number;
  silenceRatio: number;
  chromaSummary: number[];
  harmonicChange: number;
}

export interface AudioFeatureAnalysis {
  durationSec: number;
  sampleRate: number;
  /** Seconds between stored points. */
  intervalSec: number;
  times: Float32Array;
  /** Per band, raw FFT average. */
  bands: Float32Array[];
  /** Per band, divided by that band's 95th percentile and clamped to 1. */
  bandsNormalized: Float32Array[];
  /** Normalized to the 95th percentile, 0 to 1. */
  energy: Float32Array;
  shortTerm: Float32Array;
  longTerm: Float32Array;
  rms: Float32Array;
  peak: Float32Array;
  crest: Float32Array;
  flux: Float32Array;
  delta: Float32Array;
  percentile: Float32Array;
  complexity: Float32Array;
  centroid: Float32Array;
  spread: Float32Array;
  rolloff: Float32Array;
  flatness: Float32Array;
  bars: BarMeasurements[];
  chroma: number[];
  key: { tonic: string | null; mode: 'major' | 'minor' | null; confidence: number };
}

export interface AnalyzeOptions {
  /** One entry per bar, from the beat grid. When empty, fixed 2-second windows are used. */
  bars?: BarWindow[];
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

function abortError(): Error { const error = new Error('Audio analysis was cancelled.'); error.name = 'AbortError'; return error; }
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
const yieldToUi = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => setTimeout(() => (signal?.aborted ? reject(abortError()) : resolve()), 0));

/** Radix-2 FFT of one Hann-windowed frame; returns magnitudes for bins 0 to N/2. */
export function fftMagnitudes(samples: Float32Array, N: number, start: number): Float32Array {
  const log2N = Math.round(Math.log2(N));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const sample = samples[start + i] ?? 0;
    const hann = 0.5 - 0.5 * Math.cos(6.283185307179586 * i / (N - 1));
    let rev = 0; let x = i;
    for (let b = 0; b < log2N; b++) { rev = (rev << 1) | (x & 1); x >>= 1; }
    re[rev] = sample * hann;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const ang = -6.283185307179586 / len;
    const baseRe = Math.cos(ang);
    const baseIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wRe = 1; let wIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const uRe = re[i + j]; const uIm = im[i + j];
        const vRe = re[i + j + halfLen] * wRe - im[i + j + halfLen] * wIm;
        const vIm = re[i + j + halfLen] * wIm + im[i + j + halfLen] * wRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + halfLen] = uRe - vRe; im[i + j + halfLen] = uIm - vIm;
        const nextRe = wRe * baseRe - wIm * baseIm;
        wIm = wRe * baseIm + wIm * baseRe;
        wRe = nextRe;
      }
    }
  }
  const half = (N >> 1) + 1;
  const mags = new Float32Array(half);
  const scale = 2 / N;
  for (let i = 0; i < half; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * scale;
  return mags;
}

function bandSum(mags: Float32Array, loHz: number, hiHz: number, sampleRate: number, N: number): number {
  const binLo = Math.max(0, Math.floor(loHz * N / sampleRate));
  const binHi = Math.min(mags.length - 1, Math.ceil(hiHz * N / sampleRate));
  if (binHi <= binLo) return 0;
  let s = 0;
  for (let i = binLo; i <= binHi; i++) s += mags[i];
  return s / (binHi - binLo + 1);
}

function spectralShape(mags: Float32Array, sampleRate: number, N: number) {
  let weighted = 0; let total = 0;
  for (let i = 0; i < mags.length; i++) { const hz = i * sampleRate / N; weighted += hz * mags[i]; total += mags[i]; }
  const centroid = total > 1e-10 ? weighted / total : 0;
  let variance = 0; let cumulative = 0; let rolloff = 0;
  for (let i = 0; i < mags.length; i++) {
    const hz = i * sampleRate / N;
    variance += mags[i] * (hz - centroid) ** 2;
    cumulative += mags[i];
    if (rolloff === 0 && total > 1e-10 && cumulative >= total * 0.85) rolloff = hz;
  }
  const spread = total > 1e-10 ? Math.sqrt(variance / total) : 0;
  let logSum = 0;
  for (let i = 1; i < mags.length; i++) logSum += Math.log(mags[i] + 1e-12);
  const arithmetic = mags.length > 1 ? total / mags.length : 0;
  const flatness = arithmetic > 1e-12 ? Math.exp(logSum / (mags.length - 1)) / arithmetic : 0;
  return { centroid, spread, rolloff, flatness };
}

function spectralFlux(mags: Float32Array, prev: Float32Array): number {
  let flux = 0;
  const len = Math.min(mags.length, prev.length);
  for (let i = 0; i < len; i++) { const diff = mags[i] - prev[i]; if (diff > 0) flux += diff; }
  return flux;
}

function frameRms(samples: Float32Array, start: number, length: number): number {
  let sum = 0; let count = 0;
  const end = Math.min(samples.length, start + length);
  for (let i = start; i < end; i++) { sum += samples[i] * samples[i]; count++; }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function framePeak(samples: Float32Array, start: number, length: number): number {
  let peak = 0;
  const end = Math.min(samples.length, start + length);
  for (let i = start; i < end; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
  return peak;
}

function accumulateChroma(mags: Float32Array, acc: Float32Array, sampleRate: number, N: number, capture: boolean): number[] | null {
  for (let i = 0; i < 12; i++) acc[i] *= CHROMA_DECAY;
  const frame = capture ? new Float32Array(12) : null;
  for (let bin = 1; bin < mags.length; bin++) {
    const hz = bin * sampleRate / N;
    if (hz < 50 || hz > sampleRate / 2) continue;
    const pc = ((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12;
    acc[pc] += mags[bin] ?? 0;
    if (frame) frame[pc] += mags[bin] ?? 0;
  }
  if (!frame) return null;
  const total = frame.reduce((sum, value) => sum + value, 0);
  return total > 1e-10 ? Array.from(frame, (value) => value / total) : Array.from(frame);
}

function pearson(a: ArrayLike<number>, b: number[]): number {
  const n = a.length;
  let sumA = 0; let sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n; const meanB = sumB / n;
  let num = 0; let varA = 0; let varB = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - meanA; const db = b[i] - meanB; num += da * db; varA += da * da; varB += db * db; }
  const denom = Math.sqrt(varA * varB);
  return denom < 1e-10 ? 0 : num / denom;
}

/** Krumhansl-Schmuckler key detection from accumulated chroma. */
export function detectKey(chroma: ArrayLike<number>): AudioFeatureAnalysis['key'] {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum < 1e-10) return { tonic: null, mode: null, confidence: 0 };
  const normalized = Array.from({ length: 12 }, (_, i) => chroma[i] / sum);
  let best = -Infinity; let root = 0; let mode: 'major' | 'minor' = 'major';
  for (let r = 0; r < 12; r++) {
    const rotated = Array.from({ length: 12 }, (_, i) => normalized[(i + r) % 12]);
    const major = pearson(rotated, MAJOR_PROFILE);
    const minor = pearson(rotated, MINOR_PROFILE);
    if (major > best) { best = major; root = r; mode = 'major'; }
    if (minor > best) { best = minor; root = r; mode = 'minor'; }
  }
  return { tonic: NOTE_NAMES[root] ?? null, mode, confidence: clamp01((best + 1) / 2) };
}

function normalize(values: number[]): Float32Array {
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  return Float32Array.from(values, (value) => (p95 < 1e-8 ? value : Math.min(1, value / p95)));
}

function curveOf(times: Float32Array, values: ArrayLike<number>): FeatureCurve {
  return Array.from(times, (timeSec, index) => ({ timeSec, value: values[index] }));
}

function sampleCurveAt(curve: FeatureCurve, timeSec: number): number {
  if (curve.length === 0 || !Number.isFinite(timeSec)) return 0;
  if (timeSec <= curve[0].timeSec) return curve[0].value;
  if (timeSec >= curve[curve.length - 1].timeSec) return curve[curve.length - 1].value;
  let lo = 0; let hi = curve.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (curve[mid].timeSec <= timeSec) lo = mid; else hi = mid; }
  const a = curve[lo]; const b = curve[hi];
  const span = b.timeSec - a.timeSec;
  return span <= EPS ? a.value : a.value + (b.value - a.value) * clamp01((timeSec - a.timeSec) / span);
}

function valuesInWindow(curve: FeatureCurve, start: number, end: number): number[] {
  if (curve.length === 0 || end <= start) return [];
  const values = [sampleCurveAt(curve, start)];
  for (const point of curve) if (point.timeSec > start && point.timeSec < end) values.push(point.value);
  values.push(sampleCurveAt(curve, end));
  return values;
}

function percentileOf(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)))] ?? 0;
}

function averageChroma(frames: ChromaFrame[], start: number, end: number): number[] {
  const selected = frames.filter((frame) => frame.timeSec >= start && frame.timeSec < end && frame.values.length === 12);
  if (selected.length === 0) return [];
  const result = new Array<number>(12).fill(0);
  for (const frame of selected) for (let i = 0; i < 12; i++) result[i] += Math.max(0, frame.values[i] ?? 0);
  const total = result.reduce((sum, value) => sum + value, 0);
  return total <= EPS ? result : result.map((value) => value / total);
}

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== 12 || b.length !== 12) return 0;
  let dot = 0; let normA = 0; let normB = 0;
  for (let i = 0; i < 12; i++) { dot += a[i] * b[i]; normA += a[i] ** 2; normB += b[i] ** 2; }
  return normA <= EPS || normB <= EPS ? 0 : clamp01(1 - dot / Math.sqrt(normA * normB));
}

interface MeasurementCurves {
  energy: FeatureCurve; bass: FeatureCurve; mid: FeatureCurve; high: FeatureCurve; flux: FeatureCurve; centroid: FeatureCurve;
  complexity: FeatureCurve; transient: FeatureCurve; lowOnset: FeatureCurve; midOnset: FeatureCurve; highOnset: FeatureCurve; silence: FeatureCurve;
  chroma: ChromaFrame[];
}

/** DRMVYZ's per-bar measurements, computed over each bar window. */
function measureBars(windows: BarWindow[], curves: MeasurementCurves, durationSec: number): BarMeasurements[] {
  const result: BarMeasurements[] = [];
  let previous: number[] = [];
  for (const window of windows) {
    if (!Number.isFinite(window.startSec) || !Number.isFinite(window.endSec) || window.endSec <= window.startSec) continue;
    const at = (curve: FeatureCurve) => valuesInWindow(curve, window.startSec, window.endSec);
    const energy = at(curves.energy);
    const transient = at(curves.transient); const low = at(curves.lowOnset); const midO = at(curves.midOnset); const high = at(curves.highOnset);
    const density = (values: number[]) => (values.length ? values.filter((value) => value >= 0.22).length / values.length : 0);
    const chromaSummary = averageChroma(curves.chroma, window.startSec, window.endSec);
    const firstHalf = energy.slice(0, Math.max(1, Math.floor(energy.length / 2)));
    const secondHalf = energy.slice(Math.max(1, Math.floor(energy.length / 2)));
    result.push({
      barIndex: window.barIndex,
      startSec: Math.max(0, window.startSec),
      endSec: Math.max(window.startSec, Math.min(durationSec, window.endSec)),
      meanEnergy: mean(energy),
      peakEnergy: energy.length ? Math.max(...energy) : 0,
      energySlope: clamp01(0.5 + (mean(secondHalf) - mean(firstHalf)) * 0.5) * 2 - 1,
      dynamicRange: clamp01(percentileOf(energy, 0.9) - percentileOf(energy, 0.1)),
      bassAverage: mean(at(curves.bass)),
      midAverage: mean(at(curves.mid)),
      highAverage: mean(at(curves.high)),
      spectralFlux: mean(at(curves.flux)),
      spectralCentroid: mean(at(curves.centroid)),
      spectralComplexity: mean(at(curves.complexity)),
      overallTransientDensity: density(transient),
      lowFrequencyOnsetDensity: density(low),
      midFrequencyOnsetDensity: density(midO),
      highFrequencyOnsetDensity: density(high),
      silenceRatio: clamp01(mean(at(curves.silence))),
      chromaSummary,
      harmonicChange: cosineDistance(previous, chromaSummary),
    });
    previous = chromaSummary;
  }
  return result;
}

/** Analyses mono samples. Yields to the UI regularly and stops when the signal aborts. */
export async function analyzeAudioFeatures(samples: Float32Array, sampleRate: number, options: AnalyzeOptions = {}): Promise<AudioFeatureAnalysis> {
  const { signal, onProgress } = options;
  const durationSec = samples.length / sampleRate;
  const totalFrames = samples.length >= FFT_SIZE ? Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1 : 0;
  const captureStride = Math.max(1, Math.round(FEATURE_INTERVAL_SEC * sampleRate / HOP_SIZE));
  const chromaStride = Math.max(1, Math.round(CHROMA_INTERVAL_SEC * sampleRate / HOP_SIZE));
  const times: number[] = [];
  const bandRaw: number[][] = BAND_NAMES.map(() => []);
  const rawEnergy: number[] = []; const shortTerm: number[] = []; const rms: number[] = []; const peak: number[] = [];
  const fluxRaw: number[] = []; const centroidRaw: number[] = []; const spreadRaw: number[] = []; const rolloffRaw: number[] = []; const flatnessRaw: number[] = [];
  const complexityRaw: number[] = []; const transientRaw: number[] = []; const lowOnsetRaw: number[] = []; const midOnsetRaw: number[] = []; const highOnsetRaw: number[] = [];
  const bassRaw: number[] = []; const midRaw: number[] = []; const highRaw: number[] = [];
  const chromaFrames: ChromaFrame[] = [];
  const chromaAcc = new Float32Array(12);
  let prevMags = new Float32Array((FFT_SIZE >> 1) + 1);
  let prevBass = 0; let prevMid = 0; let prevHigh = 0; let ema = 0;

  for (let frame = 0; frame < totalFrames; frame++) {
    const offset = frame * HOP_SIZE;
    const timeSec = offset / sampleRate;
    const mags = fftMagnitudes(samples, FFT_SIZE, offset);
    const energy = bandSum(mags, 20, 20000, sampleRate, FFT_SIZE);
    const bass = bandSum(mags, 60, 250, sampleRate, FFT_SIZE);
    const mid = bandSum(mags, 250, 4000, sampleRate, FFT_SIZE);
    const high = bandSum(mags, 4000, 20000, sampleRate, FFT_SIZE);
    const flux = spectralFlux(mags, prevMags);
    const lowOnset = Math.max(0, bass - prevBass); const midOnset = Math.max(0, mid - prevMid); const highOnset = Math.max(0, high - prevHigh);
    const transient = flux * 0.5 + lowOnset * 0.28 + midOnset * 0.12 + highOnset * 0.10;
    const total = bass * 4 + mid * 4 + high * 4 + 1e-8;
    const complexity = 1 - Math.max(bass * 4, mid * 4, high * 4) / total;
    ema = 0.1 * energy + 0.9 * ema;
    if (frame % captureStride === 0 || frame === totalFrames - 1) {
      const shape = spectralShape(mags, sampleRate, FFT_SIZE);
      times.push(timeSec);
      BAND_EDGES.forEach(([lo, hi], index) => bandRaw[index].push(bandSum(mags, lo, hi, sampleRate, FFT_SIZE)));
      rawEnergy.push(energy); shortTerm.push(ema); rms.push(frameRms(samples, offset, FFT_SIZE)); peak.push(framePeak(samples, offset, FFT_SIZE));
      fluxRaw.push(flux); centroidRaw.push(shape.centroid); spreadRaw.push(shape.spread); rolloffRaw.push(shape.rolloff); flatnessRaw.push(shape.flatness);
      complexityRaw.push(complexity); transientRaw.push(transient); lowOnsetRaw.push(lowOnset); midOnsetRaw.push(midOnset); highOnsetRaw.push(highOnset);
      bassRaw.push(bass); midRaw.push(mid); highRaw.push(high);
    }
    const chroma = accumulateChroma(mags, chromaAcc, sampleRate, FFT_SIZE, frame % chromaStride === 0 || frame === totalFrames - 1);
    if (chroma) chromaFrames.push({ timeSec, values: chroma });
    prevMags = mags; prevBass = bass; prevMid = mid; prevHigh = high;
    if (frame > 0 && frame % YIELD_EVERY_FRAMES === 0) {
      onProgress?.(frame / Math.max(1, totalFrames));
      await yieldToUi(signal);
    }
  }
  throwIfAborted(signal);

  const timeArray = Float32Array.from(times);
  const nEnergy = normalize(rawEnergy);
  const nShort = normalize(shortTerm);
  const nRms = normalize(rms);
  const nFlux = normalize(fluxRaw);
  const nCentroid = normalize(centroidRaw);
  const nComplexity = normalize(complexityRaw);
  const nTransient = normalize(transientRaw);
  const nRms2 = nRms;
  const silence = Array.from(nRms2, (value) => (value < 0.035 ? 1 : 0));
  const sortedEnergy = [...nEnergy].sort((a, b) => a - b);
  const longTerm = new Float32Array(nEnergy.length);
  let slow = 0;
  nEnergy.forEach((value, index) => { slow = 0.01 * value + 0.99 * slow; longTerm[index] = slow; });
  const nBands = bandRaw.map(normalize);
  const bandScale = bandRaw.map((values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.99)] || 1);

  const windows: BarWindow[] = options.bars && options.bars.length > 0
    ? options.bars
    : Array.from({ length: Math.max(1, Math.ceil(durationSec / 2)) }, (_, i) => ({ barIndex: i + 1, startSec: i * 2, endSec: Math.min(durationSec, (i + 1) * 2) }));
  const curves: MeasurementCurves = {
    energy: curveOf(timeArray, nEnergy), bass: curveOf(timeArray, normalize(bassRaw)), mid: curveOf(timeArray, normalize(midRaw)), high: curveOf(timeArray, normalize(highRaw)),
    flux: curveOf(timeArray, nFlux), centroid: curveOf(timeArray, nCentroid), complexity: curveOf(timeArray, nComplexity), transient: curveOf(timeArray, nTransient),
    lowOnset: curveOf(timeArray, normalize(lowOnsetRaw)), midOnset: curveOf(timeArray, normalize(midOnsetRaw)), highOnset: curveOf(timeArray, normalize(highOnsetRaw)),
    silence: curveOf(timeArray, silence), chroma: chromaFrames,
  };
  const delta = new Float32Array(nEnergy.length);
  nEnergy.forEach((value, index) => { delta[index] = index === 0 ? 0 : clamp01(0.5 + (value - nEnergy[index - 1]) * 2.5); });
  const crest = Float32Array.from(peak, (value, index) => (rms[index] > 1e-6 ? Math.min(1, value / rms[index] / 8) : 0));
  const rankOf = (value: number) => {
    let lo = 0; let hi = sortedEnergy.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedEnergy[mid] < value) lo = mid + 1; else hi = mid; }
    return sortedEnergy.length ? lo / sortedEnergy.length : 0;
  };
  const maxPeak = Math.max(1e-6, ...peak);
  const nyquist = sampleRate / 2;
  onProgress?.(1);
  return {
    durationSec, sampleRate, intervalSec: FEATURE_INTERVAL_SEC,
    times: timeArray,
    bands: bandRaw.map((values, index) => Float32Array.from(values, (value) => clamp01(value / bandScale[index]))),
    bandsNormalized: nBands,
    energy: nEnergy, shortTerm: nShort, longTerm,
    rms: nRms, peak: Float32Array.from(peak, (value) => clamp01(value / maxPeak)), crest, flux: nFlux, delta,
    percentile: Float32Array.from(nEnergy, rankOf),
    complexity: nComplexity, centroid: nCentroid,
    spread: Float32Array.from(spreadRaw, (value) => clamp01(value / (nyquist / 3))),
    rolloff: Float32Array.from(rolloffRaw, (value) => clamp01(value / nyquist)),
    flatness: Float32Array.from(flatnessRaw, clamp01),
    bars: measureBars(windows, curves, durationSec),
    chroma: Array.from(chromaAcc),
    key: detectKey(chromaAcc),
  };
}

/** The stored values nearest a time (the last point at or before it). */
export function indexAt(analysis: Pick<AudioFeatureAnalysis, 'times'>, timeSec: number): number {
  const { times } = analysis;
  if (times.length === 0) return -1;
  let lo = 0; let hi = times.length - 1; let found = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= timeSec) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}

/** The bar measurements for the bar containing a time (or the last bar that started before it). */
export function barAtTime(analysis: Pick<AudioFeatureAnalysis, 'bars'>, timeSec: number): BarMeasurements | null {
  let current: BarMeasurements | null = null;
  for (const bar of analysis.bars) {
    if (timeSec >= bar.startSec && timeSec < bar.endSec) return bar;
    if (bar.startSec <= timeSec && (!current || bar.startSec > current.startSec)) current = bar;
  }
  return current;
}

/** Mixes decoded channels down to mono, yielding to the UI so a long track does not freeze the window. */
export async function mixDownToMono(channels: Float32Array[], signal?: AbortSignal): Promise<Float32Array> {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const out = new Float32Array(length);
  const chunk = 262_144;
  for (let start = 0; start < length; start += chunk) {
    const end = Math.min(length, start + chunk);
    for (let i = start; i < end; i++) { let sum = 0; for (const channel of channels) sum += channel[i] ?? 0; out[i] = sum / channels.length; }
    if (end < length) await yieldToUi(signal);
  }
  return out;
}
