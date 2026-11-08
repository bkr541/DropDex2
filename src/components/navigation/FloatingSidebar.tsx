import type { ElementType, ReactNode } from 'react';
import { User } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { UsbConnectionButton } from '../usb/UsbConnectionButton';
import { activeSidebarKey } from './sidebarGroups';
import './FloatingSidebar.css';

// The same soft shadow as the page-name tab at the top middle.
export const PAGE_NAME_TAB_SHADOW = '0 8px 16px -4px rgb(0 0 0 / 0.5), 0 2px 5px rgb(0 0 0 / 0.3)';

export interface FloatingSidebarItem {
  view: string;
  icon: ElementType;
  label: string;
}

interface FloatingSidebarProps {
  items: FloatingSidebarItem[];
  currentView: string;
  onSelectView: (view: string) => void;
  onOpenProfile: () => void;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

type Entry =
  | { key: 'logo'; kind: 'logo' }
  | { key: string; kind: 'nav'; item: FloatingSidebarItem }
  | { key: 'usb-connect'; kind: 'usb' }
  | { key: 'profile'; kind: 'profile' };

/**
 * One round button. On hover or keyboard focus it grows to the right into a pill that slides the page name open
 * beside the icon. The current page has no circle: its icon is larger, bolder and lifted off the card by a shadow and a red glow,
 * with a small colour tab on the card's edge.
 */
function NavSlot({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div className="group relative h-12 w-12" data-testid="sidebar-slot">
      {active && <span aria-hidden="true" className="absolute -left-2 top-3 h-6 w-1.5 rounded-r-full" style={{ background: 'var(--gradient-logo)' }} />}
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-active={active ? 'true' : undefined}
        className={cn(
          'absolute left-0 top-0 z-10 flex h-12 items-center overflow-hidden rounded-full text-sm font-semibold transition-[background-color,box-shadow,color] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          active ? 'text-foreground' : 'text-muted-foreground',
          'group-hover:bg-[var(--color-surface-hover)] group-hover:text-foreground group-hover:shadow-[0_8px_20px_rgb(0_0_0/0.45)]',
          'group-has-[:focus-visible]:bg-[var(--color-surface-hover)] group-has-[:focus-visible]:text-foreground group-has-[:focus-visible]:shadow-[0_8px_20px_rgb(0_0_0/0.45)]',
        )}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center">{children}</span>
        <span
          data-testid="sidebar-label"
          className="max-w-0 overflow-hidden whitespace-nowrap pr-0 opacity-0 transition-[max-width,padding,opacity] duration-200 ease-out group-hover:max-w-[200px] group-hover:pr-5 group-hover:opacity-100 group-has-[:focus-visible]:max-w-[200px] group-has-[:focus-visible]:pr-5 group-has-[:focus-visible]:opacity-100"
        >
          {label}
        </span>
      </button>
    </div>
  );
}

/**
 * The left nav: a slim floating capsule of round icon buttons. The current page is a tinted circle with a tab on the
 * edge; hovering any button slides its page name open beside it.
 */
export function FloatingSidebar({ items, currentView, onSelectView, onOpenProfile, profile }: FloatingSidebarProps) {
  const entries: Entry[] = [
    { key: 'logo', kind: 'logo' },
    ...items.map((item) => ({ key: item.view, kind: 'nav', item }) as Entry),
    { key: 'usb-connect', kind: 'usb' },
    { key: 'profile', kind: 'profile' },
  ];
  const activeKey = activeSidebarKey(currentView, items.map((item) => item.view));

  const render = (entry: Entry, isActive: boolean): ReactNode => {
    switch (entry.kind) {
      case 'logo':
        return (
          <div className="flex h-12 w-12 items-center justify-center">
            <img src="/logos/dropdexlogo.png" alt="DropDex" className="h-8 w-8 object-contain" />
          </div>
        );
      case 'nav': {
        const Icon = entry.item.icon;
        return (
          <NavSlot label={entry.item.label} active={isActive} onClick={() => onSelectView(entry.item.view)}>
            <Icon
              width={24} height={24} aria-hidden="true"
              className={cn('nav-icon shrink-0 origin-center transition-transform duration-300 ease-out', isActive ? 'logo-gradient-icon scale-[1.4]' : 'scale-100')}
            />
          </NavSlot>
        );
      }
      case 'usb':
        return <div className="flex h-12 w-12 items-center justify-center"><UsbConnectionButton collapsed /></div>;
      case 'profile':
        return (
          <NavSlot label={profile?.display_name ?? 'Profile'} active={isActive} onClick={onOpenProfile}>
            <span className="sidebar-avatar flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] transition-transform duration-300 ease-out">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <User width={22} height={22} aria-hidden="true" className="shrink-0 text-muted-foreground" />
              )}
            </span>
          </NavSlot>
        );
    }
  };

  return (
    <aside className="pointer-events-none relative z-40 hidden w-[88px] shrink-0 md:block">
      <div className="absolute inset-y-0 left-0 flex flex-col justify-center py-3 pl-6">
        <div
          data-testid="sidebar-card"
          className="sidebar-capsule pointer-events-auto flex flex-col gap-0.5 rounded-[32px] p-2"
        >
          {entries.map((entry) => (
            <div key={entry.key} className="flex flex-col justify-center">
              {render(entry, entry.key === activeKey)}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
