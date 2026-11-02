import type { ElementType, ReactNode } from 'react';

/** What the current page calls itself. `onBack` and `details` are kept for pages that still need them. */
export interface PageHeading {
  title: string;
  onBack: (() => void) | null;
  details?: ReactNode;
}

/**
 * The current page's name, floating at the top center of the page, attached to the
 * top edge inside the 24px padding strip. Uses the app's `glass` surface with a
 * cyan (secondary) icon. It never takes layout space and ignores the pointer.
 */
export function PageNameTab({ title, icon: Icon }: { title: string; icon?: ElementType }) {
  return (
    <div
      data-testid="page-name-tab"
      className="pointer-events-none absolute top-0 z-40 max-w-[60%]"
      style={{ left: '50%', transform: 'translateX(-50%)' }}
    >
      <span className="glass flex items-center gap-2 rounded-b-xl border-t-0 px-5 py-1 text-[13px] font-bold leading-4 uppercase tracking-[0.2em] text-foreground">
        {Icon && <Icon size={16} className="shrink-0 text-secondary" />}
        <span className="truncate">{title}</span>
      </span>
    </div>
  );
}
