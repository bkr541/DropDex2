import { useId, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { User } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { activeSidebarKey } from './sidebarGroups';
import { FILLED_NAV_ICONS, FilledProfileIcon } from './NavIcons';
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
  | { key: 'profile'; kind: 'profile' };

/**
 * One round button. On hover or keyboard focus it grows to the right into a pill that slides the page name open
 * beside the icon. The current page uses a red gradient fill and a small red tab on the card's edge.
 */
function NavSlot({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div className="group relative h-12 w-12" data-testid="sidebar-slot">
      {active && (
        <svg aria-hidden="true" viewBox="0 0 24 24" preserveAspectRatio="none"
          className="sidebar-active-marker absolute -left-2 top-3 h-6 w-1.5 overflow-hidden rounded-r-full">
          <rect width="24" height="24" />
        </svg>
      )}
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
 * The left nav is a slim floating capsule of round icon buttons. Hovering a button reveals its page name.
 */
export function FloatingSidebar({ items, currentView, onSelectView, onOpenProfile, profile }: FloatingSidebarProps) {
  const gradientId = useId();
  const entries: Entry[] = [
    { key: 'logo', kind: 'logo' },
    ...items.map((item) => ({ key: item.view, kind: 'nav', item }) as Entry),
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
        const Icon = isActive ? FILLED_NAV_ICONS.get(entry.item.icon) ?? entry.item.icon : entry.item.icon;
        return (
          <NavSlot label={entry.item.label} active={isActive} onClick={() => onSelectView(entry.item.view)}>
            <Icon width={24} height={24} aria-hidden="true" className="nav-icon shrink-0" />
          </NavSlot>
        );
      }
      case 'profile': {
        const Icon = isActive ? FilledProfileIcon : User;
        return (
          <NavSlot label={profile?.display_name ?? 'Profile'} active={isActive} onClick={onOpenProfile}>
            <span className="sidebar-avatar flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon width={22} height={22} aria-hidden="true" className="nav-icon shrink-0 text-muted-foreground" />
              )}
            </span>
          </NavSlot>
        );
      }
    }
  };

  return (
    <aside className="pointer-events-none relative z-40 hidden w-[88px] shrink-0 md:block"
      style={{ '--sidebar-active-paint': `url("#${gradientId}") var(--color-logo-red)` } as CSSProperties}>
      <svg className="absolute" width={0} height={0} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} className="sidebar-icon-gradient" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
            <stop offset="0%" stopColor="#fa2830" />
            <stop offset="50%" stopColor="var(--color-logo-red)" />
            <stop offset="100%" stopColor="#fb7974" />
          </linearGradient>
        </defs>
      </svg>
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
