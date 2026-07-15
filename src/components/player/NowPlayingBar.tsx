import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Loader2,
  AlertTriangle,
  X,
  Usb,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { computeProgress } from '../../lib/rekordbox/waveformRenderer';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';

// ── Time formatting ───────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  if (!isFinite(secs) || isNaN(secs)) return '0:00';
  const s = Math.floor(secs);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── Local time/duration hook — polls audio element, does not pollute context ──

function usePlayerTime(getAudioElement: () => HTMLAudioElement | null, active: boolean) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    let running = true;
    // Keep the shared transport playhead fluid without repainting the whole app at 60fps.
    let lastUpdate = 0;
    function tickThrottled() {
      if (!running) return;
      const now = performance.now();
      if (now - lastUpdate >= 50) {
        lastUpdate = now;
        const audio = getAudioElement();
        if (audio) {
          setCurrentTime(audio.currentTime);
          setDuration(isFinite(audio.duration) ? audio.duration : 0);
        }
      }
      rafRef.current = requestAnimationFrame(tickThrottled);
    }
    rafRef.current = requestAnimationFrame(tickThrottled);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, getAudioElement]);

  return { currentTime, duration };
}

// ── NowPlayingBar ─────────────────────────────────────────────────────────────

interface NowPlayingBarProps {
  className?: string;
}

export function NowPlayingBar({ className }: NowPlayingBarProps) {
  const {
    activeTrack,
    status,
    playIntent,
    volume,
    muted,
    error,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    toggleMute,
    clearError,
    getAudioElement,
  } = useAudioPlayer();
  const { status: usbStatus, connect: connectUsb } = useUsbConnection();

  const isActive = status !== 'idle';
  const isPlaying = playIntent;
  const isLoading = status === 'resolving' || status === 'loading';
  const isBuffering = status === 'buffering' || status === 'seeking';
  const isError = status === 'error';

  const { currentTime, duration } = usePlayerTime(getAudioElement, isActive && !isError);
  const activeWaveforms = useTrackPreviewWaveforms(
    activeTrack?.import_id ?? null,
    activeTrack ? [activeTrack.id] : [],
  );
  const waveformState = activeWaveforms.getState(activeTrack?.id);
  const progress = computeProgress(currentTime, duration);

  if (!isActive) return null;

  function handleWaveformSeek(fraction: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    seek(fraction * duration);
  }

  function handlePlayPause() {
    if (isPlaying) pause();
    else void resume();
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 border-t border-[var(--color-border-subtle)]',
        'bg-[var(--color-panel)] backdrop-blur-md',
        className,
      )}
      style={{ height: 64 }}
      aria-label="Now Playing"
      role="region"
    >
      {/* Error state */}
      {isError && (
        <>
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="flex-1 min-w-0 text-xs text-amber-400 truncate">
            {error}
          </p>
          {usbStatus === 'disconnected' || usbStatus === 'unavailable' ? (
            <button
              onClick={() => void connectUsb()}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs font-bold text-primary hover:bg-primary/20 transition-all"
            >
              <Usb size={12} />
              Connect USB
            </button>
          ) : null}
          <button
            onClick={clearError}
            aria-label="Dismiss error"
            className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all"
          >
            <X size={16} />
          </button>
        </>
      )}

      {/* Playback state */}
      {!isError && (
        <>
          {/* Track info */}
          <div className="min-w-0 w-40 hidden sm:block shrink-0">
            <p className="text-xs font-bold truncate leading-tight">
              {activeTrack?.title ?? '—'}
            </p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {activeTrack?.artist ?? '—'}
            </p>
          </div>

          {/* Play / Pause */}
          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            {isLoading || isBuffering ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={14} />
            ) : (
              <Play size={14} />
            )}
          </button>

          {/* Time label — mobile only shows this, desktop shows full seek */}
          <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums sm:hidden">
            {fmtTime(currentTime)}
          </span>

          {/* Seek slider + timestamps (desktop) */}
          <div className="hidden sm:flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums w-8 text-right">
              {fmtTime(currentTime)}
            </span>
            <RekordboxPreviewWaveform
              state={waveformState}
              height={34}
              variant="transport"
              className={cn(
                'flex-1 min-w-0 transition-opacity',
                (isLoading || duration === 0) && 'opacity-50 pointer-events-none',
              )}
              activeProgress={progress}
              onSeek={duration > 0 && !isLoading ? handleWaveformSeek : undefined}
              onRetry={activeTrack ? () => activeWaveforms.retry([activeTrack.id]) : undefined}
              allowTimelineSeek
              ariaLabel={activeTrack ? `Seek ${activeTrack.title}` : 'Playback timeline'}
            />
            <span className="text-[10px] font-mono text-muted-foreground shrink-0 tabular-nums w-8">
              {fmtTime(duration)}
            </span>
          </div>

          {/* Volume (desktop) */}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <button
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
            >
              {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              aria-label="Volume"
              className="w-16 h-1 accent-primary cursor-pointer"
            />
          </div>

          {/* USB indicator — subtle dot */}
          {usbStatus === 'connected' && (
            <span
              title="USB connected"
              className="hidden sm:block shrink-0 w-1.5 h-1.5 rounded-full bg-green-500"
            />
          )}

          {/* Stop */}
          <button
            onClick={stop}
            aria-label="Stop playback"
            className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all"
          >
            <Square size={14} />
          </button>
        </>
      )}
    </div>
  );
}
