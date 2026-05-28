import { cn } from '../../lib/utils';

export type ArtistTabId = 'all' | 'setlists';

interface ArtistResultsTabsProps {
  activeTab: ArtistTabId;
  onTabChange: (tab: ArtistTabId) => void;
  total: number;
}

const TABS: { id: ArtistTabId; label: string }[] = [
  { id: 'all', label: 'All Results' },
  { id: 'setlists', label: 'Setlists' },
];

export function ArtistResultsTabs({ activeTab, onTabChange, total }: ArtistResultsTabsProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shrink-0 border',
            activeTab === tab.id
              ? 'bg-primary text-white border-primary shadow-sm'
              : 'bg-[var(--color-surface)] text-muted-foreground border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-foreground',
          )}
        >
          {tab.label}
          {total > 0 && (
            <span
              className={cn(
                'text-[9px] font-mono px-1.5 py-0.5 rounded-full',
                activeTab === tab.id
                  ? 'bg-white/20 text-white'
                  : 'bg-[var(--color-avatar-bg)] text-muted-foreground',
              )}
            >
              {total}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
