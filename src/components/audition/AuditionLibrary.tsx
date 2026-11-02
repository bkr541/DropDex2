import { CircleDash, Pause, Play, WarningAlt } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { durationMsForTrack, formatTime } from '../../lib/music/trackTiming';
import { cn } from '../../lib/utils';
import { ControlButton, FilterDropdown, SearchControl } from '../ui/controls';
import type { FilterDropdownOption } from '../ui/controls';
import { KeyBadge } from '../ui/display/KeyBadge';
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
  bpmBand: string;
  onBpmBandChange: (value: string) => void;
  bpmOptions: FilterDropdownOption[];

  sort: AuditionSort | null;
  onSortChange: (sort: AuditionSort | null) => void;
}

const COLUMNS: Array<{ column: AuditionSortColumn | null; label: string; className?: string }> = [
  { column: null, label: '#', className: 'w-[84px]' },
  { column: 'title', label: 'Title' },
  { column: 'artist', label: 'Artist', className: 'w-[22%]' },
  { column: 'genre', label: 'Genre', className: 'w-[14%]' },
  { column: 'key', label: 'Key', className: 'w-[72px]' },
  { column: 'bpm', label: 'BPM', className: 'w-[72px]' },
  { column: 'length', label: 'Length', className: 'w-[80px]' },
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
  bpmBand, onBpmBandChange, bpmOptions, sort, onSortChange,
}: AuditionLibraryProps) {
  return (
    <section
      data-testid="audition-library"
      aria-label="Library"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-card)]/60"
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5 px-3.5 py-3">
        <div className="flex items-baseline gap-2.5 self-center">
          <h3 className="text-sm font-bold uppercase tracking-wide">Library</h3>
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground" data-testid="audition-library-count">{countLabel}</span>
        </div>
        <div className="min-w-[220px] max-w-[360px] flex-1" data-testid="audition-search">
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
          className="min-w-[110px]"
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
        <FilterDropdown
          label="BPM"
          value={bpmBand}
          onChange={onBpmBandChange}
          className="min-w-[100px]"
          options={[{ value: '', label: 'All' }, ...bpmOptions]}
        />
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
          <div className="max-h-[calc(100vh-18rem)] min-h-[260px] overflow-auto scrollbar-none border-t border-[var(--color-border-faint)]">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-left" data-testid="audition-library-table" aria-label="Library tracks">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-[var(--color-border-faint)]">
                  {COLUMNS.map(({ column, label, className }) => {
                    const sorted = column !== null && sort?.column === column;
                    return (
                      <th
                        key={label}
                        scope="col"
                        aria-sort={sorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={cn('sticky top-0 z-10 bg-[var(--color-background)] px-3 py-2 font-medium', className)}
                      >
                        {column ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                            aria-label={`Sort by ${label}`}
                            onClick={() => onSortChange(nextAuditionSort(sort, column))}
                          >
                            {label}
                            <span className={cn('text-primary', !sorted && 'invisible')} aria-hidden="true">{sort?.direction === 'desc' ? '↓' : '↑'}</span>
                          </button>
                        ) : label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-faint)]">
                {tracks.map((track, index) => {
                  const selected = track.id === selectedTrackId;
                  return (
                    <tr
                      key={track.id}
                      data-testid="audition-library-row"
                      tabIndex={0}
                      aria-selected={selected}
                      onClick={() => onSelectTrack(track)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectTrack(track);
                        }
                      }}
                      className={cn(
                        'cursor-pointer text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                        selected ? 'bg-primary/15' : 'hover:bg-[var(--color-surface-hover)]',
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
                          <span className="w-6 text-right">{index + 1}</span>
                          <RowPlayButton track={track} />
                        </div>
                      </td>
                      <td className={cn('truncate px-3 py-2 font-medium', selected && 'text-primary')} title={track.title}>{track.title}</td>
                      <td className="truncate px-3 py-2 text-muted-foreground" title={track.artist ?? undefined}>{track.artist ?? '—'}</td>
                      <td className="truncate px-3 py-2 text-muted-foreground">{track.genre ?? '—'}</td>
                      <td className="px-3 py-2"><KeyBadge camelotKey={track.musical_key} variant="text" className="!text-[13px]" /></td>
                      <td className="px-3 py-2 font-mono tabular-nums">{track.bpm != null ? track.bpm.toFixed(0) : '—'}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">{formatTime(durationMsForTrack(track, null))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
