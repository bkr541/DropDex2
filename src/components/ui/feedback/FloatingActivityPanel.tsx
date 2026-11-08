import { CheckCircle, NavArrowDown, Pause, Play, Upload } from 'iconoir-react/regular';
import { cn } from '../../../lib/utils';
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
        <div><Upload width={13} height={13} aria-hidden="true" /><strong>{title}</strong></div>
        <div><strong>{Math.round(clampProgress(progress))}%</strong>{onToggleCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand activity panel' : 'Collapse activity panel'}><NavArrowDown aria-hidden="true" width={14} height={14} className={collapsed ? '-rotate-90' : ''} /></button>}</div>
      </header>
      {!collapsed && <>
        <div className="dd-floating-activity__rows">
          {rows.map((row) => (
            <div className="dd-floating-activity__row" key={row.id}>
              <span>{row.label}</span>
              <b>{row.current} / {row.total}</b>
              {row.complete ? <CheckCircle width={13} height={13} className="dd-complete-icon" aria-label="Complete" /> : <ProgressBar value={row.current} max={row.total} tone="active" label={`${row.label} progress`} />}
            </div>
          ))}
        </div>
        <footer>
          <span>{remaining}</span>
          {onTogglePaused && <button type="button" className="dd-feedback-button dd-feedback-button--ghost" onClick={onTogglePaused}>{paused ? <PlayInline /> : <PauseInline />}{paused ? 'RESUME' : 'PAUSE'}</button>}
        </footer>
      </>}
    </section>
  );
}

function PauseInline() { return <Pause width={11} height={11} aria-hidden="true" />; }
function PlayInline() { return <Play width={10} height={10} aria-hidden="true" />; }
