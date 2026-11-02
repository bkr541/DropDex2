import { logger } from '../../lib/logger';

export const LAYOUT_LAB_HASH = '#layout-lab';

/**
 * Opens Layout Lab in its own window, separate from the main DropDex window.
 * The desktop app opens a real second window; a plain browser falls back to a popup.
 */
export function openLayoutLab(): void {
  const desktop = window.dropdexDesktop;
  if (desktop?.openLayoutLab) {
    desktop.openLayoutLab().catch((error: unknown) => {
      logger.error('layoutlab.open_failed', { via: 'desktop', message: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  const popup = window.open(`${window.location.pathname}${LAYOUT_LAB_HASH}`, 'dropdex-layout-lab', 'popup,width=1480,height=960');
  if (!popup) logger.warn('layoutlab.open_failed', { via: 'browser', message: 'The browser blocked the popup window.' });
}
