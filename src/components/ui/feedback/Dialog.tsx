import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Close, WarningAlt } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';

export interface DialogAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
}

export function Dialog({
  open = true,
  title,
  children,
  actions,
  onClose,
  destructive = false,
  inline = false,
  closeOnBackdrop = true,
}: {
  open?: boolean;
  title: string;
  children: ReactNode;
  actions?: DialogAction[];
  onClose?: () => void;
  destructive?: boolean;
  inline?: boolean;
  closeOnBackdrop?: boolean;
}) {
  const titleId = useId();
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || !onClose || inline) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [inline, onClose, open]);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surfaceRef.current?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  const surface = (
    <section
      ref={surfaceRef}
      tabIndex={-1}
      className={cn('dd-dialog', destructive && 'dd-dialog--destructive', inline && 'dd-dialog--inline')}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      onKeyDown={inline && onClose ? (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      } : undefined}
    >
      <header>
        {destructive && <WarningAlt size={29} aria-hidden="true" />}
        <strong id={titleId}>{title}</strong>
        {onClose && <button type="button" className="dd-icon-dismiss" onClick={onClose} aria-label={`Close ${title}`}><Close size={15} /></button>}
      </header>
      <div className="dd-dialog__body">{children}</div>
      {actions && actions.length > 0 && <footer>{actions.map((action) => <button key={action.label} type="button" disabled={action.disabled} className={cn('dd-feedback-button', action.variant === 'danger' ? 'dd-feedback-button--danger' : action.variant === 'primary' ? 'dd-feedback-button--primary' : 'dd-feedback-button--ghost')} onClick={action.onClick}>{action.label}</button>)}</footer>}
    </section>
  );
  if (inline) return surface;
  return <div className="dd-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose?.(); }}>{surface}</div>;
}
