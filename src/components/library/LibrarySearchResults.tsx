import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import type { RekordboxTrack } from '../../types';
import { waveformStateForTrack, type WaveformLoadState } from '../../lib/queries/waveformValidation';
import { Refresh, Search } from 'iconoir-react/regular';
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
  const label = loading
    ? 'Searching…'
    : results.length > 0
    ? `${total.toLocaleString()} result${total !== 1 ? 's' : ''} for "${query}" · showing ${results.length.toLocaleString()}`
    : `No results for "${query}"`;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <Search width={13} height={13} aria-hidden="true" />
        {label}
      </h2>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Refresh className="animate-spin text-primary" width={26} height={26} aria-hidden="true" />
        </div>
      )}

      {!loading && !importId && (
        <p className="text-center py-12 text-muted-foreground italic text-sm">
          Import a library to search your tracks.
        </p>
      )}

      {!loading && importId && results.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
          <Search width={28} height={28} aria-hidden="true" className="mx-auto text-muted-foreground opacity-30 mb-2" />
          <p className="text-sm text-muted-foreground italic">No tracks matching your search.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="lib-panel">
          <RecordTrackListing
            tracks={results}
            onSelect={onTrackClick}
            importId={importId}
            getWaveformState={(id) => waveformStateForTrack(waveformStates, id)}
            onRetryWaveform={onRetryWaveform}
            followPlayback
            rowProps={(track) => ({ 'aria-label': `Open ${track.title}${track.artist ? ` by ${track.artist}` : ''}` })}
            ariaLabel="Search results"
          />
          {hasMore && (
            <div className="border-t border-[var(--color-border-faint)] pt-2 flex justify-center">
              <ControlButton variant="neutral" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <><Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> Loading more…</>
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
