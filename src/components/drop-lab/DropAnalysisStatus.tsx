import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface DropAnalysisStatusProps {
  kind: 'ready' | 'warning' | 'info';
  children: ReactNode;
}

export function DropAnalysisStatus({ kind, children }: DropAnalysisStatusProps) {
  const Icon = kind === 'ready' ? CheckCircle2 : kind === 'warning' ? AlertCircle : Info;
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
      <span>{children}</span>
    </div>
  );
}
