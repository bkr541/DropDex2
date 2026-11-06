import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDash } from '@carbon/icons-react';
import { useLibraryStats } from '../../hooks/useRekordboxTracks';
import { fetchLibraryTracksPage } from '../../lib/queries/rekordbox';
import { logger } from '../../lib/logger';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { cn } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';
import { CheckboxControl, ControlButton, FilterDropdown, SearchControl } from '../ui/controls';

type StatusFilter = 'all' | 'not-synced' | 'synced';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All tracks' },
  { value: 'not-synced', label: 'Not synced yet' },
  { value: 'synced', label: 'Already synced' },
];

/** Loads every track of an import that matches the search and genre, a page at a time, so the whole list can be selected from. */
function useAllTracks(importId: string, search: string, genre: string) {
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const all: RekordboxTrack[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await fetchLibraryTracksPage(importId, offset, 500, { search: search || null, genre: genre === 'all' ? null : genre });
          if (cancelled) return;
          all.push(...page.items);
          if (!page.hasMore || page.items.length === 0) break;
        }
        setTracks(all);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('preview.select.load_failed', { importId, message });
        if (!cancelled) setError('Could not load your tracks. Try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [importId, search, genre]);

  return { tracks, loading, error };
}

interface TrackSyncSelectorProps {
  importId: string;
  /** Identity keys of the tracks that already have a cloud preview. */
  syncedKeys: ReadonlySet<string>;
  onCancel: () => void;
  onSync: (tracks: RekordboxTrack[]) => void;
}

/** A list of the user's tracks with a filter row above it. Tick the ones to sync, then press the Sync button. */
export function TrackSyncSelector({ importId, syncedKeys, onCancel, onSync }: TrackSyncSelectorProps) {
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Map<string, RekordboxTrack>>(new Map());
  const { tracks, loading, error } = useAllTracks(importId, search.trim(), genre);
  const { stats } = useLibraryStats(importId);
  const listRef = useRef<HTMLUListElement>(null);

  const genreOptions = useMemo(() => [{ value: 'all', label: 'All genres' }, ...(stats?.genreTotals ?? []).map(({ name }) => ({ value: name, label: name }))], [stats?.genreTotals]);

  const visible = useMemo(() => tracks.filter((track) => {
    if (status === 'all') return true;
    const synced = syncedKeys.has(trackIdentityKey(track));
    return status === 'synced' ? synced : !synced;
  }), [tracks, status, syncedKeys]);

  const visibleSelected = visible.filter((track) => selected.has(track.id)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelected === visible.length;

  const toggleOne = (track: RekordboxTrack) => setSelected((current) => {
    const next = new Map(current);
    if (next.has(track.id)) next.delete(track.id); else next.set(track.id, track);
    return next;
  });

  const toggleAllVisible = () => setSelected((current) => {
    const next = new Map(current);
    if (allVisibleSelected) visible.forEach((track) => next.delete(track.id));
    else visible.forEach((track) => next.set(track.id, track));
    return next;
  });

  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [search, genre, status]);

  return (
    <div className="space-y-3 p-4" data-testid="track-sync-selector">
      {/* Filter row */}
      <div className="flex flex-wrap items-stretch gap-3" data-testid="track-sync-filters">
        <div className="min-w-[220px] flex-1">
          <SearchControl value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or artist…" aria-label="Search tracks" />
        </div>
        <FilterDropdown label="Genre" value={genre} onChange={setGenre} options={genreOptions} searchable />
        <FilterDropdown label="Status" value={status} onChange={(value) => setStatus(value as StatusFilter)} options={STATUS_OPTIONS} />
      </div>

      {/* The track list */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] bg-white/[0.03] px-4 py-2.5">
          <CheckboxControl checked={allVisibleSelected} indeterminate={visibleSelected > 0 && !allVisibleSelected} onChange={toggleAllVisible} disabled={visible.length === 0} aria-label="Select all shown tracks" />
          <span className="text-xs font-bold">
            {loading ? 'Loading your tracks…' : `${visible.length.toLocaleString()} ${visible.length === 1 ? 'track' : 'tracks'} shown`}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{selected.size.toLocaleString()} selected</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><CircleDash className="animate-spin text-primary" size={24} /></div>
        ) : error ? (
          <p className="py-12 text-center text-sm font-bold text-red-400">{error}</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm italic text-muted-foreground">No tracks match these filters.</p>
        ) : (
          <ul ref={listRef} className="max-h-[26rem] divide-y divide-[var(--color-border-faint)] overflow-y-auto">
            {visible.map((track) => {
              const on = selected.has(track.id);
              const synced = syncedKeys.has(trackIdentityKey(track));
              return (
                <li
                  key={track.id}
                  data-testid="track-sync-row"
                  onClick={() => toggleOne(track)}
                  className={cn('flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-white/[0.04]', on && 'bg-primary/[0.07]')}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '0 44px' }}
                >
                  <CheckboxControl checked={on} onChange={() => toggleOne(track)} aria-label={`Select ${track.title}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{track.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{track.artist || 'Unknown artist'}{track.genre ? ` · ${track.genre}` : ''}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest', synced ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.06] text-muted-foreground')}>
                    {synced ? 'Synced' : 'Not synced'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <ControlButton variant="ghost" onClick={onCancel}>Cancel</ControlButton>
        <ControlButton variant="primary" disabled={selected.size === 0} onClick={() => onSync([...selected.values()])} data-testid="track-sync-submit">
          Sync {selected.size.toLocaleString()} {selected.size === 1 ? 'Track' : 'Tracks'}
        </ControlButton>
      </div>
    </div>
  );
}
