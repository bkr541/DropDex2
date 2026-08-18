import { CheckmarkFilled, Close, CloseFilled, Information, WarningAlt } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { toneClass } from './tones';
import type { SemanticTone } from './types';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
const toastTone: Record<ToastTone, SemanticTone> = {
  success: 'success', info: 'active', warning: 'warning', error: 'error',
};

export function ToastNotification({
  tone,
  title,
  message,
  meta,
  onDismiss,
  className,
}: {
  tone: ToastTone;
  title: string;
  message: string;
  meta?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const icon = tone === 'success'
    ? <CheckmarkFilled size={18} />
    : tone === 'warning'
      ? <WarningAlt size={18} />
      : tone === 'error'
        ? <CloseFilled size={18} />
        : <Information size={18} />;
  return (
    <div className={cn('dd-toast', `dd-toast--${tone}`, className)} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <span className={cn('dd-toast__icon', toneClass[toastTone[tone]])}>{icon}</span>
      <div className="dd-toast__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {meta && <span className="dd-toast__meta">{meta}</span>}
      {onDismiss && (
        <button type="button" className="dd-toast__close" onClick={onDismiss} aria-label={`Dismiss ${title} notification`}>
          <Close size={15} />
        </button>
      )}
    </div>
  );
}
