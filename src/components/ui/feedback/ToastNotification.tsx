import { CheckCircle, InfoCircle, WarningTriangle, Xmark, XmarkCircle } from 'iconoir-react/regular';
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
    ? <CheckCircle aria-hidden="true" width={18} height={18} />
    : tone === 'warning'
      ? <WarningTriangle aria-hidden="true" width={18} height={18} />
      : tone === 'error'
        ? <XmarkCircle aria-hidden="true" width={18} height={18} />
        : <InfoCircle aria-hidden="true" width={18} height={18} />;
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
          <Xmark aria-hidden="true" width={15} height={15} />
        </button>
      )}
    </div>
  );
}
