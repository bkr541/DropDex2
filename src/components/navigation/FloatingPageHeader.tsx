import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import './FloatingPageHeader.css';

/** What the current page calls itself. `onBack` and `details` are kept for pages that still need them. */
export interface PageHeading {
  title: string;
  onBack: (() => void) | null;
  details?: ReactNode;
}

/**
 * The page's name and icon on a small floating group at the top middle of the window. It is the app's one reusable page header:
 * it takes no space in the layout (pages fill the whole window and it floats above them), never catches clicks, and wears the
 * same raised graphite as the left nav. `anchor="container"` places it at the top middle of the nearest positioned parent
 * instead of the window, for mockups.
 */
export function FloatingPageHeader({ title, icon: Icon, anchor = 'window' }: { title: string; icon?: ElementType; anchor?: 'window' | 'container' }) {
  return (
    <header
      data-testid="page-header-float"
      className={cn(
        'page-header-float pointer-events-none left-1/2 z-[60] -translate-x-1/2',
        anchor === 'window' ? 'fixed top-1.5' : 'absolute top-1.5',
      )}
    >
      {Icon && <Icon size={16} className="logo-gradient-icon shrink-0" />}
      <span className="truncate text-[12px] font-medium uppercase leading-4 tracking-[0.2em]">{title}</span>
    </header>
  );
}
