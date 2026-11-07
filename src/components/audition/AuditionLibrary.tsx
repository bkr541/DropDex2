import { CircleDash, WarningAlt } from '@carbon/icons-react';
import { TrackRowPlayButton } from '../player/TrackRowPlayButton';
import { cueAnalysisReady } from '../../lib/cues/cueReadiness';
import { durationMsForTrack, formatTime } from '../../lib/music/trackTiming';
import { ControlButton, DualRangeSlider, FilterDropdown, SearchControl } from '../ui/controls';
import type { FilterDropdownOption } from '../ui/controls';
import { auditionCueMarkersFromState } from './auditionCueMarkers';
import type { CueLoadState } from '../../lib/queries/analysisData';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { TrackListing, TrackListingWaveform, type TrackListingColumn } from '../ui/display';
import { formatCamelotCode } from '../ui/display/camelotKey';
import { nextAuditionSort, type AuditionSort, type AuditionSortColumn } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionLibraryProps {
  tracks: RekordboxTrack[];
  selectedTrackId: string | null;
  onSelectTrack: (track: RekordboxTrack) => void;
  /** The waveform for a row's preview. Rows show an empty preview until it is available. */
  getWaveformState?: (trackId: string) => WaveformLoadState;
  /** Each track's cue points, drawn as markers above its row waveform. */
  cueStates?: ReadonlyMap<string, CueLoadState>;
  /** How many playlists each track is in, for the Playlists column. */
  playlistCounts?: { counts: ReadonlyMap<string, number>; error: string | null; retry: () => void };

  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;

  search: string;
  onSearchChange: (value: string) => void;
  genre: string;
  onGenreChange: (value: string) => void;
  genreOptions: FilterDropdownOption[];
  keyFilter: string;
  onKeyFilterChange: (value: string) => void;
  keyOptions: FilterDropdownOption[];
  bpmBounds: [number, number];
  bpmRange: [number, number] | null;
  onBpmRangeChange: (value: [number, number] | null) => void;

  sort: AuditionSort | null;
  onSortChange: (sort: AuditionSort | null) => void;
}

/** Audition's status dot: ready, the problem it had, or not analysed yet. */
function trackStatus(track: RekordboxTrack): 'ready' | 'error' | 'none' | 'warning' {
  return cueAnalysisReady(track) ? 'ready'
    : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required' ? 'error'
      : track.analysis_parse_status == null ? 'none' : 'warning';
}

export function AuditionLibrary({
  tracks, selectedTrackId, onSelectTrack, getWaveformState, cueStates, playlistCounts,
  loading, loadingMore, error, hasMore, onLoadMore, onRetry,
  search, onSearchChange, genre, onGenreChange, genreOptions, keyFilter, onKeyFilterChange, keyOptions,
  bpmBounds, bpmRange, onBpmRangeChange, sort, onSortChange,
}: AuditionLibraryProps) {
  const columns: TrackListingColumn<RekordboxTrack>[] = [
    { id: 'bpm', label: 'BPM', sort: 'bpm', cellClassName: 'font-mono text-[13px] font-bold tabular-nums', render: (track) => (track.bpm != null ? track.bpm.toFixed(1) : '—') },
    { id: 'key', label: 'Key', sort: 'key', render: (track) => formatCamelotCode(track.musical_key) ?? '—' },
    { id: 'genre', label: 'Genre', sort: 'genre', headClassName: 'w-[178px]', cellClassName: 'w-[178px] text-xs text-muted-foreground', render: (track) => <span className="block truncate">{track.genre ?? '—'}</span> },
    { id: 'format', label: 'Format', sort: 'format', headClassName: 'whitespace-nowrap', cellClassName: 'whitespace-nowrap text-xs text-muted-foreground', render: (track) => track.file_format ?? '—' },
    {
      id: 'playlists', label: 'Playlists', sort: 'playlists', headClassName: 'whitespace-nowrap', cellClassName: 'whitespace-nowrap tabular-nums',
      cellProps: () => ({ 'data-testid': 'audition-playlist-count' }),
      render: (track) => (playlistCounts?.counts.has(track.id)
        ? <span title={`In ${playlistCounts.counts.get(track.id)} ${playlistCounts.counts.get(track.id) === 1 ? 'playlist' : 'playlists'}`}>{playlistCounts.counts.get(track.id)}</span>
        : playlistCounts?.error
          ? (
            <button
              type="button"
              className="text-red-300 hover:text-red-200"
              title="Playlist counts could not be loaded. Click to try again."
              aria-label="Playlist counts could not be loaded. Try again."
              onClick={(event) => { event.stopPropagation(); playlistCounts.retry(); }}
              onKeyDown={(event) => event.stopPropagation()}
            >!</button>
          )
          : '…'),
    },
    { id: 'length', label: 'Duration', sort: 'length', headClassName: 'w-[80px] text-left', cellClassName: 'w-[80px] whitespace-nowrap text-left font-mono text-[13px] text-muted-foreground', render: (track) => formatTime(durationMsForTrack(track, null)) },
  ];

  return (
    <section
      data-testid="audition-library"
      aria-label="Library"
      className="audition-library cue-browser"
    >
      <div className="audition-library-chrome cue-browser__chrome">
        <h3 className="sr-only">Library</h3>
        <div className="cue-browser__filters flex flex-wrap items-stretch gap-x-4 gap-y-2" data-testid="audition-library-filters">
          <div className="flex min-w-[200px] max-w-[320px] flex-1 flex-col justify-end" data-testid="audition-search">
            <SearchControl
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search title, artist, or genre…"
              aria-label="Search the library"
            />
          </div>
          <FilterDropdown
            label="Genre"
            value={genre}
            onChange={onGenreChange}
            searchable
            className="min-w-[100px]"
            options={[{ value: '', label: 'All' }, ...genreOptions]}
          />
          <FilterDropdown
            label="Key"
            value={keyFilter}
            onChange={onKeyFilterChange}
            searchable
            className="min-w-[90px]"
            options={[{ value: '', label: 'All' }, ...keyOptions]}
          />
          <DualRangeSlider variant="inline"
            bounds={bpmBounds}
            value={bpmRange ?? bpmBounds}
            onChange={onBpmRangeChange}
            onReset={() => onBpmRangeChange(null)}
          />
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-faint)] px-4 py-6 text-sm text-red-300" role="alert">
          <WarningAlt size={20} />
          <span>Your library could not be loaded.</span>
          <ControlButton variant="ghost" onClick={onRetry}>Try again</ControlButton>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-3 border-t border-[var(--color-border-faint)] py-14 text-sm text-muted-foreground" role="status">
          <CircleDash className="animate-spin text-primary" size={22} />
          Loading your library…
        </div>
      ) : tracks.length === 0 ? (
        <div className="border-t border-[var(--color-border-faint)] px-5 py-12 text-center">
          <p className="font-bold">No tracks match.</p>
          <p className="mt-1 text-sm text-muted-foreground">Clear the search or a filter to see more of your library.</p>
        </div>
      ) : (
        <>
          <div className="audition-table-scroll overflow-auto scrollbar-none">
            <TrackListing<RekordboxTrack>
              tracks={tracks}
              columns={columns}
              selectedId={selectedTrackId}
              onSelect={onSelectTrack}
              getTitle={(track) => track.title}
              getArtist={(track) => track.artist}
              getStatus={trackStatus}
              renderLeading={(track) => <TrackRowPlayButton track={track} />}
              renderWaveform={(track) => (
                <TrackListingWaveform
                  waveformState={getWaveformState?.(track.id) ?? { status: 'idle', trackId: track.id }}
                  durationMs={durationMsForTrack(track, null)}
                  cues={auditionCueMarkersFromState(cueStates?.get(track.id))}
                  height={18}
                  ariaLabel={`Waveform for ${track.title}`}
                />
              )}
              trackSort="title"
              sort={sort}
              onSort={(column) => onSortChange(nextAuditionSort(sort, column as AuditionSortColumn))}
              rowProps={() => ({ 'data-testid': 'audition-library-row' })}
              tableTestId="audition-library-table"
              ariaLabel="Library tracks"
            />
          </div>

          {hasMore ? (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] px-4 py-2.5 text-xs text-muted-foreground">
              <span>More tracks are available in your library.</span>
              <ControlButton variant="surface" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more tracks'}
              </ControlButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
