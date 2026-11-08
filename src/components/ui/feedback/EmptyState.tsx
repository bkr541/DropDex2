import { Folder, Search } from 'iconoir-react/regular';
import { ControlButton } from '../controls/ControlButton';
import '../dropdex-feedback.css';

export function EmptyState({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <section className="dd-empty-state">
      <div className="dd-empty-state__icon" aria-hidden="true"><Folder aria-hidden="true" width={38} height={38} /><Search aria-hidden="true" width={22} height={22} /></div>
      <strong>{title}</strong>
      <span>{message}</span>
      {actionLabel && onAction && <ControlButton variant="primary" onClick={onAction}>{actionLabel}</ControlButton>}
    </section>
  );
}
