import { cn } from '../../../lib/utils';

interface WaveformTimeRulerProps {
  ticks: readonly { ms: number; label: string }[];
  startMs?: number;
  endMs: number;
  className?: string;
}

/** Time labels use the same visible interval as the waveform and its cue markers. */
export function WaveformTimeRuler({ ticks, startMs = 0, endMs, className }: WaveformTimeRulerProps) {
  const span = endMs - startMs;
  return (
    <div className={cn('waveform-time-ruler relative h-4', className)} aria-hidden="true">
      {span > 0 && ticks.filter((tick) => tick.ms >= startMs && tick.ms <= endMs).map((tick) => (
        <span key={tick.ms} className="absolute top-0 text-[10px] tabular-nums text-[#9ba5b6]"
          style={{ left: `${(tick.ms - startMs) / span * 100}%`, transform: tick.ms === startMs ? undefined : 'translateX(-50%)' }}>
          {tick.label}
        </span>
      ))}
    </div>
  );
}
