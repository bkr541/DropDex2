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
import type { TrackPreviewWaveform } from '../../lib/queries/waveformValidation';
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
  /**
   * Validated waveform data from the database.
   * Pass `null` when data is not yet loaded or when the track has no waveform row.
   */
  waveform: TrackPreviewWaveform | null;
  /**
   * CSS height of the waveform container in pixels.
   * @default 40
   */
  height?: number;
  /** Additional class names applied to the outer container div. */
  className?: string;
  /**
   * Playback progress, clamped to [0, 1].
   * The played (left) region is dimmed via a CSS overlay; a 1-px playhead is
   * drawn at this position. Omit or pass `undefined` to disable.
   */
  activeProgress?: number;
  /**
   * Called when the user clicks the waveform to seek.
   * Receives a fraction in [0, 1] corresponding to the click position.
   * When omitted, click events bubble to the parent (e.g. opens track detail).
   */
  onSeek?: (fraction: number) => void;
  /** Render the entire waveform at reduced opacity (35%). */
  dimmed?: boolean;
  /**
   * True while waveform data is being fetched.
   * Shows a skeleton pulse instead of the waveform.
   */
  loading?: boolean;
  /**
   * True when the track is confirmed to have no waveform row in the database.
   * Shows a "No waveform" placeholder; does not display the fake visualiser.
   */
  unavailable?: boolean;
  /** Accessible label for the canvas / container. */
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
  waveform,
  height = 40,
  className,
  activeProgress,
  onSeek,
  dimmed = false,
  loading = false,
  unavailable = false,
  ariaLabel,
}: RekordboxPreviewWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const containerWidth = useContainerWidth(containerRef);
  const dpr = useDevicePixelRatio();
  const theme = useDocumentTheme();

  // Normalise waveform data once — re-runs only when waveform identity changes.
  const normalized = useMemo(() => {
    if (!waveform || !waveform.previewColumnsValid) return null;
    return normalizeWaveform(waveform);
  }, [waveform]);

  // Build display-width buckets — re-runs when normalized data or width changes.
  const displayWidth = Math.max(1, Math.floor(containerWidth));
  const buckets = useMemo(
    () => (normalized ? buildDisplayBuckets(normalized.cols, displayWidth) : null),
    [normalized, displayWidth],
  );

  const monoColor = resolveMonoBaseColor(theme);

  // Paint canvas whenever waveform data, layout, theme, or DPR changes.
  // Progress is intentionally excluded — it is shown via CSS overlay,
  // so the canvas never redraws during playback.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0 || !buckets || !normalized) return;

    const cssW = containerWidth;
    const cssH = height;

    // Size the backing store to physical pixels.
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    // All subsequent coordinates are in CSS logical pixels.
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    drawWaveform(ctx, buckets, normalized.kind, cssW, cssH, {
      monoColor,
      dimmed,
      progressX: null, // canvas always draws at full opacity; overlay is CSS
    });

    ctx.restore();
  }, [buckets, normalized, containerWidth, height, dpr, monoColor, dimmed]);

  // ── Click-to-seek ─────────────────────────────────────────────────────────────

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(fraction);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const label = ariaLabel ??
    (loading ? 'Loading waveform' :
     unavailable ? 'No waveform available' :
     'Track waveform');

  const showEmptyState = loading || unavailable || !normalized;

  // CSS progress overlay values — only computed when activeProgress is present.
  const progress = activeProgress != null ? clampProgress(activeProgress) : null;

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden', onSeek && 'cursor-pointer', className)}
      style={{ height }}
      role="img"
      aria-label={label}
      onClick={onSeek ? handleContainerClick : undefined}
    >
      {showEmptyState ? (
        <WaveformEmptyState
          loading={loading}
          unavailable={unavailable}
          analysisInvalid={!loading && !unavailable && waveform != null && !normalized}
          height={height}
        />
      ) : (
        <>
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="block"
            style={{ display: 'block', imageRendering: 'pixelated' }}
          />
          {/* CSS progress overlay — no canvas redraws during playback.
              Played (left) region is dimmed with a background-color overlay so
              RGB waveform colors are preserved underneath. */}
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
          {/* Playhead — 1 logical pixel, uses foreground color for theme contrast */}
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

// ── Empty state sub-component ─────────────────────────────────────────────────

interface WaveformEmptyStateProps {
  loading: boolean;
  unavailable: boolean;
  analysisInvalid: boolean;
  height: number;
}

function WaveformEmptyState({
  loading,
  analysisInvalid,
  height,
}: WaveformEmptyStateProps) {
  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-1">
        <div
          className="w-full rounded-sm animate-pulse bg-muted-foreground/10"
          style={{ height: Math.round(height * 0.35) }}
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center px-1">
      <div
        className={cn(
          'w-full rounded-sm',
          analysisInvalid ? 'bg-red-400/15' : 'bg-muted-foreground/10',
        )}
        style={{ height: 1 }}
      />
    </div>
  );
}
