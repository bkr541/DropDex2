import type { ElementType, ReactNode } from 'react';

/** What the current page calls itself. `onBack` and `details` are kept for pages that still need them. */
export interface PageHeading {
  title: string;
  onBack: (() => void) | null;
  details?: ReactNode;
}

/**
 * The current page's name as a full-width row at the top of the content column, above the page itself.
 * It takes its own height (`--page-header-height`), so pages that fill the window subtract it. Uses the
 * app's `glass` surface, with the logo's red gradient on a hairline along its bottom edge and on the icon.
 */
export function PageNameTab({ title, icon: Icon }: { title: string; icon?: ElementType }) {
  return (
    <header
      data-testid="page-name-tab"
      className="glass relative z-30 flex w-full shrink-0 items-center gap-2.5 px-6"
      style={{
        height: 'var(--page-header-height)',
        border: 0,
        borderRadius: 0,
        boxShadow: '0 8px 16px -4px rgb(0 0 0 / 0.5), 0 2px 5px rgb(0 0 0 / 0.3)',
      }}
    >
      {Icon && <Icon size={16} className="logo-gradient-icon shrink-0" />}
      <span className="truncate text-[13px] font-medium uppercase leading-4 tracking-[0.2em] text-foreground">{title}</span>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px" style={{ background: 'var(--gradient-logo)' }} />
    </header>
  );
}
