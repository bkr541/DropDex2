import { useMemo, useState, type ReactNode } from 'react';
import { Play } from 'iconoir-react/regular';
import type { RekordboxTrack } from '../../../types';
import { cueAnalysisReady } from '../../../lib/cues/cueReadiness';
import { durationMsForTrack, formatTime } from '../../../lib/music/trackTiming';
import type { CueLoadState } from '../../../lib/queries/analysisData';
import type { WaveformLoadState } from '../../../lib/queries/waveformValidation';
import { useTrackPreviewWaveforms } from '../../../hooks/useTrackPreviewWaveforms';
import { useTrackPlaylistCounts, type TrackPlaylistCounts } from '../../../hooks/useTrackPlaylistCounts';
import { useTrackRowCues } from '../../../hooks/useTrackRowCues';
import { TrackRowPlayButton } from '../../player/TrackRowPlayButton';
import { TrackRowWaveform } from '../../player/TrackRowWaveform';
import { cueMarkersFromState, type TrackCueMarker } from '../media/trackCueMarkers';
import { formatCamelotCode } from './camelotKey';
import { TrackListing, type TrackListingColumn, type TrackListingProps } from './TrackListing';
import { TrackListingWaveform } from './TrackListingWaveform';
import { nextRecordSort, sortRecordTracks } from './recordTrackSorting';
import type { TrackTableSort } from './TrackTable';

type TrackRecord = Pick<RekordboxTrack, 'id' | 'title' | 'artist'> &
  Partial<Pick<RekordboxTrack, 'bpm' | 'musical_key' | 'camelot_key' | 'genre' | 'file_format' | 'date_added' | 'duration_ms' | 'duration_seconds' | 'import_id'>>;

type PlaylistCounts = Pick<TrackPlaylistCounts, 'error' | 'retry'> & { counts: ReadonlyMap<string, number> };

type Props<T extends TrackRecord> = Omit<TrackListingProps<T>,
  'columns' | 'getTitle' | 'getArtist' | 'getStatus' | 'nameClassName' | 'renderWaveform' | 'trackLabel' | 'trackSort' | 'tableClassName'> & {
  importId?: string | null;
  cueStates?: ReadonlyMap<string, CueLoadState>;
  getCueMarkers?: (trackId: string) => readonly TrackCueMarker[];
  getWaveformState?: (trackId: string) => WaveformLoadState;
  onRetryWaveform?: (trackId: string) => void;
  playlistCounts?: PlaylistCounts;
  renderGenre?: (track: T) => ReactNode;
  /** Optional workflow metadata columns, after the standard metadata and before Actions. */
  additionalColumns?: readonly TrackListingColumn<T>[];
  followPlayback?: boolean;
  playback?: boolean;
};

function isImportedTrack(track: TrackRecord): track is RekordboxTrack {
  return 'rekordbox_content_id' in track;
}

function recordStatus(track: TrackRecord) {
  if (!isImportedTrack(track) || track.analysis_parse_status == null) return 'none';
  if (cueAnalysisReady(track)) return 'ready';
  return track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required' ? 'error' : 'warning';
}

const NO_IDS: string[] = [];

/** Production audio record table. Audition defines the column order and row presentation. */
export function RecordTrackListing<T extends TrackRecord>({
  tracks, importId = tracks[0]?.import_id ?? null, cueStates, getCueMarkers, getWaveformState, onRetryWaveform,
  playlistCounts, renderGenre, additionalColumns = [], renderLeading, followPlayback = false, playback = true, sort, onSort, ...props
}: Props<T>) {
  const ids = useMemo(() => tracks.map(({ id }) => id), [tracks]);
  const loadedCues = useTrackRowCues(importId && !cueStates && !getCueMarkers ? ids : NO_IDS);
  const waveforms = useTrackPreviewWaveforms(getWaveformState ? null : importId, getWaveformState ? NO_IDS : ids);
  const loadedCounts = useTrackPlaylistCounts(playlistCounts || !importId ? NO_IDS : ids);
  const counts = playlistCounts ?? loadedCounts;
  const [localSort, setLocalSort] = useState<TrackTableSort | null>(() => sort ?? null);
  const activeSort = onSort && sort !== undefined ? sort : localSort;
  const handleSort = (column: string) => {
    setLocalSort(nextRecordSort(activeSort, column));
    onSort?.(column);
  };
  const extraColumn = additionalColumns.find((column) => (column.sort ?? column.id) === activeSort?.column);
  const sortedTracks = useMemo(() => sortRecordTracks(tracks, activeSort, counts.counts, extraColumn
    ? (track) => {
        if (extraColumn.sortValue) return extraColumn.sortValue(track);
        const value = extraColumn.render(track);
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
      }
    : undefined), [tracks, activeSort, counts.counts, extraColumn]);


  const columns: TrackListingColumn<T>[] = [
    { id: 'bpm', label: 'Bpm', sort: 'bpm', cellClassName: 'font-mono tabular-nums', render: (track) => track.bpm?.toFixed(1) ?? '—' },
    { id: 'key', label: 'Key', sort: 'key', render: (track) => formatCamelotCode(track.camelot_key || track.musical_key) || '—' },
    { id: 'genre', label: 'Genre', sort: 'genre', headClassName: 'w-[83.2px] max-w-[83.2px]', cellClassName: 'w-[83.2px] max-w-[83.2px] whitespace-normal [overflow-wrap:anywhere]', render: renderGenre ?? ((track) => <span className="block whitespace-normal [overflow-wrap:anywhere]">{track.genre ?? '—'}</span>) },
    { id: 'format', label: 'Format', sort: 'format', cellClassName: 'whitespace-nowrap', render: (track) => track.file_format ?? '—' },
    {
      id: 'playlists', label: 'Playlists', sort: 'playlists', cellClassName: 'whitespace-nowrap tabular-nums',
      cellProps: () => ({ 'data-testid': 'playlist-count' }),
      render: ({ id }) => {
        const count = counts.counts.get(id);
        if (count != null) return <span title={`In ${count} ${count === 1 ? 'playlist' : 'playlists'}`}>{count}</span>;
        if (counts.error) return (
          <button
            type="button"
            className="text-red-300 hover:text-red-200"
            aria-label="Playlist counts could not be loaded. Try again."
            onClick={(event) => { event.stopPropagation(); counts.retry(); }}
            onKeyDown={(event) => event.stopPropagation()}
          >!</button>
        );
        return importId || playlistCounts ? '…' : '—';
      },
    },
    { id: 'date-added', label: 'Date added', sort: 'date-added', headClassName: 'w-[104px]', cellClassName: 'w-[104px] whitespace-nowrap tabular-nums',
      render: (track) => track.date_added ? <time dateTime={track.date_added}>{track.date_added}</time> : '—' },
    { id: 'length', label: 'Duration', sort: 'length', headClassName: 'w-[80px]', cellClassName: 'w-[80px] whitespace-nowrap font-mono tabular-nums',
      render: (track) => formatTime(durationMsForTrack({ duration_ms: track.duration_ms, duration_seconds: track.duration_seconds ?? null }, null)) },
    ...additionalColumns.map((column) => ({ ...column, sort: column.sort ?? column.id })),
  ];

  return (
    <TrackListing
      {...props}
      tracks={sortedTracks}
      columns={columns}
      sort={activeSort}
      onSort={handleSort}
      trackSort="title"
      getTitle={(track) => track.title}
      getArtist={(track) => track.artist}
      getStatus={recordStatus}
      renderLeading={renderLeading ?? ((track) => playback && isImportedTrack(track) ? <TrackRowPlayButton track={track} /> : (
        <span className="grid h-6 w-6 shrink-0 place-items-center text-muted-foreground opacity-40" aria-hidden="true"><Play aria-hidden="true" width={14} height={14} /></span>
      ))}
      renderWaveform={(track) => {
        const waveformState = getWaveformState ? getWaveformState(track.id) : waveforms.getState(track.id);
        const cues = getCueMarkers ? getCueMarkers(track.id) : cueMarkersFromState((cueStates ?? loadedCues).get(track.id));
        const onRetry = onRetryWaveform ? () => onRetryWaveform(track.id) : getWaveformState ? undefined : () => waveforms.retry([track.id]);
        return followPlayback && isImportedTrack(track) ? (
          <TrackRowWaveform track={track} waveformState={waveformState} cues={cues} onRetry={onRetry} />
        ) : (
          <TrackListingWaveform
            waveformState={waveformState}
            durationMs={durationMsForTrack({ duration_ms: track.duration_ms, duration_seconds: track.duration_seconds ?? null }, null)}
            cues={cues}
            ariaLabel={`Waveform for ${track.title}`}
            onRetry={onRetry}
          />
        );
      }}
    />
  );
}
