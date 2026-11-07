import { useMemo, useState } from 'react';
import { cn, formatKey } from '../../lib/utils';
import { cueAnalysisReady } from '../../lib/cues/cueReadiness';
import type { RekordboxTrack, SimilarTrackResult } from '../../types';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { TrackListing, type TrackListingColumn } from '../ui/display';
import { TrackRowPlayButton } from '../player/TrackRowPlayButton';
import { TrackRowWaveform } from '../player/TrackRowWaveform';
import { useSimilarTracks } from '../../hooks/useSimilarTracks';
import {
  useSimilarTrackSettings,
  BPM_PRESETS,
  CUSTOM_TOLERANCE_MIN,
  CUSTOM_TOLERANCE_MAX,
  type BpmPreset,
} from '../../hooks/useSimilarTrackSettings';
import { CircleDash, Growth } from '@carbon/icons-react';

interface SimilarVibesSectionProps {
  track: RekordboxTrack;
  importId: string | null;
  onTrackClick: (t: RekordboxTrack) => void;
}

export function SimilarVibesSection({ track, importId, onTrackClick }: SimilarVibesSectionProps) {
  const { options, preset, setPreset, customTolerance, setCustomTolerance } =
    useSimilarTrackSettings();
  const { similarTracks, loading } = useSimilarTracks(track, importId, options);
  const trackIds = useMemo(() => similarTracks.map((result) => result.track.id), [similarTracks]);
  const { getState, retry } = useTrackPreviewWaveforms(importId, trackIds);
  const columns: TrackListingColumn<SimilarTrackResult & { id: string }>[] = [
    { id: 'bpm', label: 'BPM', cellClassName: 'font-mono text-[13px] font-bold tabular-nums', render: ({ track: t }) => (t.bpm != null ? t.bpm.toFixed(1) : '—') },
    { id: 'key', label: 'Key', render: ({ track: t }) => formatKey(t.musical_key) || '—' },
    {
      id: 'why', label: 'Why it fits',
      render: ({ reasons }) => (
        <span className="flex flex-wrap gap-1">
          {reasons.slice(0, 3).map((r) => <span key={r.label} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{r.label}</span>)}
        </span>
      ),
    },
  ];
  const rows = useMemo(() => similarTracks.map((result) => ({ ...result, id: result.track.id })), [similarTracks]);

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
          <Growth size={14} />
          Similar Vibes
        </h3>
        {loading && <CircleDash size={14} className="text-muted-foreground animate-spin shrink-0" />}
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

      {/* Results */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-faint)] animate-pulse"
            />
          ))}
        </div>
      ) : similarTracks.length > 0 ? (
        <TrackListing<SimilarTrackResult & { id: string }>
          tracks={rows}
          columns={columns}
          onSelect={(result) => onTrackClick(result.track)}
          getTitle={(result) => result.track.title}
          getArtist={(result) => result.track.artist}
          getStatus={(result) => (cueAnalysisReady(result.track) ? 'ready' : result.track.analysis_parse_status === 'failed' || result.track.analysis_parse_status === 'missing_required' ? 'error' : result.track.analysis_parse_status == null ? 'none' : 'warning')}
          renderLeading={(result) => <TrackRowPlayButton track={result.track} />}
          renderWaveform={(result) => <TrackRowWaveform track={result.track} waveformState={getState(result.track.id)} onRetry={() => retry([result.track.id])} />}
          ariaLabel="Similar tracks"
        />
      ) : (
        <p className="text-xs text-muted-foreground italic text-center py-4">
          No similar tracks found. Try widening the BPM range.
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
