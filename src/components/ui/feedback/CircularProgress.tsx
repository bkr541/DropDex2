import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { clampProgress } from './progress';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export function CircularProgress({ value, size = 54, strokeWidth = 4, tone = 'active', label }: { value: number; size?: number; strokeWidth?: number; tone?: SemanticTone; label?: string }) {
  const pct = clampProgress(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (pct / 100);
  return (
    <span className={cn('dd-circular-progress', toneClass[tone])} style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="dd-circular-progress__track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} />
        <circle className="dd-circular-progress__value" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circumference - dash}`} />
      </svg>
      <strong>{Math.round(pct)}%</strong>
    </span>
  );
}
