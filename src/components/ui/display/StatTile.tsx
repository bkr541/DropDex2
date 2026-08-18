import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-display.css';
import { SurfaceCard } from './SurfaceCard';

export interface StatTileProps {
  label: string;
  value?: ReactNode;
  trend?: ReactNode;
  caption?: ReactNode;
  chartValues?: number[];
  className?: string;
}

export function StatTile({
  label,
  value,
  trend,
  caption,
  chartValues = [],
  className,
}: StatTileProps) {
  const finiteValues = chartValues.map((item) => Number.isFinite(item) ? Math.max(0, item) : 0);
  const max = Math.max(...finiteValues, 1);

  return (
    <SurfaceCard className={cn('dd-stat-tile', className)}>
      <p className="dd-stat-tile__label">{label}</p>
      <div className="dd-stat-tile__headline">
        <strong title={typeof value === 'string' ? value : undefined}>{value === '' || value == null ? '—' : value}</strong>
        {trend != null && <span>{trend}</span>}
      </div>
      {finiteValues.length > 0 && (
        <div className="dd-stat-tile__chart" aria-hidden="true">
          {finiteValues.map((item, index) => (
            <i
              key={`${item}-${index}`}
              className={index === finiteValues.length - 1 ? 'dd-stat-tile__bar--accent' : undefined}
              style={{ height: `${Math.max(10, (item / max) * 100)}%` }}
            />
          ))}
        </div>
      )}
      {caption != null && <p className="dd-stat-tile__caption">{caption}</p>}
    </SurfaceCard>
  );
}
