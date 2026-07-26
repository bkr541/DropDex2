import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Crosshair } from 'lucide-react';
import {
  bucketRenderableColumns,
  toRenderableColumns,
  type WaveformSegment,
} from '../../lib/music/waveformSegments';

interface DropLabWaveformProps {
  sourceSegment: WaveformSegment | null;
  candidateSegment: WaveformSegment | null;
  loading?: boolean;
  unavailableMessage?: string;
  previewProgress?: number;
  previewPlaying?: boolean;
  alignmentLabel?: string;
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function parseRgb(css: string): [number, number, number] {
  const div = document.createElement('div');
  div.style.color = css;
  document.body.appendChild(div);
  const value = getComputedStyle(div).color;
  div.remove();
  const match = value.match(/\d+/g)?.map(Number);
  return [match?.[0] ?? 255, match?.[1] ?? 255, match?.[2] ?? 255];
}

export function DropLabWaveform({
  sourceSegment,
  candidateSegment,
  loading,
  unavailableMessage,
  previewProgress = 0,
  previewPlaying = false,
  alignmentLabel = 'Candidate starts exactly on its detected drop',
}: DropLabWaveformProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useWidth(wrapperRef);
  const sourceColumns = useMemo(
    () => toRenderableColumns(sourceSegment),
    [sourceSegment],
  );
  const candidateColumns = useMemo(
    () => toRenderableColumns(candidateSegment),
    [candidateSegment],
  );
  const unavailable =
    sourceColumns.length === 0 || candidateColumns.length === 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || unavailable) return;
    const dpr = window.devicePixelRatio || 1;
    const height = 192;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const halfWidth = width / 2;
    const midY = height / 2 + 5;
    const sourceColor = parseRgb(themeColor('--color-foreground', '#f8fafc'));
    const candidateColor = parseRgb(themeColor('--color-primary', '#cf6b65'));

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY + 0.5);
    ctx.lineTo(width, midY + 0.5);
    ctx.stroke();

    const draw = (
      columns: typeof sourceColumns,
      startX: number,
      drawWidth: number,
      color: [number, number, number],
    ) => {
      const targetColumns = Math.max(24, Math.floor(drawWidth / 2.1));
      const displayColumns = bucketRenderableColumns(columns, targetColumns);
      const step = drawWidth / Math.max(1, displayColumns.length);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, Math.min(2.2, step * 0.54));

      displayColumns.forEach((column, index) => {
        const x = startX + (index + 0.5) * step;
        const halfHeight = Math.max(1.5, column.height * height * 0.39);
        const intensity = column.intensity ?? column.height;
        const alpha = 0.35 + Math.min(1, intensity) * 0.58;
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x, midY - halfHeight);
        ctx.lineTo(x, midY + halfHeight);
        ctx.stroke();
      });
    };

    draw(sourceColumns, 0, halfWidth, sourceColor);
    draw(candidateColumns, halfWidth, halfWidth, candidateColor);
    ctx.restore();
  }, [sourceColumns, candidateColumns, width, unavailable]);

  const safeProgress = Math.max(0, Math.min(1, previewProgress));

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className="relative h-48 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-inner"
        role="img"
        aria-label="Transition waveform. The selected track buildup plays on the left, swaps at the center cue, and the active candidate drop plays on the right."
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-foreground/[0.045] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-primary/[0.10] to-transparent" />

        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0 rounded-lg border border-[var(--color-border-faint)] bg-background/70 px-3 py-2 backdrop-blur-sm">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">First</p>
            <p className="truncate text-xs font-bold">Play selected track build</p>
          </div>
          <ArrowRight size={16} className="text-muted-foreground" />
          <div className="min-w-0 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-right backdrop-blur-sm">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-primary">Then</p>
            <p className="truncate text-xs font-bold">Swap into candidate drop</p>
          </div>
        </div>

        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center pt-12">
            <div className="h-14 w-4/5 animate-pulse rounded-xl bg-muted-foreground/10" />
          </div>
        ) : unavailable ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 pt-12 text-center text-xs text-muted-foreground">
            {unavailableMessage ||
              sourceSegment?.unavailableReason ||
              candidateSegment?.unavailableReason ||
              'Waveform segment unavailable'}
          </div>
        ) : (
          <canvas ref={canvasRef} className="block" />
        )}

        {!unavailable && !loading && safeProgress > 0 && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-primary/[0.055]"
              style={{ width: `${safeProgress * 100}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary shadow-[0_0_14px_rgba(59,130,246,0.8)]"
              style={{ left: `${safeProgress * 100}%` }}
            />
          </>
        )}

        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-px bg-foreground/75 shadow-[0_0_18px_rgba(255,255,255,0.32)]" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-primary text-white shadow-primary-control">
          <Crosshair size={15} />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-primary/35 bg-background/90 px-3 py-1.5 text-center backdrop-blur-sm">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-primary">Automatic swap cue</p>
          <p className="mt-0.5 whitespace-nowrap text-[9px] text-muted-foreground">{alignmentLabel}</p>
        </div>

        {previewPlaying && (
          <div className="pointer-events-none absolute right-3 top-[68px] z-20 rounded-full border border-primary/35 bg-background/80 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-primary backdrop-blur-sm">
            Preview playing
          </div>
        )}
      </div>
      <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
        Audio plays left to right. At the center marker, Drop Lab stops the selected buildup and starts the candidate from the chosen entry cue.
      </p>
    </div>
  );
}
