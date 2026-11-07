import type { ReactNode } from 'react';
import { CheckmarkFilled, Close, CloseFilled, Information, WarningAlt } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import './notice-card.css';

export type NoticeTone = 'error' | 'warning' | 'info' | 'success' | 'neutral';

const TONE_ICONS: Record<NoticeTone, ReactNode> = {
  error: <CloseFilled size={16} aria-hidden="true" />,
  warning: <WarningAlt size={16} aria-hidden="true" />,
  info: <Information size={16} aria-hidden="true" />,
  success: <CheckmarkFilled size={16} aria-hidden="true" />,
  neutral: <Information size={16} aria-hidden="true" />,
};

export interface NoticeCardProps {
  /** The colour and icon: red for something that failed, amber for something to fix, blue for information, green for done. */
  tone?: NoticeTone;
  /** A small spaced-capital line above the title, such as where the notice comes from. */
  eyebrow?: ReactNode;
  /** A short plain heading. */
  title?: ReactNode;
  /** The message itself. */
  children: ReactNode;
  /** Replaces the icon the tone gives. */
  icon?: ReactNode;
  /** A button or link on the right, for example "Connect USB". */
  action?: ReactNode;
  /** Shows a close button and calls this when it is pressed. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

/**
 * The one notice in DropDex: a raised graphite card with a tinted icon well, an optional eyebrow and title, a message, and an optional
 * action and close button. Errors and warnings are announced to screen readers at once (role="alert"); the rest politely (role="status").
 */
export function NoticeCard({ tone = 'neutral', eyebrow, title, children, icon, action, onDismiss, dismissLabel = 'Dismiss', className }: NoticeCardProps) {
  return (
    <div className={cn('nc', className)} data-tone={tone} data-testid="notice-card" role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <span className="nc-icon">{icon ?? TONE_ICONS[tone]}</span>
      <div className="nc-body">
        {eyebrow ? <p className="nc-eyebrow">{eyebrow}</p> : null}
        {title ? <p className="nc-title">{title}</p> : null}
        <p className="nc-message">{children}</p>
      </div>
      {action ? <div className="nc-action">{action}</div> : null}
      {onDismiss ? (
        <button type="button" className="nc-dismiss" onClick={onDismiss} aria-label={dismissLabel}><Close size={16} aria-hidden="true" /></button>
      ) : null}
    </div>
  );
}
