import { ChevronDown } from 'lucide-react';

export type SortKey = 'date_desc' | 'date_asc' | 'most_viewed' | 'highest_completion';

interface ArtistResultsToolbarProps {
  total: number;
  loaded: number;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date_desc', label: 'Date: Newest First' },
  { value: 'date_asc', label: 'Date: Oldest First' },
  { value: 'most_viewed', label: 'Most Viewed' },
  { value: 'highest_completion', label: 'Highest Completion' },
];

export function ArtistResultsToolbar({
  total,
  loaded,
  sortKey,
  onSortChange,
}: ArtistResultsToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="text-sm font-black text-foreground">Setlists</h2>
        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {loaded} of {total} result{total !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="relative shrink-0">
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="appearance-none bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl py-2 pl-3 pr-8 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer transition-all"
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
