import { Close, WarningAlt } from '@carbon/icons-react';
import '../dropdex-feedback.css';

export function AlertBanner({
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <section className="dd-alert-banner" role="alert">
      <WarningAlt size={25} aria-hidden="true" />
      <div className="dd-alert-banner__copy"><strong>{title}</strong><span>{message}</span></div>
      {actionLabel && onAction && <button type="button" className="dd-feedback-button dd-feedback-button--warning" onClick={onAction}>{actionLabel}</button>}
      {onDismiss && <button type="button" className="dd-icon-dismiss" onClick={onDismiss} aria-label={`Dismiss ${title}`}><Close size={15} /></button>}
    </section>
  );
}
