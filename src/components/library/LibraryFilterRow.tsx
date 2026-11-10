import { useState } from 'react';
import { ControlButton, FilterDropdown, SearchControl } from '../ui/controls';
import type { FilterDropdownOption } from '../ui/controls/FilterDropdown';
import '../cues/cue-studio.css';

export interface LibraryFilter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterDropdownOption[];
}

/** Uses the Tracks/Cue Points filter geometry, labels and shared input controls. */
export function LibraryFilterRow({ search, onSearchChange, label, placeholder, filters }: {
  search: string;
  onSearchChange: (value: string) => void;
  label: string;
  placeholder: string;
  filters: LibraryFilter[];
}) {
  return <div className="cue-studio" role="group" aria-label={`${label} filters`}>
    <div className="cue-browser__filters flex flex-wrap items-stretch" data-testid="library-filter-row">
      <div className="flex min-w-[200px] max-w-[320px] flex-1 flex-col justify-end" data-testid="cue-browser-search">
        <SearchControl value={search} onChange={(event) => onSearchChange(event.target.value)}
          aria-label={`Search ${label.toLowerCase()}`} placeholder={placeholder} />
      </div>
      {filters.map((filter) => <FilterDropdown key={filter.label} {...filter} className="cue-browser__filter" />)}
    </div>
  </div>;
}

export function SyncedFilterError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-red-300" role="alert">
      {error}
      <ControlButton variant="ghost" onClick={onRetry}>Retry Cloud status</ControlButton>
    </div>
  );
}

export function recordOptions(values: Array<string | null | undefined>): FilterDropdownOption[] {
  return [{ value: '', label: 'All' }, ...[...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }))];
}

export function matchesLibrarySearch(search: string, ...values: Array<string | null | undefined>) {
  return values.join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}

export interface CollectionFilters {
  search: string;
  count: string;
  sort: string;
}

export function filterLibraryCollection<T>(records: readonly T[], filters: CollectionFilters, name: (record: T) => string,
  count: (record: T) => number, searchText: (record: T) => string = name): T[] {
  const visible = records.filter((record) => matchesLibrarySearch(filters.search, searchText(record)) && (
    filters.count === '' || (filters.count === 'empty' ? count(record) === 0
      : filters.count === 'with-tracks' ? count(record) > 0
      : filters.count === 'one' ? count(record) === 1
      : filters.count === 'few' ? count(record) >= 2 && count(record) < 10 : count(record) >= 10)
  ));
  if (filters.sort === 'name') visible.sort((a, b) => name(a).localeCompare(name(b)));
  if (filters.sort === 'most') visible.sort((a, b) => count(b) - count(a));
  if (filters.sort === 'fewest') visible.sort((a, b) => count(a) - count(b));
  return visible;
}

export function useLibraryCollectionFilters<T>(records: readonly T[], name: (record: T) => string, count: (record: T) => number,
  { searchText = name, playlists = false }: { searchText?: (record: T) => string; playlists?: boolean } = {}) {
  const [search, setSearch] = useState('');
  const [trackCount, setTrackCount] = useState('');
  const [sort, setSort] = useState('original');
  const filters: LibraryFilter[] = [
    { label: 'Tracks', value: trackCount, onChange: setTrackCount, options: [
      { value: '', label: 'All' },
      ...(playlists ? [{ value: 'with-tracks', label: 'With tracks' }, { value: 'empty', label: 'Empty' }]
        : [{ value: 'one', label: '1 track' }, { value: 'few', label: '2–9 tracks' }, { value: 'many', label: '10+ tracks' }]),
    ] },
    { label: 'Sort', value: sort, onChange: setSort, options: [
      { value: 'original', label: 'Library order' }, { value: 'name', label: 'Name A–Z' },
      { value: 'most', label: 'Most tracks' }, { value: 'fewest', label: 'Fewest tracks' },
    ] },
  ];
  return { search, onSearchChange: setSearch, filters,
    visible: filterLibraryCollection(records, { search, count: trackCount, sort }, name, count, searchText) };
}
