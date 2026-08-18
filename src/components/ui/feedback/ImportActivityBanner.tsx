import { Close } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { CircularProgress } from './CircularProgress';

export function ImportActivityBanner({
  title,
  source,
  detail,
  secondaryDetail,
  remaining,
  progress,
  onView,
  onDismiss,
  className,
  viewLabel = 'VIEW',
}: {
  title: string;
  source: string;
  detail: string;
  secondaryDetail?: string;
  remaining?: string;
  progress: number;
  onView?: () => void;
  onDismiss?: () => void;
  className?: string;
  viewLabel?: string;
}) {
  return (
    <section className={cn('dd-activity-banner', className)} aria-live="polite">
      <CircularProgress value={progress} size={52} tone="active" label={`${title} progress`} />
      <div className="dd-activity-banner__copy">
        <strong>{title}</strong>
        <span className="dd-activity-banner__source">{source}</span>
        <span>{detail}</span>
        {secondaryDetail && <small>{secondaryDetail}</small>}
      </div>
      {remaining && <span className="dd-activity-banner__remaining">{remaining}</span>}
      {onView && <button type="button" className="dd-feedback-button dd-feedback-button--ghost" onClick={onView}>{viewLabel}</button>}
      {onDismiss && <button type="button" className="dd-icon-dismiss" onClick={onDismiss} aria-label={`Dismiss ${title}`}><Close size={15} /></button>}
    </section>
  );
}
