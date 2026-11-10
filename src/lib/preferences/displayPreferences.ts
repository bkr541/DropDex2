import { useSyncExternalStore } from 'react';
import { DEFAULT_WAVEFORM_STYLE, WAVEFORM_STYLES, waveformStyleById, type WaveformStyle, type WaveformStyleId } from './waveformStyles';

const KEY = 'dropdex:display:waveform-style';
const listeners = new Set<() => void>();

const isId = (value: unknown): value is WaveformStyleId => WAVEFORM_STYLES.some((style) => style.id === value);

function read(): WaveformStyleId {
  try {
    const value = localStorage.getItem(KEY);
    return isId(value) ? value : DEFAULT_WAVEFORM_STYLE;
  } catch {
    return DEFAULT_WAVEFORM_STYLE;
  }
}

let current: WaveformStyleId = read();

export function setWaveformStyle(id: WaveformStyleId): void {
  current = id;
  try { localStorage.setItem(KEY, id); } catch { /* the choice still applies for this visit */ }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The chosen waveform style id, updating every timeline as soon as it changes. */
export function useWaveformStyleId(): WaveformStyleId {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_WAVEFORM_STYLE);
}

export function useWaveformStyle(): WaveformStyle {
  return waveformStyleById(useWaveformStyleId());
}
