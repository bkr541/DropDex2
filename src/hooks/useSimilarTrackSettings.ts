import { useState } from 'react';

const STORAGE_KEY = 'dropdex-similar-vibes-bpm-tolerance-v1';

export const BPM_PRESETS = [2, 4, 6, 8, 12] as const;
export type BpmPreset = (typeof BPM_PRESETS)[number] | 'custom';

export const DEFAULT_PRESET: BpmPreset = 6;
export const BPM_TOLERANCE_USER_DEFAULT = 6;
export const CUSTOM_TOLERANCE_MIN = 0;
export const CUSTOM_TOLERANCE_MAX = 30;

export interface SimilarTrackOptions {
  bpmTolerance: number;
}

interface StoredSettings {
  preset: BpmPreset;
  customTolerance: number;
}

export function validateCustomTolerance(value: number): boolean {
  return Number.isFinite(value) && value >= CUSTOM_TOLERANCE_MIN && value <= CUSTOM_TOLERANCE_MAX;
}

export function deriveTolerance(preset: BpmPreset, customTolerance: number): number {
  return preset === 'custom' ? customTolerance : preset;
}

export function parseStoredSettings(raw: string | null): StoredSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { preset, customTolerance } = parsed as Record<string, unknown>;

    const isValidPreset =
      preset === 'custom' ||
      ((typeof preset === 'number') && (BPM_PRESETS as readonly number[]).includes(preset));
    if (!isValidPreset) return null;

    if (typeof customTolerance !== 'number' || !validateCustomTolerance(customTolerance))
      return null;

    return { preset: preset as BpmPreset, customTolerance };
  } catch {
    return null;
  }
}

function readStorage(): StoredSettings {
  const stored = parseStoredSettings(localStorage.getItem(STORAGE_KEY));
  return stored ?? { preset: DEFAULT_PRESET, customTolerance: BPM_TOLERANCE_USER_DEFAULT };
}

function writeStorage(settings: StoredSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export interface UseSimilarTrackSettingsReturn {
  options: SimilarTrackOptions;
  preset: BpmPreset;
  setPreset: (preset: BpmPreset) => void;
  customTolerance: number;
  setCustomTolerance: (value: number) => void;
}

export function useSimilarTrackSettings(): UseSimilarTrackSettingsReturn {
  const [preset, setPresetState] = useState<BpmPreset>(() => readStorage().preset);
  const [customTolerance, setCustomToleranceState] = useState<number>(
    () => readStorage().customTolerance,
  );

  const setPreset = (p: BpmPreset) => {
    setPresetState(p);
    writeStorage({ preset: p, customTolerance });
  };

  const setCustomTolerance = (value: number) => {
    if (!validateCustomTolerance(value)) return;
    setCustomToleranceState(value);
    writeStorage({ preset, customTolerance: value });
  };

  const options: SimilarTrackOptions = {
    bpmTolerance: deriveTolerance(preset, customTolerance),
  };

  return { options, preset, setPreset, customTolerance, setCustomTolerance };
}
