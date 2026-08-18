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
import { ControlButton } from '../ui/controls';
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

type RgbColor = [number, number, number];

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

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;
}

function blendRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const mix = Math.max(0, Math.min(1, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * mix),
    Math.round(from[1] + (to[1] - from[1]) * mix),
    Math.round(from[2] + (to[2] - from[2]) * mix),
  ];
}

function readThemeRgb(variable: string, fallback: RgbColor): RgbColor {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
  return parseHexColor(value) ?? fallback;
}

function drawRoundedBar(
  context: CanvasRenderingContext2D,
  x: number,
  center: number,
  halfHeight: number,
  width: number,
  color: string,
) {
  context.beginPath();
  context.moveTo(x, center - halfHeight);
  context.lineTo(x, center + halfHeight);
  context.lineWidth = width;
  context.lineCap = 'round';
  context.strokeStyle = color;
  context.stroke();
}

function drawGuideLine(
  context: CanvasRenderingContext2D,
  width: number,
  center: number,
  color: RgbColor,
  alpha: number,
) {
  context.fillStyle = rgba(color, alpha);
  context.fillRect(0, Math.floor(center), width, 1);
}

function drawPointerLines(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number | null,
  hover: number | null,
  accentColor: RgbColor,
  playheadColor: RgbColor,
) {
  if (hover !== null) {
    const hoverX = Math.max(0, Math.min(width, hover * width));
    context.fillStyle = rgba(accentColor, 0.32);
    context.fillRect(Math.max(0, hoverX - 0.5), 0, 1, height);
  }

  if (progress !== null) {
    const playheadX = Math.max(0, Math.min(width, progress * width));
    context.fillStyle = rgba(accentColor, 0.28);
    context.fillRect(Math.max(0, playheadX - 1.5), 0, 3, height);
    context.fillStyle = rgba(playheadColor, 0.98);
    context.fillRect(Math.max(0, playheadX - 0.5), 0, 1, height);
  }
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
    primaryColor: RgbColor;
    secondaryColor: RgbColor;
    gridColor: RgbColor;
    playheadColor: RgbColor;
  },
) {
  const center = height / 2;
  const span = width / buckets.length;
  const maxBarWidth = options.variant === 'compact' ? 2.2 : 3.1;
  const barWidth = Math.max(1, Math.min(maxBarWidth, span * 0.62));
  const overallAlpha = options.dimmed ? 0.4 : 1;

  if (options.showCenterLine) {
    drawGuideLine(context, width, center, options.gridColor, options.variant === 'transport' ? 0.38 : 0.28);
  }

  for (let index = 0; index < buckets.length; index += 1) {
    const column = buckets[index];
    const x = index * span + span / 2;
    const halfHeight = Math.max(1.1, column.h * center * 0.78);
    const fraction = (index + 0.5) / buckets.length;
    const hasProgress = options.progress !== null;
    const played = hasProgress && fraction <= options.progress;
    const intensity = columnIntensity(column);

    let alpha: number;
    if (!hasProgress) alpha = 0.48 + intensity * 0.42;
    else if (played) alpha = 0.68 + intensity * 0.30;
    else alpha = 0.14 + intensity * 0.22;

    const color = blendRgb(options.primaryColor, options.secondaryColor, 0.18 + intensity * 0.58);
    drawRoundedBar(context, x, center, halfHeight, barWidth, rgba(color, alpha * overallAlpha));
  }

  drawPointerLines(
    context,
    width,
    height,
    options.progress,
    options.hover,
    options.secondaryColor,
    options.playheadColor,
  );
}

function drawRekordboxWaveform(
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
    monoColor: RgbColor;
    gridColor: RgbColor;
    playheadColor: RgbColor;
  },
) {
  const center = height / 2;
  const span = width / buckets.length;
  const maxBarWidth = options.variant === 'compact' ? 2.15 : 3;
  const barWidth = Math.max(1, Math.min(maxBarWidth, span * 0.68));
  const alphaScale = options.dimmed ? 0.4 : 1;

  if (options.showCenterLine) {
    drawGuideLine(context, width, center, options.gridColor, options.variant === 'transport' ? 0.42 : 0.3);
  }

  for (let index = 0; index < buckets.length; index += 1) {
    const column = buckets[index];
    const x = index * span + span / 2;
    const halfHeight = Math.max(1.1, column.h * center * 0.8);
    const played = options.progress !== null && (index + 0.5) / buckets.length <= options.progress;
    const progressAlpha = options.progress === null ? 1 : played ? 1 : 0.26;
    const intensity = columnIntensity(column);

    let color: RgbColor;
    let alpha: number;
    if ('r' in column) {
      const source = column as NormalizedColorCol;
      color = blendRgb([source.r, source.g, source.b], options.monoColor, 0.08);
      alpha = 0.48 + intensity * 0.44;
    } else {
      color = options.monoColor;
      alpha = 0.38 + (column as NormalizedMonoCol).i * 0.56;
    }

    drawRoundedBar(
      context,
      x,
      center,
      halfHeight,
      barWidth,
      rgba(color, alpha * alphaScale * progressAlpha),
    );
  }

  drawPointerLines(
    context,
    width,
    height,
    options.progress,
    options.hover,
    options.monoColor,
    options.playheadColor,
  );
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

  const targetSpacing = variant === 'compact' ? 3.1 : variant === 'transport' ? 2.35 : 2.7;
  const displayCount = normalized
    ? Math.max(1, Math.min(normalized.cols.length, Math.floor(containerWidth / targetSpacing)))
    : 1;
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

    const primaryColor = readThemeRgb('--color-waveform-mono', resolveMonoBaseColor(theme));
    const secondaryColor = readThemeRgb('--color-waveform-secondary', primaryColor);
    const gridColor = readThemeRgb('--color-waveform-grid', primaryColor);
    const playheadColor = readThemeRgb(
      '--color-waveform-playhead',
      theme === 'cdj' ? [248, 251, 255] : [255, 247, 244],
    );

    if (resolvedAppearance === 'dropdex') {
      drawDropDexWaveform(context, buckets, width, height, {
        dimmed,
        progress,
        hover: onSeek ? hoverFraction : null,
        showCenterLine,
        variant,
        primaryColor,
        secondaryColor,
        gridColor,
        playheadColor,
      });
    } else {
      drawRekordboxWaveform(context, buckets, width, height, {
        dimmed,
        progress,
        hover: onSeek ? hoverFraction : null,
        showCenterLine,
        variant,
        monoColor: primaryColor,
        gridColor,
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
        'waveform-surface relative overflow-hidden select-none',
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
          className="block h-full w-full"
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
        <ControlButton
          type="button"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
          className={cn('shrink-0 font-bold text-primary hover:underline', compact ? 'text-[9px]' : 'text-xs')}
          aria-label="Retry waveform"
        >
          Retry
        </ControlButton>
      )}
    </div>
  );
}
