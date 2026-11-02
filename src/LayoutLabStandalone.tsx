import { useEffect } from 'react';
import { LayoutLabWindow } from './components/ui/LayoutLabWindow';
import { THEME_STORAGE_KEY, resolveTheme } from './theme/theme';

/** Layout Lab on its own: no sign-in, no app shell. Used by the separate Layout Lab window. */
export function LayoutLabStandalone() {
  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(THEME_STORAGE_KEY); } catch { /* storage unavailable */ }
    const theme = resolveTheme(stored);
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'cdj') document.documentElement.style.colorScheme = 'dark';
    document.title = 'DropDex · Layout Lab';
  }, []);
  return <LayoutLabWindow standalone onClose={() => window.close()} />;
}
