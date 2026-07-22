import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  isThemeId,
  resolveTheme,
  themeColor,
} from './theme';

describe('theme resolution', () => {
  it.each(['dark', 'light', 'cdj'] as const)('accepts the %s theme', (theme) => {
    expect(isThemeId(theme)).toBe(true);
    expect(resolveTheme(theme)).toBe(theme);
  });

  it('falls back to dark for missing or unsupported stored values', () => {
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme('rekordbox')).toBe(DEFAULT_THEME);
    expect(resolveTheme('')).toBe(DEFAULT_THEME);
  });

  it('returns the browser chrome color for each theme', () => {
    expect(themeColor('dark')).toBe('#0a0a0c');
    expect(themeColor('light')).toBe('#0a0a0c');
    expect(themeColor('cdj')).toBe('#0b0e12');
  });
});
