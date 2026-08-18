import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export function StatusDot({
  label,
  tone,
  pulse = false,
  className,
}: {
  label?: string;
  tone: SemanticTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('dd-status-dot-wrap', className)}>
      <span className={cn('dd-status-dot', toneClass[tone], pulse && 'dd-status-dot--pulse')} aria-hidden="true" />
      {label && <span className="dd-status-dot__label">{label}</span>}
      {!label && <span className="sr-only">{tone} status</span>}
    </span>
  );
}
