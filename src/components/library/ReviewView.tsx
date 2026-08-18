/**
 * ReviewView — renders a compact Set Review list with authentic Rekordbox
 * waveform data. Cards share the same cache and renderer as Book and Track
 * Intelligence, while keeping enough visual density for low-light set prep.
 */

import { memo, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { cn, formatKey } from '../../lib/utils';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import { waveformStateForTrack, type WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { RekordboxTrack } from '../../types';
import { CircleDash, Music, Upload } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';

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

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick();
  }, [onClick]);

  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(1) : '—';
  const keyDisplay = formatKey(track.musical_key);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${track.title}${track.artist ? ` by ${track.artist}` : ''}`}
      className={cn(
        'group glass overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] cursor-pointer transition-all',
        'hover:border-primary/30 hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45',
        isActive && 'border-primary/45 bg-primary/5 shadow-primary-selection',
      )}
    >
      <div className="flex flex-col gap-3 px-4 pt-3.5 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className={cn(
            'truncate text-base font-bold leading-tight transition-colors',
            isActive ? 'text-primary' : 'group-hover:text-primary',
          )}>
            {track.title}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {track.artist ?? 'Artist Not Stored'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="min-w-[54px]">
            <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground">BPM</span>
            <span className="block font-mono text-sm font-black tabular-nums">{bpmDisplay}</span>
          </div>

          <div className="h-8 w-px bg-[var(--color-border-subtle)]" />

          <div className="min-w-[72px]">
            <span className="block text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Energy</span>
            <div className="mt-1 flex gap-1">
              {[...Array(5)].map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 w-2.5 rounded-full',
                    i < (track.rating ?? 0) ? 'bg-primary' : 'bg-muted',
                  )}
                />
              ))}
            </div>
          </div>

          <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1 font-mono text-xs font-bold text-primary">
            {keyDisplay}
          </span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <RekordboxPreviewWaveform
          state={waveformState}
          height={42}
          variant="detail"
          onRetry={onRetryWaveform}
          activeProgress={isActive ? progress : undefined}
          onSeek={canSeek ? handleWaveformSeek : undefined}
          ariaLabel={`Waveform for ${track.title}`}
        />
      </div>
    </motion.div>
  );
});

export interface ReviewViewProps {
  importId: string;
  tracks: RekordboxTrack[];
  loading: boolean;
  onTrackClick: (track: RekordboxTrack) => void;
}

export function ReviewView({ importId, tracks, loading, onTrackClick }: ReviewViewProps) {
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const { states: waveformStates, retry: retryWaveform } = useTrackPreviewWaveforms(importId, trackIds);

  if (loading || (tracks.length === 0 && importId)) {
    return (
      <div className="flex items-center justify-center py-16">
        <CircleDash className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {tracks.map((track) => (
        <ReviewCard
          key={track.id}
          track={track}
          waveformState={waveformStateForTrack(waveformStates, track.id)}
          onRetryWaveform={() => retryWaveform([track.id])}
          onClick={() => onTrackClick(track)}
        />
      ))}
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
      </p>
      {onImport && (
        <div className="mt-3">
          <ControlButton variant="primary" onClick={onImport}>
            <Upload size={16} /> Import now
          </ControlButton>
        </div>
      )}
    </div>
  );
}
