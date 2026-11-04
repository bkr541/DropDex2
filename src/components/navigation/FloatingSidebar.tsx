import type { ElementType, ReactNode } from 'react';
import { User } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { UsbConnectionButton } from '../usb/UsbConnectionButton';
import { activeSidebarKey } from './sidebarGroups';

// The same soft shadow as the page-name tab at the top middle.
export const PAGE_NAME_TAB_SHADOW = '0 8px 16px -4px rgb(0 0 0 / 0.5), 0 2px 5px rgb(0 0 0 / 0.3)';

export interface FloatingSidebarItem {
  view: string;
  icon: ElementType;
  label: string;
}

interface FloatingSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
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

const ROW = 'flex items-center rounded-xl font-bold text-sm transition-all w-full';
const IDLE = 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)]';

/**
 * The left nav: one floating rounded card with the logo-red gradient border and the soft shadow of the
 * page-name tab. Every entry sits in the same card; the current page is shown by a larger gradient icon.
 */
export function FloatingSidebar({
  collapsed, onToggleCollapsed, items, currentView, onSelectView, onOpenProfile, profile,
}: FloatingSidebarProps) {
  const entries: Entry[] = [
    { key: 'logo', kind: 'logo' },
    ...items.map((item) => ({ key: item.view, kind: 'nav', item }) as Entry),
    { key: 'usb-connect', kind: 'usb' },
    { key: 'profile', kind: 'profile' },
  ];
  const activeKey = activeSidebarKey(currentView, items.map((item) => item.view));
  const padX = collapsed ? 'justify-center px-0' : 'gap-3 px-4 text-left';

  const render = (entry: Entry, isActive: boolean): ReactNode => {
    switch (entry.kind) {
      case 'logo':
        return (
          <div className={cn('flex h-10 items-center', collapsed ? 'justify-center' : 'gap-3 px-3')}>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <img src="/logos/dropdexlogo.png" alt="DropDex" className="h-8 w-8 object-contain" />
            </button>
            {!collapsed && (
              <span className="text-xl font-black uppercase leading-none tracking-tighter">
                Drop<span className="text-[var(--color-brand-primary)]">Dex</span>
              </span>
            )}
          </div>
        );
      case 'nav': {
        const Icon = entry.item.icon;
        return (
          <button
            type="button"
            onClick={() => onSelectView(entry.item.view)}
            title={collapsed ? entry.item.label : undefined}
            aria-current={isActive ? 'page' : undefined}
            className={cn(ROW, 'py-2', padX, isActive ? 'text-foreground' : IDLE)}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
              <Icon
                size={18}
                className={cn('origin-center transition-transform duration-300 ease-out', isActive ? 'logo-gradient-icon scale-[1.4]' : 'scale-100')}
              />
            </span>
            {!collapsed && entry.item.label}
          </button>
        );
      }
      case 'usb':
        return <UsbConnectionButton collapsed={collapsed} />;
      case 'profile':
        return (
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Open profile"
            aria-current={isActive ? 'page' : undefined}
            title={collapsed ? 'Profile' : undefined}
            className={cn(ROW, 'py-2', collapsed ? 'justify-center px-0' : 'gap-3 px-3 text-left', isActive ? 'text-foreground' : IDLE)}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] transition-transform duration-300 ease-out',
                isActive && 'scale-[1.2]',
              )}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <User size={16} className="text-muted-foreground" />
              )}
            </span>
            {!collapsed && <span className="truncate">{profile?.display_name ?? 'Profile'}</span>}
          </button>
        );
    }
  };

  return (
    <aside
      className={cn(
        'z-40 hidden shrink-0 flex-col justify-center py-3 pl-6 pr-0 transition-all duration-200 md:flex',
        collapsed ? 'w-[88px]' : 'w-[264px]',
      )}
    >
      {/* Padding and a matching negative margin give the card's shadow room inside the scroll area. */}
      <div data-testid="floating-sidebar" className="-m-4 flex max-h-[calc(100%+2rem)] flex-col overflow-y-auto p-4 scrollbar-none">
        <div
          data-testid="sidebar-card"
          className="glass logo-gradient-border flex flex-col gap-1 rounded-3xl p-2"
          style={{ boxShadow: PAGE_NAME_TAB_SHADOW }}
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
