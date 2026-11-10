import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { FilterDropdown } from '../ui/controls';
import { useSyncedTrackFilter } from '../../hooks/useSyncedTrackFilter';
import { SyncedFilterError } from './LibraryFilterRow';
import { useSimilarTracks } from '../../hooks/useSimilarTracks';
import {
  useSimilarTrackSettings,
  BPM_PRESETS,
  CUSTOM_TOLERANCE_MIN,
  CUSTOM_TOLERANCE_MAX,
  type BpmPreset,
} from '../../hooks/useSimilarTrackSettings';
import { GraphUp, Refresh } from 'iconoir-react/regular';

interface SimilarVibesSectionProps {
  track: RekordboxTrack;
  importId: string | null;
  onTrackClick: (t: RekordboxTrack) => void;
}

export function SimilarVibesSection({ track, importId, onTrackClick }: SimilarVibesSectionProps) {
  const { options, preset, setPreset, customTolerance, setCustomTolerance } =
    useSimilarTrackSettings();
  const { similarTracks, loading } = useSimilarTracks(track, importId, options);
  const synced = useSyncedTrackFilter();
  const rows = useMemo(() => similarTracks.map(({ track }) => track).filter(synced.matches), [similarTracks, synced.matches]);
  const trackIds = useMemo(() => rows.map((track) => track.id), [rows]);
  const { getState, retry } = useTrackPreviewWaveforms(importId, trackIds);
  const reasonsById = useMemo(() => new Map(similarTracks.map(({ track, reasons }) => [track.id, reasons])), [similarTracks]);

  // Local display state for the custom number input — only committed on blur/Enter
  const [customInput, setCustomInput] = useState<string>(String(customTolerance));

  const handlePresetClick = (p: BpmPreset) => {
    if (p === 'custom') setCustomInput(String(customTolerance));
    setPreset(p);
  };

  const commitCustomInput = () => {
    const parsed = parseInt(customInput, 10);
    if (!Number.isNaN(parsed) && parsed >= CUSTOM_TOLERANCE_MIN && parsed <= CUSTOM_TOLERANCE_MAX) {
      setCustomTolerance(parsed);
    } else {
      setCustomInput(String(customTolerance));
    }
  };

  return (
    <section className="space-y-2">
      {/* Heading + loading indicator */}
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <GraphUp width={14} height={14} aria-hidden="true" />
          Similar Vibes
        </h3>
        {loading && <Refresh width={14} height={14} aria-hidden="true" className="text-muted-foreground animate-spin shrink-0" />}
      </div>

      {/* BPM tolerance preset buttons */}
      <div className="flex flex-wrap items-center gap-1 px-1">
        {BPM_PRESETS.map((p) => (
          <PresetButton
            key={p}
            label={`±${p}`}
            active={preset === p}
            onClick={() => handlePresetClick(p)}
          />
        ))}
        <PresetButton
          label="Custom"
          active={preset === 'custom'}
          onClick={() => handlePresetClick('custom')}
        />

        {preset === 'custom' && (
          <span className="flex items-center gap-1 ml-1">
            <span className="text-[10px] font-mono text-muted-foreground">±</span>
            <input
              type="number"
              value={customInput}
              min={CUSTOM_TOLERANCE_MIN}
              max={CUSTOM_TOLERANCE_MAX}
              step={1}
              onChange={(e) => setCustomInput(e.target.value)}
              onBlur={commitCustomInput}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="w-12 text-[10px] font-mono font-bold text-center bg-[var(--color-surface)] border border-primary/40 text-primary rounded px-1 py-0.5 outline-none focus:border-primary"
            />
            <span className="text-[10px] font-mono text-muted-foreground">BPM</span>
          </span>
        )}
      </div>

      <div className="cue-studio"><FilterDropdown {...synced.dropdown} className="cue-browser__filter" /></div>
      {/* Results */}
      {synced.error ? <SyncedFilterError error={synced.error} onRetry={synced.cloud.retry} /> : loading || synced.loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-faint)] animate-pulse"
            />
          ))}
        </div>
      ) : rows.length > 0 ? (
        <RecordTrackListing
          tracks={rows}
          importId={importId}
          onSelect={onTrackClick}
          getWaveformState={getState}
          onRetryWaveform={(id) => retry([id])}
          followPlayback
          getActions={(track) => [
            { id: 'open', label: 'Open track', onSelect: () => onTrackClick(track) },
            ...(reasonsById.get(track.id) ?? []).slice(0, 3).map((reason) => ({
              id: reason.label, label: reason.label,
            })),
          ]}
          ariaLabel="Similar tracks"
        />
      ) : (
        <p className="text-xs text-muted-foreground italic text-center py-4">
          {similarTracks.length ? 'No similar tracks match the Synced filter.' : 'No similar tracks found. Try widening the BPM range.'}
        </p>
      )}
    </section>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-[10px] font-mono font-bold px-2 py-1 rounded-md border transition-colors',
        active
          ? 'bg-primary/20 border-primary/40 text-primary'
          : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-muted-foreground hover:text-foreground hover:border-[var(--color-border-faint)]',
      )}
    >
      {label}
    </button>
  );
}
