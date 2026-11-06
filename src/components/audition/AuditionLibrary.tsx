import { CircleDash, Pause, Play, WarningAlt } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { cueAnalysisReady } from '../../lib/cues/cueReadiness';
import { durationMsForTrack, formatTime } from '../../lib/music/trackTiming';
import { cn } from '../../lib/utils';
import { ControlButton, DualRangeSlider, FilterDropdown, SearchControl } from '../ui/controls';
import type { FilterDropdownOption } from '../ui/controls';
import { KeyBadge, TrackNameCell, TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, TrackTableRow } from '../ui/display';
import { nextAuditionSort, type AuditionSort, type AuditionSortColumn } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionLibraryProps {
  tracks: RekordboxTrack[];
  selectedTrackId: string | null;
  onSelectTrack: (track: RekordboxTrack) => void;

  /** Shown beside the Library heading, e.g. "387 tracks". */
  countLabel: string;
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

const COLUMNS: Array<{ column: AuditionSortColumn; label: string; className?: string }> = [
  { column: 'title', label: 'Track' },
  { column: 'bpm', label: 'BPM' },
  { column: 'key', label: 'Key' },
  { column: 'genre', label: 'Genre', className: 'w-[178px]' },
  { column: 'format', label: 'Format', className: 'whitespace-nowrap' },
  { column: 'sampleRate', label: 'Sample Rate', className: 'whitespace-nowrap' },
  { column: 'bitRate', label: 'Bit Rate', className: 'whitespace-nowrap' },
  { column: 'length', label: 'Duration', className: 'w-[80px] text-left' },
];

function RowPlayButton({ track }: { track: RekordboxTrack }) {
  const { activeTrack, status, playIntent, toggleTrack } = useAudioPlayer();
  const isActive = activeTrack?.id === track.id;
  const isPlaying = isActive && playIntent && status !== 'error';
  const isLoading = isActive && (status === 'resolving' || status === 'loading' || status === 'buffering' || status === 'seeking');
  const label = `${isPlaying ? 'Pause' : 'Play'} ${track.title}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        isActive ? 'text-primary' : 'text-muted-foreground hover:text-primary',
      )}
      onClick={(event) => {
        event.stopPropagation();
        void toggleTrack(track);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {isLoading ? <CircleDash size={14} className="animate-spin" /> : isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
    </button>
  );
}

export function AuditionLibrary({
  tracks, selectedTrackId, onSelectTrack,
  countLabel, loading, loadingMore, error, hasMore, onLoadMore, onRetry,
  search, onSearchChange, genre, onGenreChange, genreOptions, keyFilter, onKeyFilterChange, keyOptions,
  bpmBounds, bpmRange, onBpmRangeChange, sort, onSortChange,
}: AuditionLibraryProps) {
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
          <span className="audition-library-count" data-testid="audition-library-count">{countLabel}</span>
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
            <TrackTable className="min-w-[900px]" data-testid="audition-library-table" aria-label="Library tracks">
              <TrackTableHead>
                {COLUMNS.map(({ column, label, className }) => (
                  <TrackTableHeadCell
                    key={column}
                    label={label}
                    column={column}
                    className={className}
                    sort={sort}
                    onSort={(column) => onSortChange(nextAuditionSort(sort, column))}
                  />
                ))}
              </TrackTableHead>
              <TrackTableBody>
                {tracks.map((track) => {
                  const selected = track.id === selectedTrackId;
                  return (
                    <TrackTableRow
                      key={track.id}
                      data-testid="audition-library-row"
                      selected={selected}
                      onClick={() => onSelectTrack(track)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectTrack(track);
                        }
                      }}
                    >
                      <TrackNameCell title={track.title} artist={track.artist} artworkSrc={track.artwork_path} selected={selected}
                        status={cueAnalysisReady(track) ? 'ready'
                          : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required' ? 'error'
                          : track.analysis_parse_status == null ? 'none' : 'warning'}>
                        <RowPlayButton track={track} />
                      </TrackNameCell>
                      <td className="px-3 py-1.5 font-mono text-[13px] font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
                      <td className="px-3 py-1.5"><KeyBadge camelotKey={track.musical_key} /></td>
                      <td className="w-[178px] px-3 py-1.5 text-xs text-muted-foreground"><span className="block truncate">{track.genre ?? '—'}</span></td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{track.file_format ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px] text-muted-foreground">{track.sample_rate_hz != null && track.sample_rate_hz > 0 ? `${track.sample_rate_hz / 1000} kHz` : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px] text-muted-foreground">{track.bitrate_kbps != null && track.bitrate_kbps > 0 ? `${track.bitrate_kbps} kbps` : '—'}</td>
                      <td className="w-[80px] whitespace-nowrap px-3 py-1.5 text-left font-mono text-[13px] text-muted-foreground">{formatTime(durationMsForTrack(track, null))}</td>
                    </TrackTableRow>
                  );
                })}
              </TrackTableBody>
            </TrackTable>
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
