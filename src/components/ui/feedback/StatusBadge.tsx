import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export function StatusBadge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: SemanticTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('dd-status-badge', toneClass[tone], className)}>
      {icon && <span className="dd-status-badge__icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
