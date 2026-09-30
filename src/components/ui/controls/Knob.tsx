import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../../../lib/utils';

const SWEEP_DEG = 135;
const DRAG_PX_FOR_FULL_RANGE = 160;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, fromDeg);
  const [x2, y2] = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
}

/**
 * Rotary knob centered on zero (pointing straight up at `defaultValue`).
 * Drag up/down to change, double-click to reset, arrow keys for fine steps.
 */
export function Knob({
  label,
  value,
  onChange,
  min = -12,
  max = 12,
  step = 0.5,
  defaultValue = 0,
  size = 34,
  accent = 'var(--color-primary)',
  formatValue = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  disabled = false,
  ariaLabel,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  size?: number;
  accent?: string;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const span = max - min;
  const fraction = span > 0 ? (value - min) / span : 0.5;
  const angle = -SWEEP_DEG + fraction * SWEEP_DEG * 2;
  const zeroAngle = -SWEEP_DEG + ((defaultValue - min) / (span || 1)) * SWEEP_DEG * 2;
  const c = size / 2;
  const r = size / 2 - 3;
  const [tipX, tipY] = polar(c, c, r - 4, angle);
  const [baseX, baseY] = polar(c, c, r * 0.25, angle);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startValue: value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = ((drag.current.startY - event.clientY) / DRAG_PX_FOR_FULL_RANGE) * span;
    const next = clamp(drag.current.startValue + delta);
    if (next !== value) onChange(next);
  };
  const endDrag = () => { drag.current = null; };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const moves: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step };
    if (event.key in moves) {
      event.preventDefault();
      onChange(clamp(value + moves[event.key]));
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      onChange(defaultValue);
    }
  };

  const text = formatValue(value);
  return (
    <div className={cn('flex flex-col items-center gap-1 select-none', disabled && 'opacity-45', className)}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-disabled={disabled}
        title={`${ariaLabel ?? label}: ${text} (double-click to reset)`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => !disabled && onChange(defaultValue)}
        onKeyDown={onKeyDown}
        className={cn(
          'rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          disabled ? 'cursor-not-allowed' : 'cursor-ns-resize',
        )}
        style={{ width: size, height: size, touchAction: 'none' }}
      >
        <svg width={size} height={size} aria-hidden="true">
          <path d={arc(c, c, r, -SWEEP_DEG, SWEEP_DEG)} fill="none" stroke="var(--color-border-subtle)" strokeWidth={3} strokeLinecap="round" />
          {Math.abs(angle - zeroAngle) > 0.5 && (
            <path d={arc(c, c, r, Math.min(zeroAngle, angle), Math.max(zeroAngle, angle))} fill="none" stroke={accent} strokeWidth={3} strokeLinecap="round" />
          )}
          <circle cx={c} cy={c} r={r - 5} fill="var(--color-control-surface)" stroke="var(--color-control-border)" />
          <line x1={baseX} y1={baseY} x2={tipX} y2={tipY} stroke="var(--color-foreground)" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    </div>
  );
}
