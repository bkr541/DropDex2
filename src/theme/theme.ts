export const THEME_STORAGE_KEY = 'dropdex-theme';
export const DEFAULT_THEME = 'dark' as const;
export const THEME_IDS = ['dark', 'light', 'cdj'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function resolveTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

export function themeColor(theme: ThemeId): string {
  switch (theme) {
    case 'light':
      return '#0a0a0c';
    case 'cdj':
      return '#0b0e12';
    case 'dark':
      return '#0a0a0c';
  }
}
