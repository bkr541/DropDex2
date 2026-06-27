/**
 * RekordboxPreviewWaveform
 *
 * Canvas-based renderer for authentic Rekordbox preview waveform data.
 *
 * Supported formats:
 *   PWV4  — color preview (from EXT file). h ∈ [0,127]; r,g,b ∈ [0,255].
 *   PWAV  — monochrome preview (from DAT). h ∈ [0,31]; i ∈ [0,7].
 *   PWV2  — monochrome preview fallback. Same byte layout as PWAV.
 *
 * Rendering algorithm:
 *   1. Normalize source columns once (useMemo, runs only when waveform changes).
 *   2. Downsample to display width using peak-preserving buckets (maximum h per
 *      bucket). For widths larger than column count, nearest-neighbour upsampling.
 *   3. Draw symmetric bars centred on the vertical midline — upper and lower halves
 *      of each column, with the lower half dimmed slightly for depth.
 *   4. For colour columns: use stored r,g,b directly (already 0-255 from importer).
 *      For mono: use theme foreground colour with intensity-driven alpha [0.35, 1.0].
 *   5. If activeProgress is provided, paint played columns at 35% opacity and draw
 *      a 1-pixel white playhead at the progress position.
 *
 * Performance:
 *   - Single <canvas> element, zero DOM nodes per waveform column.
 *   - Normalisation and bucket computation are memoised; canvas draw fires only
 *     when layout, data, theme, DPR, or progress changes.
 *   - ResizeObserver is disconnected on unmount.
 *   - DPR media-query listener is removed on unmount.
 *   - MutationObserver tracking data-theme is disconnected on unmount.
 *   - No requestAnimationFrame loop when playback is inactive.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import {
  buildDisplayBuckets,
  clampProgress,
  normalizeWaveform,
  resolveMonoBaseColor,
  type NormalizedCol,
  type NormalizedColorCol,
  type NormalizedMonoCol,
} from '../../lib/rekordbox/waveformRenderer';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RekordboxPreviewWaveformProps {
  /** Track-scoped waveform state. */
  state: WaveformLoadState;
  /** CSS height of the waveform container in pixels. */
  height?: number;
  /** Additional class names applied to the outer container div. */
  className?: string;
  /** Playback progress, clamped to [0, 1]. */
  activeProgress?: number;
  /** Called with a fraction in [0, 1] when a loaded waveform is clicked. */
  onSeek?: (fraction: number) => void;
  /** Retry callback shown only for retryable request failures. */
  onRetry?: () => void;
  /** Render the waveform at reduced opacity. */
  dimmed?: boolean;
  /** Accessible label for loaded waveform data. */
  ariaLabel?: string;
}

// ── Hook: observe container size ──────────────────────────────────────────────

function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Read initial size immediately
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ── Hook: track devicePixelRatio ───────────────────────────────────────────────

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const current = window.devicePixelRatio || 1;
    const mql = window.matchMedia(`(resolution: ${current}dppx)`);
    const handler = () => setDpr(window.devicePixelRatio || 1);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [dpr]);
  return dpr;
}

// ── Hook: observe data-theme attribute ────────────────────────────────────────

function useDocumentTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
  );
  useEffect(() => {
    const mo = new MutationObserver(() => {
      setTheme(
        document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
      );
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  buckets: NormalizedCol[],
  kind: 'color' | 'mono',
  cssW: number,
  cssH: number,
  opts: {
    monoColor: [number, number, number];
    dimmed: boolean;
    progressX: number | null;
  },
) {
  const { monoColor, dimmed, progressX } = opts;
  const cx = cssH / 2;
  const numBuckets = buckets.length;
  const barW = cssW / numBuckets;
  const globalAlpha = dimmed ? 0.35 : 1.0;

  for (let x = 0; x < numBuckets; x++) {
    const col = buckets[x];
    const px = x * barW;
    const isPlayed = progressX !== null && px + barW <= progressX;
    const playFactor = isPlayed ? 0.35 : 1.0;

    if (kind === 'color') {
      const cc = col as NormalizedColorCol;
      // Cap bar to 92% of half-height so a minimal gap from edges is preserved.
      const halfH = Math.max(0.5, cc.h * cx * 0.92);
      const a = globalAlpha * playFactor;
      // Upper bar — full colour
      ctx.fillStyle = `rgba(${cc.r},${cc.g},${cc.b},${a})`;
      ctx.fillRect(px, cx - halfH, barW, halfH);
      // Lower bar — mirrored at 65% for visual depth
      ctx.fillStyle = `rgba(${cc.r},${cc.g},${cc.b},${a * 0.65})`;
      ctx.fillRect(px, cx, barW, halfH);
    } else {
      const mc = col as NormalizedMonoCol;
      const halfH = Math.max(0.5, mc.h * cx * 0.92);
      // Intensity maps i ∈ [0,1] to alpha ∈ [0.35, 1.0]
      const intensity = 0.35 + mc.i * 0.65;
      const a = intensity * globalAlpha * playFactor;
      const [mr, mg, mb] = monoColor;
      // Both halves rendered together — symmetric mono bar
      ctx.fillStyle = `rgba(${mr},${mg},${mb},${a})`;
      ctx.fillRect(px, cx - halfH, barW, halfH * 2);
    }
  }

  // Playhead — 1 logical pixel wide, near-white for maximum contrast
  if (progressX !== null && progressX >= 0 && progressX <= cssW) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    // Centre on the progress position
    ctx.fillRect(Math.max(0, progressX - 0.5), 0, 1, cssH);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RekordboxPreviewWaveform({
  state,
  height = 40,
  className,
  activeProgress,
  onSeek,
  onRetry,
  dimmed = false,
  ariaLabel,
}: RekordboxPreviewWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const containerWidth = useContainerWidth(containerRef);
  const dpr = useDevicePixelRatio();
  const theme = useDocumentTheme();
  const waveform = state.status === 'loaded' ? state.waveform : null;

  const normalized = useMemo(() => {
    if (!waveform || !waveform.previewColumnsValid) return null;
    return normalizeWaveform(waveform);
  }, [waveform]);

  const displayWidth = Math.max(1, Math.floor(containerWidth));
  const buckets = useMemo(
    () => (normalized ? buildDisplayBuckets(normalized.cols, displayWidth) : null),
    [normalized, displayWidth],
  );

  const monoColor = resolveMonoBaseColor(theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0 || !buckets || !normalized) return;

    const cssW = containerWidth;
    const cssH = height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    drawWaveform(ctx, buckets, normalized.kind, cssW, cssH, {
      monoColor,
      dimmed,
      progressX: null,
    });
    ctx.restore();
  }, [buckets, normalized, containerWidth, height, dpr, monoColor, dimmed]);

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek || state.status !== 'loaded') return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(fraction);
  }

  const fallbackInvalidState: WaveformLoadState | null =
    state.status === 'loaded' && !normalized
      ? {
          status: 'invalid',
          trackId: state.trackId,
          error: 'Waveform data could not be normalized for rendering.',
          reason: 'invalid',
          retryable: false,
        }
      : null;
  const displayState = fallbackInvalidState ?? state;

  const label = ariaLabel || waveformStateLabel(displayState);
  const progress = activeProgress != null ? clampProgress(activeProgress) : null;
  const canSeek = Boolean(onSeek && displayState.status === 'loaded');

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden', canSeek && 'cursor-pointer', className)}
      style={{ height }}
      role={displayState.status === 'loaded' ? 'img' : 'group'}
      aria-label={label}
      aria-live={displayState.status === 'error' || displayState.status === 'invalid' ? 'polite' : undefined}
      onClick={canSeek ? handleContainerClick : undefined}
      data-waveform-status={displayState.status}
      data-waveform-track-id={displayState.trackId ?? undefined}
    >
      {displayState.status !== 'loaded' ? (
        <WaveformEmptyState state={displayState} height={height} onRetry={onRetry} />
      ) : (
        <>
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="block"
            style={{ display: 'block', imageRendering: 'pixelated' }}
          />
          {progress !== null && progress > 0 && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                right: `${(1 - progress) * 100}%`,
                backgroundColor: 'var(--color-background)',
                opacity: 0.65,
                pointerEvents: 'none',
              }}
            />
          )}
          {progress !== null && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${progress * 100}%`,
                width: 1,
                backgroundColor: 'var(--color-foreground)',
                opacity: 0.9,
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function waveformStateLabel(state: WaveformLoadState): string {
  switch (state.status) {
    case 'idle': return 'Waveform not requested';
    case 'loading': return 'Loading waveform';
    case 'loaded': return 'Track waveform';
    case 'unavailable': return 'No waveform available for this track';
    case 'error': return `Waveform failed to load: ${state.error}`;
    case 'invalid': return `${state.reason === 'unsupported' ? 'Unsupported' : 'Invalid'} waveform data: ${state.error}`;
  }
}

// ── Empty state sub-component ─────────────────────────────────────────────────

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
          className="w-full rounded-sm animate-pulse bg-muted-foreground/15"
          style={{ height: Math.max(2, Math.round(height * 0.35)) }}
        />
      </div>
    );
  }

  if (state.status === 'idle') {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-1" aria-hidden="true">
        <div className="w-full h-px rounded-sm bg-muted-foreground/10" />
      </div>
    );
  }

  const compact = height < 32;
  const message = state.status === 'unavailable'
    ? (compact ? 'No waveform' : 'No waveform available')
    : state.status === 'error'
      ? (compact ? 'Load failed' : `Waveform failed: ${state.error}`)
      : state.reason === 'unsupported'
        ? (compact ? 'Unsupported data' : `Unsupported waveform: ${state.error}`)
        : (compact ? 'Invalid data' : `Invalid waveform: ${state.error}`);

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
