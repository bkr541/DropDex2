/**
 * Shared DropDex waveform surface.
 *
 * Rekordbox preview data remains authoritative, but the presentation follows
 * the denser Audio Dock language used by DRMVYZ: a centered waveform body,
 * clear played/unplayed contrast, a precise playhead, hover seeking, and one
 * canvas renderer reused from compact rows through the main transport.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import {
  buildDisplayBuckets,
  clampProgress,
  normalizeWaveform,
  parseHexColor,
  resolveMonoBaseColor,
  type NormalizedCol,
  type NormalizedColorCol,
  type NormalizedMonoCol,
} from '../../lib/rekordbox/waveformRenderer';
import { nextWaveformSeekFraction } from '../../lib/rekordbox/waveformKeyboard';
import { useTheme } from '../../theme/ThemeProvider';

export type WaveformVariant = 'compact' | 'detail' | 'transport';
export type WaveformAppearance = 'dropdex' | 'rekordbox';

export interface RekordboxPreviewWaveformProps {
  state: WaveformLoadState;
  height?: number;
  className?: string;
  activeProgress?: number;
  onSeek?: (fraction: number) => void;
  onRetry?: () => void;
  dimmed?: boolean;
  ariaLabel?: string;
  seekStep?: number;
  variant?: WaveformVariant;
  appearance?: WaveformAppearance;
  showCenterLine?: boolean;
  /** Keep the transport seekable even when waveform analysis is unavailable. */
  allowTimelineSeek?: boolean;
}

const DROPDEX_RED: [number, number, number] = [207, 107, 101];
const DROPDEX_RED_HOT: [number, number, number] = [232, 147, 126];

function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const current = window.devicePixelRatio || 1;
    const query = window.matchMedia(`(resolution: ${current}dppx)`);
    const update = () => setDpr(window.devicePixelRatio || 1);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [dpr]);
  return dpr;
}

function columnIntensity(column: NormalizedCol): number {
  if ('i' in column) return 0.42 + (column as NormalizedMonoCol).i * 0.58;
  const color = column as NormalizedColorCol;
  const luminance = (color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) / 255;
  return 0.42 + luminance * 0.58;
}

function rgba(color: [number, number, number], alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;
}

function readThemeRgb(variable: string, fallback: [number, number, number]): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
  return parseHexColor(value) ?? fallback;
}

function drawDropDexWaveform(
  context: CanvasRenderingContext2D,
  buckets: NormalizedCol[],
  width: number,
  height: number,
  options: {
    dimmed: boolean;
    progress: number | null;
    hover: number | null;
    showCenterLine: boolean;
    variant: WaveformVariant;
  },
) {
  const center = height / 2;
  const span = width / buckets.length;
  const gapRatio = options.variant === 'compact' ? 0.22 : 0.3;
  const barWidth = Math.max(0.65, span * (1 - gapRatio));
  const overallAlpha = options.dimmed ? 0.38 : 1;

  if (options.showCenterLine) {
    context.fillStyle = rgba(DROPDEX_RED, options.variant === 'transport' ? 0.18 : 0.12);
    context.fillRect(0, Math.floor(center), width, 1);
  }

  for (let index = 0; index < buckets.length; index += 1) {
    const column = buckets[index];
    const x = index * span + (span - barWidth) / 2;
    const halfHeight = Math.max(0.75, column.h * center * 0.88);
    const fraction = (index + 0.5) / buckets.length;
    const hasProgress = options.progress !== null;
    const played = hasProgress && fraction <= options.progress;
    const intensity = columnIntensity(column);

    let baseAlpha: number;
    if (!hasProgress) baseAlpha = 0.5 + intensity * 0.42;
    else if (played) baseAlpha = 0.62 + intensity * 0.36;
    else baseAlpha = 0.12 + intensity * 0.24;
    baseAlpha *= overallAlpha;

    const upperColor = played ? DROPDEX_RED_HOT : DROPDEX_RED;
    context.fillStyle = rgba(upperColor, baseAlpha);
    context.fillRect(x, center - halfHeight, barWidth, halfHeight);

    context.fillStyle = rgba(DROPDEX_RED, baseAlpha * 0.72);
    context.fillRect(x, center, barWidth, halfHeight);
  }

  if (options.hover !== null) {
    const hoverX = Math.max(0, Math.min(width, options.hover * width));
    context.fillStyle = rgba(DROPDEX_RED_HOT, 0.34);
    context.fillRect(Math.max(0, hoverX - 0.5), 0, 1, height);
  }

  if (options.progress !== null) {
    const playheadX = Math.max(0, Math.min(width, options.progress * width));
    context.fillStyle = rgba(DROPDEX_RED, 0.22);
    context.fillRect(Math.max(0, playheadX - 2), 0, 4, height);
    context.fillStyle = 'rgba(255,247,244,0.96)';
    context.fillRect(Math.max(0, playheadX - 0.5), 0, 1, height);
  }
}

function drawRekordboxWaveform(
  context: CanvasRenderingContext2D,
  buckets: NormalizedCol[],
  width: number,
  height: number,
  options: {
    dimmed: boolean;
    progress: number | null;
    monoColor: [number, number, number];
    playheadColor: [number, number, number];
  },
) {
  const center = height / 2;
  const span = width / buckets.length;
  const alphaScale = options.dimmed ? 0.35 : 1;

  for (let index = 0; index < buckets.length; index += 1) {
    const column = buckets[index];
    const x = index * span;
    const halfHeight = Math.max(0.5, column.h * center * 0.92);
    const played = options.progress !== null && (index + 0.5) / buckets.length <= options.progress;
    const progressAlpha = options.progress === null ? 1 : played ? 1 : 0.28;

    if ('r' in column) {
      const color = column as NormalizedColorCol;
      const alpha = alphaScale * progressAlpha;
      context.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      context.fillRect(x, center - halfHeight, span, halfHeight);
      context.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha * 0.65})`;
      context.fillRect(x, center, span, halfHeight);
    } else {
      const mono = column as NormalizedMonoCol;
      const alpha = (0.35 + mono.i * 0.65) * alphaScale * progressAlpha;
      context.fillStyle = rgba(options.monoColor, alpha);
      context.fillRect(x, center - halfHeight, span, halfHeight * 2);
    }
  }

  if (options.progress !== null) {
    const x = options.progress * width;
    context.fillStyle = rgba(options.playheadColor, 0.94);
    context.fillRect(Math.max(0, x - 0.5), 0, 1, height);
  }
}

export function RekordboxPreviewWaveform({
  state,
  height = 40,
  className,
  activeProgress,
  onSeek,
  onRetry,
  dimmed = false,
  ariaLabel,
  seekStep = 0.01,
  variant = 'compact',
  appearance,
  showCenterLine = true,
  allowTimelineSeek = false,
}: RekordboxPreviewWaveformProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const containerWidth = useContainerWidth(containerRef);
  const dpr = useDevicePixelRatio();
  const waveform = state.status === 'loaded' ? state.waveform : null;

  const normalized = useMemo(() => {
    if (!waveform || !waveform.previewColumnsValid) return null;
    return normalizeWaveform(waveform);
  }, [waveform]);

  const targetSpacing = variant === 'compact' ? 2.1 : variant === 'transport' ? 1.7 : 1.55;
  const displayCount = Math.max(1, Math.floor(containerWidth / targetSpacing));
  const buckets = useMemo(
    () => normalized ? buildDisplayBuckets(normalized.cols, displayCount) : null,
    [displayCount, normalized],
  );
  const progress = activeProgress != null ? clampProgress(activeProgress) : null;
  const resolvedAppearance = appearance ?? (theme === 'cdj' ? 'rekordbox' : 'dropdex');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0 || !buckets || !normalized) return;

    const width = containerWidth;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.save();
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);

    if (resolvedAppearance === 'dropdex') {
      drawDropDexWaveform(context, buckets, width, height, {
        dimmed,
        progress,
        hover: onSeek ? hoverFraction : null,
        showCenterLine,
        variant,
      });
    } else {
      const monoColor = readThemeRgb('--color-waveform-mono', resolveMonoBaseColor(theme));
      const playheadColor = readThemeRgb(
        '--color-waveform-playhead',
        theme === 'cdj' ? [248, 251, 255] : [255, 247, 244],
      );
      drawRekordboxWaveform(context, buckets, width, height, {
        dimmed,
        progress,
        monoColor,
        playheadColor,
      });
    }
    context.restore();
  }, [buckets, containerWidth, dimmed, dpr, height, hoverFraction, normalized, onSeek, progress, resolvedAppearance, showCenterLine, theme, variant]);

  function seekFractionFromPointer(clientX: number, element: HTMLDivElement): number {
    const rect = element.getBoundingClientRect();
    return clampProgress((clientX - rect.left) / Math.max(1, rect.width));
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek || (state.status !== 'loaded' && !allowTimelineSeek)) return;
    event.stopPropagation();
    onSeek(seekFractionFromPointer(event.clientX, event.currentTarget));
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!onSeek || (state.status !== 'loaded' && !allowTimelineSeek)) return;
    setHoverFraction(seekFractionFromPointer(event.clientX, event.currentTarget));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!onSeek || (state.status !== 'loaded' && !allowTimelineSeek)) return;
    const next = nextWaveformSeekFraction(event.key, progress ?? 0, seekStep);
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(next);
  }

  const fallbackInvalidState: WaveformLoadState | null = state.status === 'loaded' && !normalized
    ? {
        status: 'invalid',
        trackId: state.trackId,
        error: 'Waveform data could not be normalized for rendering.',
        reason: 'invalid',
        retryable: false,
      }
    : null;
  const displayState = fallbackInvalidState ?? state;
  const canSeek = Boolean(onSeek && (displayState.status === 'loaded' || allowTimelineSeek));
  const label = ariaLabel || waveformStateLabel(displayState);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden select-none',
        variant === 'transport' && 'rounded-lg border border-[var(--color-border-faint)] bg-black/15 shadow-inner',
        variant === 'detail' && 'rounded-md bg-black/10',
        canSeek && 'cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        className,
      )}
      style={{ height }}
      role={canSeek ? 'slider' : displayState.status === 'loaded' ? 'img' : 'group'}
      aria-label={label}
      aria-valuemin={canSeek ? 0 : undefined}
      aria-valuemax={canSeek ? 100 : undefined}
      aria-valuenow={canSeek ? Math.round((progress ?? 0) * 100) : undefined}
      aria-valuetext={canSeek ? `${Math.round((progress ?? 0) * 100)}% through track` : undefined}
      tabIndex={canSeek ? 0 : undefined}
      aria-live={displayState.status === 'error' || displayState.status === 'invalid' ? 'polite' : undefined}
      onClick={canSeek ? handleClick : undefined}
      onPointerMove={canSeek ? handlePointerMove : undefined}
      onPointerLeave={canSeek ? () => setHoverFraction(null) : undefined}
      onKeyDown={canSeek ? handleKeyDown : undefined}
      data-waveform-status={displayState.status}
      data-waveform-track-id={displayState.trackId ?? undefined}
      data-waveform-variant={variant}
      data-waveform-appearance={resolvedAppearance}
    >
      {displayState.status !== 'loaded' ? (
        <WaveformEmptyState state={displayState} height={height} onRetry={onRetry} />
      ) : (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="block"
          style={{ display: 'block' }}
        />
      )}
    </div>
  );
}

function waveformStateLabel(state: WaveformLoadState): string {
  switch (state.status) {
    case 'idle':
      return 'Waveform not requested';
    case 'loading':
      return 'Loading waveform';
    case 'loaded':
      return 'Track waveform';
    case 'unavailable':
      return 'No waveform available for this track';
    case 'error':
      return `Waveform failed to load: ${state.error}`;
    case 'invalid':
      return `${state.reason === 'unsupported' ? 'Unsupported' : 'Invalid'} waveform data: ${state.error}`;
  }
}

interface WaveformEmptyStateProps {
  state: Exclude<WaveformLoadState, { status: 'loaded' }>;
  height: number;
  onRetry?: () => void;
}

function WaveformEmptyState({ state, height, onRetry }: WaveformEmptyStateProps) {
  if (state.status === 'loading') {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-1">
        <div
          className="w-full rounded-sm animate-pulse bg-primary/10"
          style={{ height: Math.max(2, Math.round(height * 0.35)) }}
        />
      </div>
    );
  }

  if (state.status === 'idle') {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-1" aria-hidden="true">
        <div className="w-full h-px rounded-sm bg-primary/10" />
      </div>
    );
  }

  const compact = height < 32;
  const message = state.status === 'unavailable'
    ? compact ? 'No waveform' : 'No waveform available'
    : state.status === 'error'
      ? compact ? 'Load failed' : `Waveform failed: ${state.error}`
      : state.reason === 'unsupported'
        ? compact ? 'Unsupported data' : `Unsupported waveform: ${state.error}`
        : compact ? 'Invalid data' : `Invalid waveform: ${state.error}`;

  const tone = state.status === 'error'
    ? 'text-red-300 bg-red-500/10 border-red-400/20'
    : state.status === 'invalid'
      ? 'text-amber-300 bg-amber-500/10 border-amber-400/20'
      : 'text-muted-foreground bg-muted-foreground/5 border-[var(--color-border-faint)]';

  return (
    <div className={cn('absolute inset-0 flex items-center justify-center gap-2 px-2 border', tone)}>
      <span className={cn('truncate text-center', compact ? 'text-[9px]' : 'text-xs')} title={message}>
        {message}
      </span>
      {state.status === 'error' && onRetry && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
          className={cn(
            'shrink-0 font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm',
            compact ? 'text-[9px]' : 'text-xs',
          )}
          aria-label="Retry waveform"
        >
          Retry
        </button>
      )}
    </div>
  );
}
