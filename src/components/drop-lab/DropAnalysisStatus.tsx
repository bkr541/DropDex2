import type { ReactNode } from 'react';
import { CheckCircle, InfoCircle, WarningTriangle } from 'iconoir-react/regular';

interface DropAnalysisStatusProps {
  kind: 'ready' | 'warning' | 'info';
  children: ReactNode;
}

const COLOR = { ready: '#34d399', warning: '#fbbf24', info: '#8e9aa8' } as const;

/** One status line above the dock, colored by kind. */
export function DropAnalysisStatus({ kind, children }: DropAnalysisStatusProps) {
  const Icon = kind === 'ready' ? CheckCircle : kind === 'warning' ? WarningTriangle : InfoCircle;
  return (
    <div role={kind === 'warning' ? 'status' : undefined} className="flex items-center gap-2 px-5 py-[3px] text-[11px]" style={{ color: COLOR[kind] }}>
      <Icon width={13} height={13} aria-hidden="true" className="shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
