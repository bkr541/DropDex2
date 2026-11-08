import { SurfaceCard } from '../ui/display/SurfaceCard';
import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibraryStats } from '../../hooks/useRekordboxTracks';
import { fetchLibraryTracksPage } from '../../lib/queries/rekordbox';
import { logger } from '../../lib/logger';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import type { RekordboxTrack } from '../../types';
import { CheckboxControl, ControlButton, FilterDropdown, SearchControl } from '../ui/controls';
import { EmptyState, NoticeCard, StatusLoader } from '../ui/feedback';

const PAGE_SIZE = 100;

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
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const genreOptions = useMemo(() => [{ value: 'all', label: 'All genres' }, ...(stats?.genreTotals ?? []).map(({ name }) => ({ value: name, label: name }))], [stats?.genreTotals]);

  const visible = useMemo(() => tracks.filter((track) => {
    if (status === 'all') return true;
    const synced = syncedKeys.has(trackIdentityKey(track));
    return status === 'synced' ? synced : !synced;
  }), [tracks, status, syncedKeys]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = useMemo(() => visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [visible, currentPage]);
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

  useEffect(() => { setPage(0); }, [search, genre, status]);
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [currentPage, search, genre, status]);

  return (
    <div className="space-y-3 p-4" data-testid="track-sync-selector">
      {/* Filter row */}
      <div className="flex flex-wrap items-stretch gap-3" data-testid="track-sync-filters">
        <div className="min-w-[min(100%,220px)] flex-1">
          <SearchControl value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or artist…" aria-label="Search tracks" />
        </div>
        <FilterDropdown label="Genre" value={genre} onChange={setGenre} options={genreOptions} searchable />
        <FilterDropdown label="Status" value={status} onChange={(value) => setStatus(value as StatusFilter)} options={STATUS_OPTIONS} />
      </div>

      {/* The track list */}
      <SurfaceCard as="div" className="profile-records">
        <div className="profile-record flex flex-wrap items-center gap-3 border-b border-[var(--color-border-faint)]">
          <CheckboxControl checked={allVisibleSelected} indeterminate={visibleSelected > 0 && !allVisibleSelected} onChange={toggleAllVisible} disabled={visible.length === 0} aria-label="Select all matching tracks" />
          <span className="text-xs font-bold">
            {loading ? 'Loading your tracks…' : `${visible.length.toLocaleString()} ${visible.length === 1 ? 'track' : 'tracks'} shown`}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{selected.size.toLocaleString()} selected</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><StatusLoader label="Loading tracks to sync" /></div>
        ) : error ? (
          <div className="p-4"><NoticeCard tone="error">{error}</NoticeCard></div>
        ) : visible.length === 0 ? (
          <EmptyState title="No tracks match" message="Try changing your search or filters." />
        ) : (
          <>
            <RecordTrackListing
              tracks={shown}
              importId={importId}
              selectedIds={selectedIds}
              onSelect={toggleOne}
              scrollRef={listRef}
              scrollStyle={{ maxHeight: '26rem' }}
              rowProps={(track) => ({
                'data-testid': 'track-sync-row',
                title: syncedKeys.has(trackIdentityKey(track)) ? 'Synced' : 'Not synced',
                style: { contentVisibility: 'auto', containIntrinsicSize: '0 40px' },
              })}
              actions={(track) => (
                <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                  <CheckboxControl checked={selectedIds.has(track.id)} onChange={() => toggleOne(track)} aria-label={'Select ' + track.title} />
                </span>
              )}
              ariaLabel="Select tracks to sync"
            />
            {lastPage > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] px-3 py-2">
                <ControlButton variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</ControlButton>
                <p className="text-xs text-muted-foreground">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visible.length)} of {visible.length}</p>
                <ControlButton variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</ControlButton>
              </div>
            )}
          </>
        )}
      </SurfaceCard>

      <div className="flex items-center justify-end gap-2">
        <ControlButton variant="ghost" onClick={onCancel}>Cancel</ControlButton>
        <ControlButton variant="primary" disabled={selected.size === 0} onClick={() => onSync([...selected.values()])} data-testid="track-sync-submit">
          Sync {selected.size.toLocaleString()} {selected.size === 1 ? 'Track' : 'Tracks'}
        </ControlButton>
      </div>
    </div>
  );
}
