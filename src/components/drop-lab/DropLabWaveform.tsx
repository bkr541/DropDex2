import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CrossTab } from '@carbon/icons-react';
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
  barCount: number;
}

const BUILD = [255, 138, 31] as const;
const DROP = [255, 90, 79] as const;
const BUILD_HEX = '#ff8a1f';
const DROP_HEX = '#ff5a4f';
const SWAP_HEX = '#3b91ff';
const WAVE_HEIGHT = 84;
const INSET = 24;

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function Lane({ height, children }: { height: number; children?: ReactNode }) {
  return (
    <div className="relative" style={{ height, paddingInline: INSET }}>
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

/**
 * The transition timeline in the Cue Points style: swap cue marker, section labels,
 * the two waveform halves (selected build, candidate drop) meeting at the swap cue,
 * and a bar grid counted in bars before and after the swap.
 */
export function DropLabWaveform({
  sourceSegment,
  candidateSegment,
  loading,
  unavailableMessage,
  previewProgress = 0,
  previewPlaying = false,
  alignmentLabel = 'Candidate starts exactly on its detected drop',
  barCount,
}: DropLabWaveformProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useWidth(wrapperRef);
  const sourceColumns = useMemo(() => toRenderableColumns(sourceSegment), [sourceSegment]);
  const candidateColumns = useMemo(() => toRenderableColumns(candidateSegment), [candidateSegment]);
  const unavailable = sourceColumns.length === 0 || candidateColumns.length === 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || unavailable) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(WAVE_HEIGHT * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${WAVE_HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, WAVE_HEIGHT);
    const halfWidth = width / 2;
    const midY = WAVE_HEIGHT / 2;

    const draw = (columns: typeof sourceColumns, startX: number, drawWidth: number, color: readonly [number, number, number]) => {
      const targetColumns = Math.max(24, Math.floor(drawWidth / 2.1));
      const displayColumns = bucketRenderableColumns(columns, targetColumns);
      const step = drawWidth / Math.max(1, displayColumns.length);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, Math.min(2.2, step * 0.54));
      displayColumns.forEach((column, index) => {
        const x = startX + (index + 0.5) * step;
        const halfHeight = Math.max(1.5, column.height * WAVE_HEIGHT * 0.46);
        const intensity = column.intensity ?? column.height;
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.4 + Math.min(1, intensity) * 0.55})`;
        ctx.beginPath();
        ctx.moveTo(x, midY - halfHeight);
        ctx.lineTo(x, midY + halfHeight);
        ctx.stroke();
      });
    };
    draw(sourceColumns, 0, halfWidth, BUILD);
    draw(candidateColumns, halfWidth, halfWidth, DROP);
    ctx.restore();
  }, [sourceColumns, candidateColumns, width, unavailable]);

  const beatsPerHalf = barCount * 4;
  const grid = useMemo(() => {
    let beats = '';
    let bars = '';
    for (let i = 0; i <= beatsPerHalf * 2; i += 1) {
      beats += `M${i} 0V62`;
      if (i % 4 === 0) bars += `M${i} 35V100`;
    }
    return { beats, bars };
  }, [beatsPerHalf]);
  const labelEvery = barCount > 8 ? 2 : 1;
  const barIndexes = Array.from({ length: barCount }, (_, i) => i).filter((i) => i % labelEvery === 0);
  const progress = Math.max(0, Math.min(1, previewProgress));

  return (
    <div className="shrink-0 pt-1">
      <Lane height={32}>
        <div className="absolute -translate-x-1/2" style={{ left: '50%', top: 4 }}>
          <div className="relative" title="Automatic swap cue">
            <svg width={26} height={29} viewBox="0 0 28 32" aria-hidden="true"><path d="M3 2h22a1 1 0 0 1 1 1v17.5a2 2 0 0 1-.9 1.7L14 30 2.9 22.2A2 2 0 0 1 2 20.5V3a1 1 0 0 1 1-1z" fill={`${SWAP_HEX}22`} stroke={SWAP_HEX} strokeWidth="2" /></svg>
            <span className="absolute inset-x-0 top-[5px] flex justify-center" style={{ color: SWAP_HEX }}><CrossTab size={13} /></span>
          </div>
        </div>
      </Lane>
      <Lane height={26}>
        <div className="absolute left-0 top-0 flex items-center justify-center font-mono text-[9px] font-bold tracking-wide" style={{ width: '50%', height: 22, color: BUILD_HEX, borderBottom: `2px solid ${BUILD_HEX}` }}>SELECTED BUILD</div>
        <div className="absolute right-0 top-0 flex items-center justify-center font-mono text-[9px] font-bold tracking-wide" style={{ width: '50%', height: 22, color: DROP_HEX, borderBottom: `2px solid ${DROP_HEX}` }}>CANDIDATE DROP</div>
      </Lane>
      <Lane height={WAVE_HEIGHT}>
        <div
          ref={wrapperRef}
          className="relative h-full overflow-hidden"
          role="img"
          aria-label="Transition waveform. The selected track buildup plays on the left, swaps at the center cue, and the active candidate drop plays on the right."
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center"><div className="h-12 w-4/5 animate-pulse rounded-lg bg-white/[0.06]" /></div>
          ) : unavailable ? (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
              {unavailableMessage || sourceSegment?.unavailableReason || candidateSegment?.unavailableReason || 'Waveform segment unavailable'}
            </div>
          ) : (
            <canvas ref={canvasRef} className="block" />
          )}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-[2px] -translate-x-1/2" style={{ background: SWAP_HEX }} />
          {!unavailable && !loading && previewPlaying && progress > 0 && (
            <div className="pointer-events-none absolute inset-y-0 z-30 w-px bg-white shadow-[0_0_7px_rgba(255,255,255,0.75)]" style={{ left: `${progress * 100}%` }}>
              <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-[2px] rotate-45 rounded-[1px] bg-white" />
            </div>
          )}
        </div>
      </Lane>
      <Lane height={22}>
        <svg viewBox={`0 0 ${beatsPerHalf * 2} 100`} preserveAspectRatio="none" width="100%" height={22} style={{ display: 'block' }} aria-hidden="true">
          <path d={grid.beats} stroke="#3ddc84" strokeWidth="0.55" fill="none" vectorEffect="non-scaling-stroke" strokeOpacity="0.85" />
          <path d={grid.bars} stroke="#ff6b6b" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      </Lane>
      <Lane height={18}>
        {barIndexes.map((i) => (
          <span key={`before-${i}`} className="absolute font-mono text-[11px] leading-[18px] tabular-nums text-muted-foreground" style={{ left: `${(i / barCount) * 50}%` }}>{`−${barCount - i}`}</span>
        ))}
        {barIndexes.map((i) => (
          <span key={`after-${i}`} className="absolute font-mono text-[11px] leading-[18px] tabular-nums text-muted-foreground" style={{ left: `${50 + (i / barCount) * 50}%` }}>{i + 1}</span>
        ))}
      </Lane>
      <div className="flex items-center justify-between gap-3 px-[var(--drop-lab-inset,24px)] pb-1 pt-0.5 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate"><span className="font-bold uppercase tracking-[0.14em]" style={{ color: BUILD_HEX }}>First</span> · play the selected track&apos;s build</span>
        <span className="shrink-0 rounded-md border px-2 py-0.5 font-medium" style={{ borderColor: `${SWAP_HEX}59`, color: SWAP_HEX }}>Automatic swap cue · {alignmentLabel}</span>
        <span className="min-w-0 truncate text-right"><span className="font-bold uppercase tracking-[0.14em]" style={{ color: DROP_HEX }}>Then</span> · swap into the candidate drop</span>
      </div>
    </div>
  );
}
