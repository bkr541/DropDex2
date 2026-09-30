import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Close, Notification, Warning } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';

export type NotificationTone = 'error' | 'warning';

export interface AppNotification {
  id: string;
  tone: NotificationTone;
  title: string;
  message: string;
}

const TONE = {
  error: { bar: 'bg-[#f43f5e]', icon: 'text-[#f43f5e] bg-[#f43f5e]/15', button: 'bg-[#f43f5e] shadow-[0_12px_32px_rgb(244_63_94_/_0.45)]' },
  warning: { bar: 'bg-[#f59e0b]', icon: 'text-[#f59e0b] bg-[#f59e0b]/15', button: 'bg-[#f59e0b] shadow-[0_12px_32px_rgb(245_158_11_/_0.45)]' },
} as const;

export function NotificationCard({
  notification,
  onDismiss,
  className,
}: {
  notification: AppNotification;
  onDismiss?: (id: string) => void;
  className?: string;
}) {
  const tone = TONE[notification.tone];
  return (
    <div
      role={notification.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'relative flex w-[400px] max-w-[calc(100vw-48px)] items-start gap-4 rounded-2xl border border-white/10',
        'bg-[#1b2230]/95 py-4 pl-4 pr-11 shadow-[0_16px_40px_rgb(0_0_0_/_0.45)]',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('w-1 self-stretch shrink-0 rounded-full', tone.bar)} />
      <span aria-hidden="true" className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', tone.icon)}>
        <Warning size={24} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[15px] font-semibold leading-snug text-slate-100">{notification.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{notification.message}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(notification.id)}
          aria-label={`Dismiss ${notification.title}`}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
        >
          <Close size={18} />
        </button>
      )}
    </div>
  );
}

/**
 * Floating bell in the bottom-right that appears while there are notifications.
 * Clicking it blurs and darkens the page and stacks the notification cards
 * above the bell; clicking the backdrop, the bell again, or Escape closes it.
 */
export function NotificationCenter({
  notifications,
  onDismiss,
  label = 'Notifications',
}: {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const hasErrors = notifications.some((n) => n.tone === 'error');
  const count = notifications.length;

  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (typeof document === 'undefined') return null;
  const duration = reduceMotion ? 0 : 0.2;

  return createPortal(
    <AnimatePresence>
      {count > 0 && (
        <motion.div key="notification-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration }}>
          <AnimatePresence>
            {open && (
              <motion.div
                key="backdrop"
                data-testid="notification-backdrop"
                aria-hidden="true"
                onClick={() => setOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration }}
                className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {open && (
              <motion.div
                key="stack"
                role="dialog"
                aria-label={label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration }}
                className="fixed bottom-28 right-6 z-[91] flex max-h-[calc(100vh-160px)] flex-col items-end gap-4 overflow-y-auto"
              >
                <AnimatePresence initial={false}>
                  {notifications.map((notification) => (
                    <motion.div
                      key={notification.id}
                      layout={!reduceMotion}
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      transition={{ duration }}
                    >
                      <NotificationCard notification={notification} onDismiss={onDismiss} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            type="button"
            data-testid="notification-center-button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${count} ${count === 1 ? 'notification' : 'notifications'}`}
            whileHover={reduceMotion ? undefined : { scale: 1.05 }}
            whileTap={reduceMotion ? undefined : { scale: 0.95 }}
            className={cn(
              'fixed bottom-6 right-6 z-[92] flex h-16 w-16 items-center justify-center rounded-full text-white',
              hasErrors ? TONE.error.button : TONE.warning.button,
            )}
          >
            <Notification size={28} />
            <span className="absolute -right-0.5 -top-0.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#0b0f16] bg-white px-1 text-[11px] font-bold text-[#0b0f16]">
              {count}
            </span>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
