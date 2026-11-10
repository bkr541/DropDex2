import { NavArrowDown, Pause, Play, Upload } from 'iconoir-react/regular';
import { cn } from '../../../lib/utils';
import { ControlButton } from '../controls/ControlButton';
import '../dropdex-feedback.css';
import { ProgressBar } from './ProgressBar';
import { clampProgress } from './progress';

export interface ActivityRow {
  id: string;
  label: string;
  current: number;
  total: number;
  complete?: boolean;
}

export function FloatingActivityPanel({
  title,
  progress,
  rows,
  remaining,
  paused,
  onTogglePaused,
  collapsed,
  onToggleCollapsed,
  className,
}: {
  title: string;
  progress: number;
  rows: ActivityRow[];
  remaining?: string;
  paused?: boolean;
  onTogglePaused?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
}) {
  return (
    <section className={cn('dd-floating-activity', className)} aria-label={title}>
      <header>
        <div className="dd-floating-activity__title"><Upload width={24} height={24} aria-hidden="true" /><strong>{title}</strong></div>
        <div className="dd-floating-activity__percent"><strong>{Math.round(clampProgress(progress))}<small>%</small></strong>{onToggleCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand activity panel' : 'Collapse activity panel'}><NavArrowDown aria-hidden="true" width={16} height={16} className={collapsed ? '-rotate-90' : ''} /></button>}</div>
      </header>
      {!collapsed && <>
        <div className="import-group dd-floating-activity__rows">
          {rows.map((row) => (
            <div className="dd-floating-activity__row" key={row.id}>
              <span>{row.label}</span>
              <b>{row.current.toLocaleString()} / {row.total.toLocaleString()}</b>
              <ProgressBar value={row.complete ? row.total : row.current} max={row.total} tone="active" label={`${row.label} progress`} />
            </div>
          ))}
          {remaining && <p className="dd-floating-activity__remaining">{remaining}</p>}
        </div>
        {onTogglePaused && (
          <footer>
            <ControlButton variant="secondary" onClick={onTogglePaused}>{paused ? <Play width={14} height={14} aria-hidden="true" /> : <Pause width={14} height={14} aria-hidden="true" />}{paused ? 'Resume' : 'Pause'}</ControlButton>
          </footer>
        )}
      </>}
    </section>
  );
}
