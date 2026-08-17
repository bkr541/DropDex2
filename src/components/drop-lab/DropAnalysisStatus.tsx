import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { CheckmarkFilled, Information, WarningAlt } from '@carbon/icons-react';

interface DropAnalysisStatusProps {
  kind: 'ready' | 'warning' | 'info';
  children: ReactNode;
}

export function DropAnalysisStatus({ kind, children }: DropAnalysisStatusProps) {
  const Icon = kind === 'ready' ? CheckmarkFilled : kind === 'warning' ? WarningAlt : Information;
  return (
    <div
      role={kind === 'warning' ? 'status' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs',
        kind === 'ready' && 'bg-green-500/10 border-green-500/20 text-green-400',
        kind === 'warning' && 'bg-amber-400/10 border-amber-400/20 text-amber-400',
        kind === 'info' && 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-muted-foreground',
      )}
    >
      <Icon size={14} className="shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
