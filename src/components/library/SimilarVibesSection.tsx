import { useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';
import { useSimilarTracks } from '../../hooks/useSimilarTracks';
import {
  useSimilarTrackSettings,
  BPM_PRESETS,
  CUSTOM_TOLERANCE_MIN,
  CUSTOM_TOLERANCE_MAX,
  type BpmPreset,
} from '../../hooks/useSimilarTrackSettings';

interface SimilarVibesSectionProps {
  track: RekordboxTrack;
  importId: string | null;
  onTrackClick: (t: RekordboxTrack) => void;
}

export function SimilarVibesSection({ track, importId, onTrackClick }: SimilarVibesSectionProps) {
  const { options, preset, setPreset, customTolerance, setCustomTolerance } =
    useSimilarTrackSettings();
  const { similarTracks, loading } = useSimilarTracks(track, importId, options);

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
          <TrendingUp size={14} />
          Similar Vibes
        </h3>
        {loading && <Loader2 size={14} className="text-muted-foreground animate-spin shrink-0" />}
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
        <div>
          {similarTracks.map((t) => (
            <SimilarTrackRow key={t.id} track={t} onClick={() => onTrackClick(t)} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic text-center py-4">
          No similar tracks found in ±{options.bpmTolerance} BPM range.
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

function SimilarTrackRow({ track, onClick }: { track: RekordboxTrack; onClick: () => void }) {
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(1) : '—';
  const keyDisplay = formatKey(track.musical_key);
  const initial1 = (track.artist?.[0] ?? track.title?.[0] ?? '?').toUpperCase();
  const initial2 = (track.title?.[0] ?? '?').toUpperCase();

  return (
    <div
      onClick={onClick}
      className="grid grid-cols-[44px_1fr_60px_60px] gap-3 items-center p-3 rounded-xl transition-all cursor-pointer mb-2 bg-[var(--color-surface)] border border-[var(--color-border-faint)] hover:bg-[var(--color-surface-hover)]"
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-[var(--color-avatar-bg)] text-slate-500 shadow-sm">
        {initial1}{initial2}
      </div>
      <div className="min-w-0 pr-2">
        <h4 className="text-sm font-bold truncate">{track.title}</h4>
        <p className="text-[10px] text-muted-foreground uppercase tracking-tighter truncate">
          {track.artist ?? 'Artist not stored'}
        </p>
      </div>
      <div className="text-center">
        <p className="text-xs font-mono font-bold text-[var(--color-text-subdued)]">{bpmDisplay}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-mono font-bold text-[var(--color-text-subdued)]">{keyDisplay}</p>
      </div>
    </div>
  );
}
