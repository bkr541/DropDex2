import { describe, expect, it } from 'vitest';
import {
  BPM_PRESETS,
  BPM_TOLERANCE_USER_DEFAULT,
  CUSTOM_TOLERANCE_MAX,
  CUSTOM_TOLERANCE_MIN,
  DEFAULT_PRESET,
  deriveTolerance,
  parseStoredSettings,
  validateCustomTolerance,
} from './useSimilarTrackSettings';

// ── Default ───────────────────────────────────────────────────────────────────

describe('default', () => {
  it('DEFAULT_PRESET is 6', () => expect(DEFAULT_PRESET).toBe(6));
  it('BPM_TOLERANCE_USER_DEFAULT is 6', () => expect(BPM_TOLERANCE_USER_DEFAULT).toBe(6));
  it('deriveTolerance with default preset and default tolerance returns 6', () =>
    expect(deriveTolerance(DEFAULT_PRESET, BPM_TOLERANCE_USER_DEFAULT)).toBe(6));
  it('parseStoredSettings(null) returns null so callers fall back to default', () =>
    expect(parseStoredSettings(null)).toBeNull());
  it('parseStoredSettings("") returns null', () =>
    expect(parseStoredSettings('')).toBeNull());
});

// ── Selecting each preset ─────────────────────────────────────────────────────

describe('preset selection via deriveTolerance', () => {
  it.each(BPM_PRESETS)('preset ±%i resolves to %i BPM', (p) => {
    expect(deriveTolerance(p, 10)).toBe(p);
  });

  it('preset "custom" resolves to the supplied customTolerance', () => {
    expect(deriveTolerance('custom', 15)).toBe(15);
    expect(deriveTolerance('custom', 0)).toBe(0);
    expect(deriveTolerance('custom', 30)).toBe(30);
  });
});

// ── Custom value validation ───────────────────────────────────────────────────

describe('validateCustomTolerance', () => {
  it('accepts minimum boundary 0', () => expect(validateCustomTolerance(0)).toBe(true));
  it('accepts maximum boundary 30', () => expect(validateCustomTolerance(30)).toBe(true));
  it('accepts mid-range value', () => expect(validateCustomTolerance(15)).toBe(true));
  it('accepts decimal within range', () => expect(validateCustomTolerance(5.5)).toBe(true));
  it('rejects negative values', () => expect(validateCustomTolerance(-1)).toBe(false));
  it('rejects value just above max', () => expect(validateCustomTolerance(31)).toBe(false));
  it('rejects NaN', () => expect(validateCustomTolerance(NaN)).toBe(false));
  it('rejects Infinity', () => expect(validateCustomTolerance(Infinity)).toBe(false));
  it('min and max constants match validation boundaries', () => {
    expect(validateCustomTolerance(CUSTOM_TOLERANCE_MIN)).toBe(true);
    expect(validateCustomTolerance(CUSTOM_TOLERANCE_MAX)).toBe(true);
    expect(validateCustomTolerance(CUSTOM_TOLERANCE_MIN - 1)).toBe(false);
    expect(validateCustomTolerance(CUSTOM_TOLERANCE_MAX + 1)).toBe(false);
  });
});

// ── Invalid localStorage values ───────────────────────────────────────────────

describe('parseStoredSettings — invalid inputs', () => {
  it('rejects malformed JSON', () =>
    expect(parseStoredSettings('not json at all')).toBeNull());
  it('rejects JSON number', () =>
    expect(parseStoredSettings('6')).toBeNull());
  it('rejects JSON array', () =>
    expect(parseStoredSettings('[]')).toBeNull());
  it('rejects object with unknown preset', () =>
    expect(parseStoredSettings(JSON.stringify({ preset: 7, customTolerance: 6 }))).toBeNull());
  it('rejects object with string preset that is not "custom"', () =>
    expect(parseStoredSettings(JSON.stringify({ preset: 'half', customTolerance: 6 }))).toBeNull());
  it('rejects object with negative customTolerance', () =>
    expect(parseStoredSettings(JSON.stringify({ preset: 6, customTolerance: -1 }))).toBeNull());
  it('rejects object with out-of-range customTolerance', () =>
    expect(parseStoredSettings(JSON.stringify({ preset: 6, customTolerance: 99 }))).toBeNull());
  it('rejects object with non-numeric customTolerance', () =>
    expect(parseStoredSettings(JSON.stringify({ preset: 6, customTolerance: 'ten' }))).toBeNull());
  it('rejects object missing customTolerance', () =>
    expect(parseStoredSettings(JSON.stringify({ preset: 6 }))).toBeNull());
  it('rejects object missing preset', () =>
    expect(parseStoredSettings(JSON.stringify({ customTolerance: 6 }))).toBeNull());
});

// ── Persistence round-trip ────────────────────────────────────────────────────

describe('parseStoredSettings — valid round-trips (persistence)', () => {
  it.each(BPM_PRESETS)('round-trips preset ±%i', (p) => {
    const json = JSON.stringify({ preset: p, customTolerance: 8 });
    const result = parseStoredSettings(json);
    expect(result).toEqual({ preset: p, customTolerance: 8 });
  });

  it('round-trips custom preset', () => {
    const json = JSON.stringify({ preset: 'custom', customTolerance: 17 });
    expect(parseStoredSettings(json)).toEqual({ preset: 'custom', customTolerance: 17 });
  });

  it('round-trips boundary values of customTolerance', () => {
    expect(parseStoredSettings(JSON.stringify({ preset: 6, customTolerance: 0 }))).toEqual({
      preset: 6,
      customTolerance: 0,
    });
    expect(parseStoredSettings(JSON.stringify({ preset: 6, customTolerance: 30 }))).toEqual({
      preset: 6,
      customTolerance: 30,
    });
  });
});

// ── Query tolerance derivation ────────────────────────────────────────────────

describe('tolerance that would be passed to fetchSimilarTracks', () => {
  it('each numeric preset provides its own value as the query tolerance', () => {
    for (const p of BPM_PRESETS) {
      expect(deriveTolerance(p, 99)).toBe(p);
    }
  });

  it('custom preset with stored value 10 provides 10 to the query', () => {
    const stored = parseStoredSettings(JSON.stringify({ preset: 'custom', customTolerance: 10 }));
    expect(stored).not.toBeNull();
    expect(deriveTolerance(stored!.preset, stored!.customTolerance)).toBe(10);
  });

  it('fallback settings produce the default ±6 query tolerance', () => {
    // When localStorage is absent, callers fall back to DEFAULT_PRESET + BPM_TOLERANCE_USER_DEFAULT
    expect(deriveTolerance(DEFAULT_PRESET, BPM_TOLERANCE_USER_DEFAULT)).toBe(6);
  });
});
