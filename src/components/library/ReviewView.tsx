/**
 * ReviewView — renders the Set Review Mode card list using authentic
 * Rekordbox waveform data instead of seed-generated placeholder bars.
 *
 * Waveform loading strategy:
 *   - useTrackPreviewWaveforms loads waveforms in bulk for all visible review tracks.
 *   - The module-level waveform cache is shared with Tracks and Track Detail, so
 *     previously loaded waveforms appear instantly without a network round-trip.
 *   - Inactive cards are memoised via React.memo — they do not re-render during
 *     playback of another track.
 *   - The active track card shows a live playhead via useWaveformProgress.
 */

import { memo, useCallback, useMemo } from 'react';
import { Music, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn, formatKey } from '../../lib/utils';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import { waveformStateForTrack, type WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { RekordboxTrack } from '../../types';

// ── ReviewCard ────────────────────────────────────────────────────────────────

interface ReviewCardProps {
  track: RekordboxTrack;
  waveformState: WaveformLoadState;
  onRetryWaveform: () => void;
  onClick: () => void;
}

const ReviewCard = memo(function ReviewCard({
  track,
  waveformState,
  onRetryWaveform,
  onClick,
}: ReviewCardProps) {
  const { activeTrack, status: playerStatus, seek, getAudioElement } = useAudioPlayer();
  const isActive = activeTrack?.id === track.id;
  const canSeek = isActive && !['idle', 'resolving', 'loading', 'error'].includes(playerStatus);

  const progress = useWaveformProgress(track.id);

  const handleWaveformSeek = useCallback((fraction: number) => {
    const audio = getAudioElement();
    if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
    seek(fraction * audio.duration);
  }, [seek, getAudioElement]);

  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(1) : '—';
  const keyDisplay = formatKey(track.musical_key);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        'glass p-6 rounded-3xl active:scale-[0.97] transition-transform overflow-hidden relative group cursor-pointer',
        isActive && 'border border-secondary/30 shadow-[0_4px_20px_rgba(168,85,247,0.12)]',
      )}
    >
      {/* Authentic Rekordbox waveform overlaid at the bottom of the card */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 h-8 transition-opacity',
          waveformState.status === 'loaded' ? 'opacity-10 group-hover:opacity-25' : 'opacity-100 z-20',
        )}
      >
        <RekordboxPreviewWaveform
          state={waveformState}
          height={32}
          onRetry={onRetryWaveform}
          activeProgress={isActive ? progress : undefined}
          onSeek={canSeek ? handleWaveformSeek : undefined}
          dimmed={false}
          ariaLabel={`Waveform for ${track.title}`}
        />
      </div>

      <div className="flex justify-between items-start mb-2 relative z-10">
        <h3 className="text-xl font-bold line-clamp-1 flex-1 pr-4">{track.title}</h3>
        <span className="font-mono text-secondary neon-text-purple border border-secondary/20 px-2 py-0.5 rounded text-sm">
          {keyDisplay}
        </span>
      </div>
      <p className="text-muted-foreground mb-4">{track.artist ?? 'Artist Not Stored'}</p>
      <div className="flex gap-6 items-center relative z-10">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">BPM</span>
          <span className="text-lg font-black font-mono">{bpmDisplay}</span>
        </div>
        <div className="h-8 w-px bg-[var(--color-border-subtle)]" />
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Energy</span>
          <div className="flex gap-0.5 mt-1">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={cn('w-3 h-1.5 rounded-sm', i < (track.rating ?? 0) ? 'bg-primary' : 'bg-muted')}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

// ── ReviewView ────────────────────────────────────────────────────────────────

export interface ReviewViewProps {
  importId: string;
  tracks: RekordboxTrack[];
  loading: boolean;
  onTrackClick: (track: RekordboxTrack) => void;
}

export function ReviewView({ importId, tracks, loading, onTrackClick }: ReviewViewProps) {
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);

  // Bulk-load waveforms for all review tracks. Uses the shared module-level
  // cache — tracks already viewed in the Tracks tab are served instantly.
  const { states: waveformStates, retry: retryWaveform } = useTrackPreviewWaveforms(importId, trackIds);

  if (loading || (tracks.length === 0 && importId)) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tracks.map((t) => {
        const waveformState = waveformStateForTrack(waveformStates, t.id);
        return (
          <ReviewCard
            key={t.id}
            track={t}
            waveformState={waveformState}
            onRetryWaveform={() => retryWaveform([t.id])}
            onClick={() => onTrackClick(t)}
          />
        );
      })}
    </div>
  );
}

export function ReviewEmptyState({ onImport }: { onImport?: () => void }) {
  return (
    <div className="glass p-6 rounded-[2rem] border-2 border-secondary/20 text-center">
      <Music size={48} className="mx-auto mb-4 text-secondary opacity-50" />
      <h2 className="text-2xl font-black mb-2">Review Mode</h2>
      <p className="text-muted-foreground text-sm">
        Import a library to start reviewing your collection.
        {onImport && (
          <>
            {' '}
            <button
              onClick={onImport}
              className="text-primary hover:text-primary/80 underline transition-colors"
            >
              Import now
            </button>
          </>
        )}
      </p>
    </div>
  );
}
