import { FolderOpen, Search } from '@carbon/icons-react';
import '../dropdex-feedback.css';

export function EmptyState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <section className="dd-empty-state">
      <div className="dd-empty-state__icon" aria-hidden="true"><FolderOpen size={38} /><Search size={22} /></div>
      <strong>{title}</strong>
      <span>{message}</span>
      {actionLabel && onAction && <button type="button" className="dd-feedback-button dd-feedback-button--primary" onClick={onAction}>{actionLabel}</button>}
    </section>
  );
}
