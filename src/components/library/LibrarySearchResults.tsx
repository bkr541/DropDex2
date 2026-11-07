import { formatKey } from '../../lib/utils';
import { cueAnalysisReady } from '../../lib/cues/cueReadiness';
import { TrackListing, type TrackListingColumn } from '../ui/display';
import { TrackRowPlayButton } from '../player/TrackRowPlayButton';
import { TrackRowWaveform } from '../player/TrackRowWaveform';
import type { RekordboxTrack } from '../../types';
import { waveformStateForTrack, type WaveformLoadState } from '../../lib/queries/waveformValidation';
import { CircleDash, Search } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';

interface LibrarySearchResultsProps {
  query: string;
  results: RekordboxTrack[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  importId: string | null;
  onTrackClick: (track: RekordboxTrack) => void;
  onLoadMore: () => void;
  waveformStates: Map<string, WaveformLoadState>;
  onRetryWaveform: (trackId: string) => void;
}

export function LibrarySearchResults({
  query,
  results,
  total,
  loading,
  loadingMore,
  hasMore,
  importId,
  onTrackClick,
  onLoadMore,
  waveformStates,
  onRetryWaveform,
}: LibrarySearchResultsProps) {
  const columns: TrackListingColumn<RekordboxTrack>[] = [
    { id: 'bpm', label: 'BPM', cellClassName: 'font-mono text-[13px] font-bold tabular-nums', render: (track) => (track.bpm != null ? track.bpm.toFixed(1) : '—') },
    { id: 'key', label: 'Key', render: (track) => formatKey(track.musical_key) || '—' },
  ];

  const label = loading
    ? 'Searching…'
    : results.length > 0
    ? `${total.toLocaleString()} result${total !== 1 ? 's' : ''} for "${query}" · showing ${results.length.toLocaleString()}`
    : `No results for "${query}"`;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <Search size={13} />
        {label}
      </h2>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <CircleDash className="animate-spin text-primary" size={26} />
        </div>
      )}

      {!loading && !importId && (
        <p className="text-center py-12 text-muted-foreground italic text-sm">
          Import a library to search your tracks.
        </p>
      )}

      {!loading && importId && results.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
          <Search size={28} className="mx-auto text-muted-foreground opacity-30 mb-2" />
          <p className="text-sm text-muted-foreground italic">No tracks matching your search.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="lib-panel">
          <TrackListing<RekordboxTrack>
            tracks={results}
            columns={columns}
            onSelect={onTrackClick}
            getTitle={(track) => track.title}
            getArtist={(track) => track.artist}
            getStatus={(track) => (cueAnalysisReady(track) ? 'ready' : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required' ? 'error' : track.analysis_parse_status == null ? 'none' : 'warning')}
            renderLeading={(track) => <TrackRowPlayButton track={track} />}
            renderWaveform={(track) => <TrackRowWaveform track={track} waveformState={waveformStateForTrack(waveformStates, track.id)} onRetry={() => onRetryWaveform(track.id)} />}
            rowProps={(track) => ({ 'aria-label': `Open ${track.title}${track.artist ? ` by ${track.artist}` : ''}` })}
            ariaLabel="Search results"
          />
          {hasMore && (
            <div className="border-t border-[var(--color-border-faint)] pt-2 flex justify-center">
              <ControlButton variant="neutral" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <><CircleDash size={13} className="animate-spin" /> Loading more…</>
                ) : (
                  `Load ${Math.min(200, total - results.length).toLocaleString()} more…`
                )}
              </ControlButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
