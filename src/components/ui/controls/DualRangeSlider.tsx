import { useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from 'react';
import { Close } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';

export type DualRangeVariant = 'rings' | 'pills' | 'flags' | 'ticks' | 'histogram' | 'capsule';

type ThumbKind = 'minimum' | 'maximum';
type ThumbProps = HTMLAttributes<HTMLDivElement> & { role: 'slider' };

interface DualRangeState {
  trackRef: React.RefObject<HTMLDivElement | null>;
  lo: number;
  hi: number;
  bMin: number;
  bMax: number;
  loPct: number;
  hiPct: number;
  isFiltered: boolean;
  thumb: (kind: ThumbKind) => ThumbProps;
}

/**
 * Behavior shared by every look: pointer drag on either thumb, keyboard
 * (arrows 1, PageUp/Down 5, Home/End to the nearest limit), and the thumbs can
 * touch but never cross.
 */
function useDualRange(
  bounds: [number, number],
  value: [number, number],
  onChange: (range: [number, number]) => void,
  label: string,
  unit: string,
): DualRangeState {
  const trackRef = useRef<HTMLDivElement>(null);
  const [lo, hi] = value;
  const [bMin, bMax] = bounds;
  const span = bMax - bMin || 1;

  const valueFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return bMin;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
    return Math.round(bMin + pct * span);
  };

  const move = (event: PointerEvent<HTMLDivElement>, kind: ThumbKind) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = valueFromClientX(event.clientX);
    if (kind === 'minimum') onChange([Math.min(next, hi), hi]);
    else onChange([lo, Math.max(next, lo)]);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>, kind: ThumbKind) => {
    const current = kind === 'minimum' ? lo : hi;
    const minimum = kind === 'minimum' ? bMin : lo;
    const maximum = kind === 'minimum' ? hi : bMax;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 1;
    else if (event.key === 'PageDown') next = current - 5;
    else if (event.key === 'PageUp') next = current + 5;
    else if (event.key === 'Home') next = minimum;
    else if (event.key === 'End') next = maximum;
    if (next == null) return;
    event.preventDefault();
    const clamped = Math.max(minimum, Math.min(maximum, next));
    if (kind === 'minimum') onChange([clamped, hi]);
    else onChange([lo, clamped]);
  };

  const thumb = (kind: ThumbKind): ThumbProps => {
    const current = kind === 'minimum' ? lo : hi;
    return {
      role: 'slider',
      tabIndex: 0,
      'aria-label': `${kind === 'minimum' ? 'Minimum' : 'Maximum'} ${label}`,
      'aria-valuemin': kind === 'minimum' ? bMin : lo,
      'aria-valuemax': kind === 'minimum' ? hi : bMax,
      'aria-valuenow': current,
      'aria-valuetext': `${current}${unit}`,
      onPointerDown: (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event, kind);
      },
      onPointerMove: (event) => move(event, kind),
      onKeyDown: (event) => keyDown(event, kind),
    };
  };

  return {
    trackRef, lo, hi, bMin, bMax,
    loPct: ((lo - bMin) / span) * 100,
    hiPct: ((hi - bMin) / span) * 100,
    isFiltered: lo > bMin || hi < bMax,
    thumb,
  };
}

// Palette: the Cue Points filter row. Neutral rails and fills (white at 15% / foreground),
// control-surface thumbs with control borders, foreground values, and blue only on focus.
const FOCUS = 'focus-visible:outline-none focus-visible:border-[var(--color-control-focus)] focus-visible:ring-2 focus-visible:ring-primary/30';
const GRAB = 'cursor-grab active:cursor-grabbing touch-none';
const SURFACE = 'bg-[var(--color-control-surface)]';
const THUMB_BORDER = 'border border-white/30 hover:border-white/55 transition-colors';
const RAIL = 'bg-white/15';
const FILL = 'bg-foreground/75';

/** Round thumbs with the value inside, hairline rail. */
function Rings({ s }: { s: DualRangeState }) {
  return (
    <div ref={s.trackRef} className="relative mx-3.5 h-7 select-none">
      <div className={cn('absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded-full', RAIL)} />
      <div className={cn('absolute top-1/2 h-px -translate-y-1/2 rounded-full', FILL)} style={{ left: `${s.loPct}%`, right: `${100 - s.hiPct}%` }} />
      {(['minimum', 'maximum'] as const).map((kind) => (
        <div
          key={kind}
          {...s.thumb(kind)}
          className={cn('absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full', SURFACE, THUMB_BORDER, GRAB, FOCUS)}
          style={{ left: `${kind === 'minimum' ? s.loPct : s.hiPct}%` }}
        >
          <span className="pointer-events-none text-[8px] font-black leading-none tabular-nums text-foreground">{kind === 'minimum' ? s.lo : s.hi}</span>
        </div>
      ))}
    </div>
  );
}

/** Rounded-rectangle thumbs holding the value, on a thicker rail. */
function Pills({ s }: { s: DualRangeState }) {
  return (
    <div ref={s.trackRef} className="relative mx-[18px] h-7 select-none">
      <div className={cn('absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full', RAIL)} />
      <div className={cn('absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full', FILL)} style={{ left: `${s.loPct}%`, right: `${100 - s.hiPct}%` }} />
      {(['minimum', 'maximum'] as const).map((kind) => (
        <div
          key={kind}
          {...s.thumb(kind)}
          className={cn('absolute top-1/2 flex h-[22px] min-w-[34px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-[var(--color-control-surface-raised)] px-1.5', THUMB_BORDER, GRAB, FOCUS)}
          style={{ left: `${kind === 'minimum' ? s.loPct : s.hiPct}%` }}
        >
          <span className="pointer-events-none text-[10px] font-black leading-none tabular-nums text-foreground">{kind === 'minimum' ? s.lo : s.hi}</span>
        </div>
      ))}
    </div>
  );
}

/** Small dot thumbs with a value flag above each, like a cue pin. */
function Flags({ s }: { s: DualRangeState }) {
  return (
    <div ref={s.trackRef} className="relative mx-3 h-[38px] select-none">
      <div className={cn('absolute inset-x-0 bottom-[7px] h-[2px] rounded-full', RAIL)} />
      <div className={cn('absolute bottom-[7px] h-[2px] rounded-full', FILL)} style={{ left: `${s.loPct}%`, right: `${100 - s.hiPct}%` }} />
      {(['minimum', 'maximum'] as const).map((kind) => (
        <div
          key={kind}
          {...s.thumb(kind)}
          className={cn('group absolute bottom-[8px] flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full', GRAB, 'focus-visible:outline-none')}
          style={{ left: `${kind === 'minimum' ? s.loPct : s.hiPct}%` }}
        >
          <span className="pointer-events-none absolute bottom-[19px] flex flex-col items-center">
            <span className={cn('rounded-[4px] border border-[var(--color-control-border)] px-1.5 py-[1px] text-[9px] font-black leading-[13px] tabular-nums text-foreground group-focus-visible:border-[var(--color-control-focus)]', SURFACE)}>{kind === 'minimum' ? s.lo : s.hi}</span>
            <span className={cn('-mt-[3px] h-[5px] w-[5px] rotate-45 border-b border-r border-[var(--color-control-border)] group-focus-visible:border-[var(--color-control-focus)]', SURFACE)} />
          </span>
          <span className="pointer-events-none h-3 w-3 rounded-full border-2 border-[var(--color-control-surface)] bg-foreground ring-1 ring-white/30 group-hover:ring-white/55 group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-control-focus)]" />
        </div>
      ))}
    </div>
  );
}

/** The rail is a row of beat-grid-style ticks; ticks inside the range are brighter. */
function Ticks({ s }: { s: DualRangeState }) {
  const count = 49;
  return (
    <div ref={s.trackRef} className="relative mx-2 h-7 select-none">
      <div className="absolute inset-0 flex items-center justify-between">
        {Array.from({ length: count }, (_, i) => {
          const pct = (i / (count - 1)) * 100;
          const inside = pct >= s.loPct - 0.01 && pct <= s.hiPct + 0.01;
          const major = i % 6 === 0;
          return <span key={i} className="w-px rounded-full" style={{ height: major ? 20 : 12, background: inside ? 'var(--color-foreground)' : 'rgba(255,255,255,0.15)', opacity: inside ? (major ? 0.85 : 0.55) : 1 }} />;
        })}
      </div>
      {(['minimum', 'maximum'] as const).map((kind) => (
        <div
          key={kind}
          {...s.thumb(kind)}
          className={cn('group absolute inset-y-[-2px] flex w-4 -translate-x-1/2 items-center justify-center', GRAB, 'focus-visible:outline-none')}
          style={{ left: `${kind === 'minimum' ? s.loPct : s.hiPct}%` }}
        >
          <span className="pointer-events-none h-full w-[3px] rounded-sm bg-foreground ring-1 ring-white/20 group-hover:ring-white/45 group-focus-visible:bg-[var(--color-control-focus)] group-focus-visible:ring-primary/40" />
        </div>
      ))}
    </div>
  );
}

const DEFAULT_DISTRIBUTION = [1, 0, 2, 1, 3, 2, 4, 6, 9, 14, 11, 8, 6, 5, 7, 5, 3, 2, 3, 1, 1, 2, 1, 0];

/** The rail is the library's BPM spread; bars inside the range are brighter. */
function Histogram({ s, distribution }: { s: DualRangeState; distribution: number[] }) {
  const max = Math.max(1, ...distribution);
  return (
    <div ref={s.trackRef} className="relative mx-2 h-[38px] select-none">
      <div className="absolute inset-0 flex items-end gap-[2px]">
        {distribution.map((n, i) => {
          const center = ((i + 0.5) / distribution.length) * 100;
          const inside = center >= s.loPct && center <= s.hiPct;
          return <span key={i} className="flex-1 rounded-[1px]" style={{ height: `${Math.max(8, (n / max) * 100)}%`, background: inside ? 'var(--color-foreground)' : 'rgba(255,255,255,0.13)', opacity: inside ? 0.6 : 1 }} />;
        })}
      </div>
      {(['minimum', 'maximum'] as const).map((kind) => (
        <div
          key={kind}
          {...s.thumb(kind)}
          className={cn('group absolute inset-y-[-3px] flex w-4 -translate-x-1/2 flex-col items-center', GRAB, 'focus-visible:outline-none')}
          style={{ left: `${kind === 'minimum' ? s.loPct : s.hiPct}%` }}
        >
          <span className="pointer-events-none h-full w-[2px] bg-foreground group-focus-visible:bg-[var(--color-control-focus)]" />
          <span className="pointer-events-none absolute -bottom-[1px] h-[7px] w-[7px] rounded-full bg-foreground ring-1 ring-[var(--color-control-surface)] group-focus-visible:bg-[var(--color-control-focus)]" />
        </div>
      ))}
    </div>
  );
}

/** Thick inset capsule rail with a neutral fill and raised handles. */
function Capsule({ s }: { s: DualRangeState }) {
  return (
    <div ref={s.trackRef} className="relative mx-3 h-7 select-none">
      <div className={cn('absolute inset-x-0 top-1/2 h-[10px] -translate-y-1/2 rounded-full border border-[var(--color-control-border)] shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.5)]', SURFACE)} />
      <div
        className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-full"
        style={{ left: `${s.loPct}%`, right: `${100 - s.hiPct}%`, background: 'linear-gradient(90deg, rgb(255 255 255 / 0.28), rgb(255 255 255 / 0.55))' }}
      />
      {(['minimum', 'maximum'] as const).map((kind) => (
        <div
          key={kind}
          {...s.thumb(kind)}
          className={cn('absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-control-surface-raised)] shadow-[0_2px_6px_rgb(0_0_0_/_0.5)]', 'border-2 border-white/45 hover:border-white/70 transition-colors', GRAB, FOCUS)}
          style={{ left: `${kind === 'minimum' ? s.loPct : s.hiPct}%` }}
        />
      ))}
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

/** Variants that don't show the values on the thumbs show them as a readout beside the label. */
const READOUT_VARIANTS: DualRangeVariant[] = ['ticks', 'histogram', 'capsule'];

export function DualRangeSlider({
  bounds,
  value,
  onChange,
  onReset,
  label = 'BPM',
  unit = ' BPM',
  variant = 'rings',
  distribution = DEFAULT_DISTRIBUTION,
  className,
  style,
}: {
  bounds: [number, number];
  value: [number, number];
  onChange: (range: [number, number]) => void;
  onReset?: () => void;
  label?: string;
  unit?: string;
  variant?: DualRangeVariant;
  distribution?: number[];
  className?: string;
  style?: CSSProperties;
}) {
  const s = useDualRange(bounds, value, onChange, label, unit);
  const showReadout = READOUT_VARIANTS.includes(variant);
  return (
    <div className={cn('min-w-[180px] border-b border-white/15 pb-2 transition-colors hover:border-white/35 focus-within:border-[var(--color-control-focus)]', className)} style={style}>
      <div className="mb-1 flex items-center gap-1">
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        {showReadout && (
          <span className="ml-auto font-mono text-[10px] font-bold tabular-nums text-foreground">
            {s.lo}<span className="text-muted-foreground"> – </span>{s.hi}<span className="ml-0.5 text-[8px] font-semibold text-muted-foreground">{unit.trim()}</span>
          </span>
        )}
        {s.isFiltered && onReset && (
          <button type="button" onClick={onReset} className={cn('shrink-0 text-red-400 transition-colors hover:text-red-300 focus-visible:outline-none', !showReadout && 'ml-auto')} aria-label={`Reset ${label} filter`}>
            <Close size={12} />
          </button>
        )}
      </div>
      {variant === 'rings' && <Rings s={s} />}
      {variant === 'pills' && <Pills s={s} />}
      {variant === 'flags' && <Flags s={s} />}
      {variant === 'ticks' && <Ticks s={s} />}
      {variant === 'histogram' && <Histogram s={s} distribution={distribution} />}
      {variant === 'capsule' && <Capsule s={s} />}
    </div>
  );
}
