import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { clampProgress, progressPercent } from './progress';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export function ProgressBar({
  value,
  max = 100,
  tone = 'active',
  striped = false,
  showValue = false,
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: SemanticTone;
  striped?: boolean;
  showValue?: boolean;
  label?: string;
  className?: string;
}) {
  const pct = progressPercent(value, max);
  return (
    <div className={cn('dd-progress', className)}>
      <div
        className="dd-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Number.isFinite(max) && max > 0 ? max : 100}
        aria-valuenow={Number.isFinite(value) ? clampProgress(value, 0, Number.isFinite(max) && max > 0 ? max : 100) : 0}
      >
        <div
          className={cn('dd-progress__fill', toneClass[tone], striped && 'dd-progress__fill--striped')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue && <span className="dd-progress__value">{Math.round(pct)}%</span>}
    </div>
  );
}
