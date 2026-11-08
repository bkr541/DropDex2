import { useEffect } from 'react';
import { LayoutLabWindow } from './components/ui/LayoutLabWindow';
import { LocalThemeProvider } from './theme/ThemeProvider';

/** Layout Lab on its own: no sign-in, no app shell. Used by the separate Layout Lab window. */
export function LayoutLabStandalone() {
  useEffect(() => {
    document.title = 'DropDex · Layout Lab';
  }, []);
  return (
    <LocalThemeProvider>
      <LayoutLabWindow standalone onClose={() => window.close()} />
    </LocalThemeProvider>
  );
}
