import { WarningTriangle, Xmark } from 'iconoir-react/regular';
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
      <WarningTriangle width={25} height={25} aria-hidden="true" />
      <div className="dd-alert-banner__copy"><strong>{title}</strong><span>{message}</span></div>
      {actionLabel && onAction && <button type="button" className="dd-feedback-button dd-feedback-button--warning" onClick={onAction}>{actionLabel}</button>}
      {onDismiss && <button type="button" className="dd-icon-dismiss" onClick={onDismiss} aria-label={`Dismiss ${title}`}><Xmark aria-hidden="true" width={15} height={15} /></button>}
    </section>
  );
}
