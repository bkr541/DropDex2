import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export function StatusBadge({
  children,
  tone = 'neutral',
  icon,
  className,
  style,
}: {
  children: ReactNode;
  tone?: SemanticTone;
  icon?: ReactNode;
  className?: string;
  /** For one-off size or text-case changes; the badge's own stylesheet wins over utility classes. */
  style?: CSSProperties;
}) {
  return (
    <span className={cn('dd-status-badge', toneClass[tone], className)} style={style}>
      {icon && <span className="dd-status-badge__icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
