import type { CSSProperties } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export type LoaderVariant = 'spinner' | 'dual-ring' | 'pulse' | 'bars' | 'wave' | 'dots';

export function StatusLoader({ variant = 'spinner', tone = 'active', label = 'Loading' }: { variant?: LoaderVariant; tone?: SemanticTone; label?: string }) {
  const cls = toneClass[tone];
  return (
    <span className={cn('dd-loader', `dd-loader--${variant}`, cls)} role="status" aria-label={label}>
      {variant === 'spinner' && <span className="dd-loader__ring" />}
      {variant === 'dual-ring' && <><span className="dd-loader__dual-a" /><span className="dd-loader__dual-b" /></>}
      {variant === 'pulse' && <><span className="dd-loader__pulse-ring" /><span className="dd-loader__pulse-core" /></>}
      {variant === 'bars' && Array.from({ length: 4 }).map((_, i) => <i key={i} style={{ '--dd-loader-index': i } as CSSProperties} />)}
      {variant === 'wave' && Array.from({ length: 5 }).map((_, i) => <i key={i} style={{ '--dd-loader-index': i } as CSSProperties} />)}
      {variant === 'dots' && Array.from({ length: 4 }).map((_, i) => <i key={i} style={{ '--dd-loader-index': i } as CSSProperties} />)}
    </span>
  );
}
