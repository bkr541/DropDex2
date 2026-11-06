import { useEffect, useMemo, useState } from 'react';
import { Music, Upload } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { logger } from '../../lib/logger';
import { buildTimelineSections } from '../../lib/music/phraseSections';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import { ControlButton } from '../ui/controls';
import { AuditionFullSong } from './AuditionFullSong';
import { AuditionLibrary } from './AuditionLibrary';
import { AuditionTrackHeader } from './AuditionTrackHeader';
import { AuditionTransport } from './AuditionTransport';
import {
  auditionPositionLabel,
  filterAuditionTracks,
  sortAuditionTracks,
  type AuditionSort,
} from './auditionTracks';
import { useTrackPlaylistCounts } from '../../hooks/useTrackPlaylistCounts';
import { useAuditionRowCues } from './useAuditionRowCues';
import { useAuditionTrackAnalysis } from './useAuditionTrackAnalysis';
import type { RekordboxTrack } from '../../types';
import './AuditionView.css';

interface AuditionViewProps {
  importId: string | null;
  onImport: () => void;
}

const PAGE_SIZE = 100;

export function AuditionView({ importId, onImport }: AuditionViewProps) {
  const { playIntent, playTrack } = useAudioPlayer();
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [bpmRange, setBpmRange] = useState<[number, number] | null>(null);
  const [sort, setSort] = useState<AuditionSort | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<RekordboxTrack | null>(null);
  const [analysisRetry, setAnalysisRetry] = useState(0);

  const { stats } = useLibraryStats(importId);
  const {
    tracks, total, loading, loadingMore, error, hasMore, loadMore, refresh,
  } = useLibraryTracks(importId, { search, genre: genre || null, debounceMs: 220, pageSize: PAGE_SIZE });

  const filteredTracks = useMemo(
    () => filterAuditionTracks(tracks, { key: keyFilter, bpmRange }),
    [tracks, keyFilter, bpmRange],
  );
  // How many playlists each listed track is in. The list can also be sorted by it.
  const filteredTrackIds = useMemo(() => filteredTracks.map((track) => track.id), [filteredTracks]);
  const playlistCounts = useTrackPlaylistCounts(filteredTrackIds);
  const visibleTracks = useMemo(
    () => sortAuditionTracks(filteredTracks, sort, playlistCounts.counts),
    [filteredTracks, sort, playlistCounts.counts],
  );

  // A different library means a different set of tracks, so start over.
  useEffect(() => {
    setSelectedTrack(null);
    setSearch('');
    setGenre('');
    setKeyFilter('');
    setBpmRange(null);
    setSort(null);
  }, [importId]);

  useEffect(() => {
    if (selectedTrack == null && visibleTracks.length > 0) setSelectedTrack(visibleTracks[0]);
  }, [selectedTrack, visibleTracks]);

  useEffect(() => {
    if (error) logger.error('audition.library.load_failed', { importId, error });
  }, [error, importId]);

  const selectedTrackId = selectedTrack?.id ?? null;
  const analysis = useAuditionTrackAnalysis(selectedTrackId, analysisRetry);
  // Waveforms and cue points for every track in the list (each row shows a preview), plus the selected track.
  const rowTrackIds = useMemo(() => visibleTracks.map((track) => track.id), [visibleTracks]);
  const waveformIds = useMemo(
    () => (selectedTrackId && !rowTrackIds.includes(selectedTrackId) ? [...rowTrackIds, selectedTrackId] : rowTrackIds),
    [rowTrackIds, selectedTrackId],
  );
  const { getState: getWaveformState, retry: retryWaveform } = useTrackPreviewWaveforms(importId, waveformIds);
  const rowCueStates = useAuditionRowCues(rowTrackIds);
  const waveformState = getWaveformState(selectedTrackId);

  const durationMs = selectedTrack ? durationMsForTrack(selectedTrack, analysis.beatGrid, analysis.phrases) : null;
  const sections = useMemo(
    () => buildTimelineSections(analysis.phrases, analysis.beatGrid, durationMs),
    [analysis.phrases, analysis.beatGrid, durationMs],
  );

  const selectedIndex = visibleTracks.findIndex((track) => track.id === selectedTrackId);
  const previousTrack = selectedIndex > 0 ? visibleTracks[selectedIndex - 1] : null;
  const nextTrack = selectedIndex >= 0 && selectedIndex < visibleTracks.length - 1 ? visibleTracks[selectedIndex + 1] : null;

  // The key and BPM filters work on the tracks loaded so far, so their counts do too.
  const clientFilterActive = keyFilter !== '' || bpmRange !== null;
  const listCount = clientFilterActive ? visibleTracks.length : total;
  const positionLabel = auditionPositionLabel(selectedIndex, listCount, clientFilterActive && hasMore);

  const genreOptions = useMemo(
    () => (stats?.genreTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
    [stats?.genreTotals],
  );
  const keyOptions = useMemo(
    () => (stats?.keyTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
    [stats?.keyTotals],
  );
  const bpmBounds = useMemo((): [number, number] => {
    const bpms = (stats?.bpmTotals ?? []).map(({ bpm }) => bpm).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
    return bpms.length ? [Math.floor(Math.min(...bpms)), Math.ceil(Math.max(...bpms))] : [60, 200];
  }, [stats?.bpmTotals]);

  function selectTrack(track: RekordboxTrack) {
    setSelectedTrack(track);
  }

  // Stepping with the arrows keeps music going if something is already playing.
  function stepTo(track: RekordboxTrack | null) {
    if (!track) return;
    setSelectedTrack(track);
    if (playIntent) void playTrack(track);
  }

  if (!importId) {
    return (
      <div className="audition-studio audition-empty mx-auto max-w-3xl">
        <div className="p-8 text-center">
          <Music size={48} className="mx-auto mb-4 text-secondary opacity-60" />
          <h2 className="text-2xl font-black">Audition</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Import a Rekordbox library to listen to your tracks and see how each song is laid out.
          </p>
          <ControlButton variant="primary" className="mt-5" onClick={onImport}>
            <Upload size={16} /> Import library
          </ControlButton>
        </div>
      </div>
    );
  }

  return (
    <div className="audition-studio" data-testid="audition-view">
      <AuditionTrackHeader
        track={selectedTrack}
        durationMs={durationMs}
        positionLabel={positionLabel}
        onPrevious={previousTrack ? () => stepTo(previousTrack) : null}
        onNext={nextTrack ? () => stepTo(nextTrack) : null}
      />

      <AuditionFullSong
        track={selectedTrack}
        durationMs={durationMs}
        waveformState={waveformState}
        onRetryWaveform={() => retryWaveform(selectedTrackId ? [selectedTrackId] : undefined)}
        sections={sections}
        cues={analysis.cues}
        beatGrid={analysis.beatGrid}
        sectionsLoading={analysis.loading}
        sectionsError={analysis.error}
        onRetrySections={() => setAnalysisRetry((value) => value + 1)}
      >
        <AuditionTransport
          track={selectedTrack}
          fallbackDurationMs={durationMs}
          previousTrack={previousTrack}
          nextTrack={nextTrack}
          onSelectTrack={selectTrack}
        />
      </AuditionFullSong>

      <AuditionLibrary
        tracks={visibleTracks}
        selectedTrackId={selectedTrackId}
        onSelectTrack={selectTrack}
        getWaveformState={getWaveformState}
        cueStates={rowCueStates}
        playlistCounts={playlistCounts}
        loading={loading}
        loadingMore={loadingMore}
        error={error}
        hasMore={hasMore}
        onLoadMore={() => void loadMore()}
        onRetry={refresh}
        search={search}
        onSearchChange={setSearch}
        genre={genre}
        onGenreChange={setGenre}
        genreOptions={genreOptions}
        keyFilter={keyFilter}
        onKeyFilterChange={setKeyFilter}
        keyOptions={keyOptions}
        bpmBounds={bpmBounds}
        bpmRange={bpmRange}
        onBpmRangeChange={setBpmRange}
        sort={sort}
        onSortChange={setSort}
      />
    </div>
  );
}
