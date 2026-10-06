import { cn } from '../../lib/utils';
import type { ArtistTabId } from './ArtistResultsTabs';
import { ChevronDown } from '@carbon/icons-react';
import { SearchControl } from '../ui/controls';

export type SortKey = 'date_desc' | 'date_asc' | 'most_viewed' | 'highest_completion';

interface ArtistResultsToolbarProps {
  total: number;
  loaded: number;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  activeTab: ArtistTabId;
  onTabChange: (tab: ArtistTabId) => void;
  filterQuery: string;
  onFilterChange: (q: string) => void;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date_desc', label: 'Date: Newest First' },
  { value: 'date_asc', label: 'Date: Oldest First' },
  { value: 'most_viewed', label: 'Most Viewed' },
  { value: 'highest_completion', label: 'Highest Completion' },
];

const TABS: { id: ArtistTabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'setlists', label: 'Setlists' },
];

export function ArtistResultsToolbar({
  total,
  loaded,
  sortKey,
  onSortChange,
  activeTab,
  onTabChange,
  filterQuery,
  onFilterChange,
}: ArtistResultsToolbarProps) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Tab toggle */}
      <div className="flex items-center shrink-0 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl p-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all',
              activeTab === tab.id
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.id === 'all' && total > 0 && (
              <span
                className={cn(
                  'text-[8px] font-mono px-1 py-0.5 rounded-full',
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-[var(--color-avatar-bg)] text-muted-foreground',
                )}
              >
                {loaded < total ? `${loaded}/${total}` : total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="flex-1 min-w-0">
        <SearchControl
          value={filterQuery}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter setlists…"
          aria-label="Filter setlists"
        />
      </div>

      {/* Sort dropdown */}
      <div className="relative shrink-0">
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="appearance-none bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl py-1.5 pl-3 pr-8 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer transition-all"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
    </div>
  );
}
