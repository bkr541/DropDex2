import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Page, Refresh, Xmark } from 'iconoir-react/regular';
import type { RekordboxTrack } from '../../types';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useSyncedTrackFilter } from '../../hooks/useSyncedTrackFilter';
import { ControlButton, ToolbarIconButton, ToolbarIconGroup } from '../ui/controls';
import { NoticeCard, StatusLoader } from '../ui/feedback';
import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { LibraryFilterRow, SyncedFilterError, type LibraryFilter } from './LibraryFilterRow';
import { nextRecordSort } from '../ui/display/recordTrackSorting';
import type { TrackTableSort } from '../ui/display/TrackTable';
import { importMetadataFields, importMetadataValue, metadataLabel, metadataValue } from './importMetadata';

export function ImportTrackMetadata({ track, onClose }: { track: RekordboxTrack; onClose: () => void }) {
  const fields = Object.entries(track).filter(([name]) => name !== 'source_metadata');
  const source = Object.entries(track.source_metadata ?? {});
  return <section className="import-library__metadata" aria-label={`All metadata for ${track.title}`}>
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="min-w-0 break-words text-sm font-medium">{track.title} · All metadata</h3>
      <ToolbarIconGroup><ToolbarIconButton label="Close track metadata" onClick={onClose}><Xmark width={16} height={16} aria-hidden="true" /></ToolbarIconButton></ToolbarIconGroup>
    </div>
    <h4 className="import-library__metadata-heading">Imported track fields</h4>
    <dl className="import-library__values">{fields.map(([name, value]) => <div key={name}>
      <dt title={name}>{metadataLabel(name)}</dt><dd>{metadataValue(value)}</dd>
    </div>)}</dl>
    <h4 className="import-library__metadata-heading">Source exportLibrary.db columns</h4>
    {source.length > 0 ? <dl className="import-library__values">{source.map(([name, value]) => <div key={name}>
      <dt>{name}</dt><dd>{metadataValue(value)}</dd>
    </div>)}</dl> : <p className="text-xs text-muted-foreground">Original source columns were not retained for this snapshot. All available imported fields are shown above.</p>}
  </section>;
}

export function ImportTrackBrowser({ importId, compact = false, label = 'Imported tracks', onCopyTrack, copyTrackLabel, copyTrackDisabled = false }: {
  importId: string;
  compact?: boolean;
  label?: string;
  onCopyTrack?: (track: RekordboxTrack) => void;
  copyTrackLabel?: string;
  copyTrackDisabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [artist, setArtist] = useState('');
  const [field, setField] = useState(compact ? '' : 'track:album');
  const [sort, setSort] = useState<TrackTableSort | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const synced = useSyncedTrackFilter(!compact);
  const library = useLibraryTracks(importId, { search, genre, artist, debounceMs: 180, enabled: !synced.blocked, syncedFilter: synced.filter });
  const loading = library.loading || synced.loading;
  const statistics = useLibraryStats(importId);
  const fields = useMemo(() => importMetadataFields(library.tracks), [library.tracks]);
  const selected = library.tracks.find((track) => track.id === selectedId);
  const metadataRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) metadataRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId]);
  const retry = () => { library.refresh(); statistics.refresh(); };
  const resetSelection = (change: (value: string) => void) => (value: string) => { change(value); setSelectedId(null); };

  const filters: LibraryFilter[] = [
    { label: 'Genre', value: genre, onChange: resetSelection(setGenre), options: [{ value: '', label: 'All' }, ...(statistics.stats?.genreTotals ?? []).map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))] },
    { label: 'Artist', value: artist, onChange: resetSelection(setArtist), options: [{ value: '', label: 'All' }, ...(statistics.stats?.artistTotals ?? []).map(({ name, count }) => ({ value: name, label: `${name} (${count})` }))] },
    { label: 'Metadata field', value: field, onChange: (value) => { setField(value); if (!value && sort?.column === 'metadata') setSort(null); }, options: [{ value: '', label: 'Standard columns' }, ...fields] },
  ];
  if (!compact) filters.push({ ...synced.dropdown, onChange: resetSelection(synced.dropdown.onChange) });
  // Narrow USB panels use the shared responsive records, so sorting also remains available without table headings.
  if (compact) filters.push(
    { label: 'Sort', value: sort?.column ?? '', onChange: (column) => setSort(column ? { column, direction: 'asc' } : null), options: [
      { value: '', label: 'Library order' }, { value: 'title', label: 'Track' }, { value: 'artist', label: 'Artist' }, { value: 'bpm', label: 'Bpm' },
      { value: 'key', label: 'Key' }, { value: 'genre', label: 'Genre' }, { value: 'format', label: 'Format' },
      { value: 'playlists', label: 'Playlists' }, { value: 'date-added', label: 'Added On' }, { value: 'length', label: 'Duration' },
      ...(field ? [{ value: 'metadata', label: 'Selected metadata' }] : []),
    ] },
    { label: 'Order', value: sort?.direction ?? 'asc', onChange: (direction) => setSort({ column: sort?.column ?? 'title', direction: direction as 'asc' | 'desc' }),
      options: [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }] },
  );

  return <div className="import-library__browser">
    <LibraryFilterRow search={search} onSearchChange={resetSelection(setSearch)} label={label} placeholder="Search title, artist, or genre…" filters={filters} />
    <div className="import-library__result-summary">
      <p className="text-xs text-muted-foreground" role="status">{loading ? 'Loading track records…' : `${library.tracks.length.toLocaleString()} of ${library.total.toLocaleString()} matching tracks`} · Select a record to inspect all metadata.</p>
      <ToolbarIconGroup><ToolbarIconButton label={compact ? `Refresh ${label.toLowerCase()}` : 'Refresh imported tracks'} onClick={retry} disabled={library.loading || library.loadingMore}>
        <Refresh width={16} height={16} aria-hidden="true" />
      </ToolbarIconButton></ToolbarIconGroup>
    </div>
    {statistics.error && <div className="px-4 pb-3"><NoticeCard tone="warning" action={<ControlButton variant="secondary" onClick={statistics.refresh}>Retry filters</ControlButton>}>Filter options could not be loaded.</NoticeCard></div>}
    {library.error && <div className="px-4 pb-3"><NoticeCard tone="error" action={<ControlButton variant="secondary" onClick={library.refresh}>Retry tracks</ControlButton>}>{library.error}</NoticeCard></div>}
    {synced.error && <SyncedFilterError error={synced.error} onRetry={synced.cloud.retry} />}
    {loading && <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><StatusLoader label={compact ? `Loading ${label.toLowerCase()}` : 'Loading imported tracks'} /> Loading tracks…</div>}
    {!loading && !synced.error && library.tracks.length === 0 && !library.error && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No track records match your search and filters in this snapshot.</p>}
    {!synced.blocked && library.tracks.length > 0 && <RecordTrackListing
      tracks={library.tracks} importId={importId} playback={false} renderLeading={() => null}
      className={compact ? 'usb-library-tracks' : undefined}
      sort={sort} onSort={(column) => setSort((current) => nextRecordSort(current, column))}
      selectedId={selectedId} onSelect={(track) => setSelectedId(track.id)}
      additionalColumns={field ? [{ id: 'metadata', label: fields.find((option) => option.value === field)?.label ?? 'Metadata',
        headClassName: 'w-[180px]', cellClassName: 'w-[180px] whitespace-pre-wrap [overflow-wrap:anywhere]',
        sortValue: (track) => {
          const value = importMetadataValue(track, field);
          if (value == null) return null;
          return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : metadataValue(value);
        },
        render: (track) => metadataValue(importMetadataValue(track, field)),
      }] : []}
      actions={(track) => <ToolbarIconGroup className="justify-center"><ToolbarIconButton label={`View all metadata for ${track.title}`} onClick={() => setSelectedId(track.id)}>
        <Page width={16} height={16} aria-hidden="true" />
      </ToolbarIconButton>
        {onCopyTrack && <ToolbarIconButton label={copyTrackLabel || 'Copy audio to other USB'} disabled={copyTrackDisabled || !(track.file_path || track.file_path_normalized)} onClick={(event) => { event.stopPropagation(); onCopyTrack(track); }}>
          <Copy width={16} height={16} aria-hidden="true" />
        </ToolbarIconButton>}
      </ToolbarIconGroup>}
      scrollStyle={compact ? { maxHeight: '55vh', overflowX: 'hidden' } : { maxHeight: '60vh' }} ariaLabel={compact ? `${label} records` : 'Imported database track records'} />}
    {library.hasMore && <div className="flex justify-center p-4"><ControlButton variant="secondary" onClick={() => void library.loadMore()} disabled={library.loadingMore}>
      {library.loadingMore ? 'Loading…' : 'Load more tracks'}
    </ControlButton></div>}
    {selected && <div ref={metadataRef}><ImportTrackMetadata track={selected} onClose={() => setSelectedId(null)} /></div>}
  </div>;
}
