import type { ElementType } from 'react';
import { cn } from '../../lib/utils';
import { NAV_ICON_SVG } from './navIconData';
import './navIcons.css';

function makeNavIcon(svg: string, name: string): ElementType {
  function NavIcon({ size = 24, className }: { size?: number; className?: string }) {
    return (
      <svg
        className={cn('nav-icon', className)}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  NavIcon.displayName = `NavIcon(${name})`;
  return NavIcon;
}

/** One icon per page, keyed by the page's view name. */
export const NAV_ICONS: Record<string, ElementType> = Object.fromEntries(
  Object.entries(NAV_ICON_SVG).map(([view, { name, svg }]) => [view, makeNavIcon(svg, name)]),
);
