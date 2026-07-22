import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
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
    const height = 176;
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
    const midY = height / 2;
    const neutral = parseRgb(themeColor('--color-foreground', '#f8fafc'));
    const accent = parseRgb(themeColor('--color-primary', '#cf6b65'));

    const draw = (
      columns: typeof sourceColumns,
      startX: number,
      drawWidth: number,
      color: [number, number, number],
    ) => {
      const displayColumns = bucketRenderableColumns(
        columns,
        Math.max(1, Math.floor(drawWidth)),
      );
      const barWidth = drawWidth / Math.max(1, displayColumns.length);
      displayColumns.forEach((column, index) => {
        const x = startX + index * barWidth;
        const halfHeight = Math.max(1, column.height * midY * 0.9);
        const rgb =
          column.r == null
            ? color
            : [column.r, column.g ?? color[1], column.b ?? color[2]];
        const alpha =
          column.intensity != null ? 0.45 + column.intensity * 0.55 : 0.92;
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
        ctx.fillRect(x, midY - halfHeight, barWidth, halfHeight * 2);
      });
    };

    draw(sourceColumns, 0, halfWidth, neutral);
    draw(candidateColumns, halfWidth, halfWidth, accent);
    ctx.restore();
  }, [sourceColumns, candidateColumns, width, unavailable]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        <span>Build · Selected Track</span>
        <span className="text-right">Drop · Active Candidate</span>
      </div>
      <div
        ref={wrapperRef}
        className="relative h-44 rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
        role="img"
        aria-label="Shared waveform showing selected track buildup on the left and active candidate drop on the right, aligned at the center drop cue."
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4/5 h-8 rounded bg-muted-foreground/10 animate-pulse" />
          </div>
        ) : unavailable ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
            {unavailableMessage ||
              sourceSegment?.unavailableReason ||
              candidateSegment?.unavailableReason ||
              'Waveform segment unavailable'}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="block"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-foreground/80 shadow-[0_0_18px_rgba(255,255,255,0.35)]" />
        <div className="absolute left-1/2 top-1/2 w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-background bg-primary shadow-primary-control" />
        <div className="absolute left-1/2 bottom-3 -translate-x-1/2 px-2 py-1 rounded-md bg-background/80 border border-[var(--color-border-subtle)] text-[9px] font-bold uppercase tracking-widest text-primary whitespace-nowrap">
          Aligned Drop Cue
        </div>
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 w-px pointer-events-none',
            unavailable && 'opacity-50',
          )}
        />
      </div>
    </div>
  );
}
