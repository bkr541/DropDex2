import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleDash, Close, TrashCan, WarningAlt } from '@carbon/icons-react';
import { ControlButton } from './ui/controls';

interface DeleteAllLibrariesModalProps {
  open: boolean;
  visibleSnapshotCount: number;
  deleting: boolean;
  cleanupPass?: number;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteAllLibrariesModal({
  open,
  visibleSnapshotCount,
  deleting,
  cleanupPass = 0,
  error,
  onClose,
  onConfirm,
}: DeleteAllLibrariesModalProps) {
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (open) setConfirmation('');
  }, [open]);

  if (!open) return null;

  const confirmationValid = confirmation === 'DELETE ALL';

  return (
    <AnimatePresence>
      <motion.div
        key="delete-all-rekordbox-libraries"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleting) onClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-libraries-title"
          className="w-full max-w-2xl rounded-3xl border border-red-500/25 bg-[var(--color-panel)] p-6 shadow-2xl"
        >
          <div className="flex min-w-0 items-start gap-4">
            <div className="shrink-0 rounded-2xl bg-red-500/10 p-3 text-red-400">
              <WarningAlt size={22} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Permanent action</p>
              <h2 id="delete-all-libraries-title" className="mt-1 text-xl font-black">
                Delete all <span className="text-red-400">{visibleSnapshotCount.toLocaleString()}</span> Rekordbox library data?
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Permanently removes all snapshots and their imported tracks, playlists, analysis data, and assets. Your account, profile, and app preferences are not affected.
              </p>
            </div>
          </div>

          {/* Confirmation input */}
          <div className="mt-5">
            <label htmlFor="delete-all-libraries-confirmation" className="text-xs font-bold">
              Type <span className="font-mono text-red-400">DELETE ALL</span> exactly to confirm
            </label>
            <input
              id="delete-all-libraries-confirmation"
              autoFocus
              disabled={deleting}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-2.5 font-mono text-sm outline-none transition-colors focus:border-red-500/60"
              placeholder="DELETE ALL"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Confirmation is case-sensitive.</p>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-relaxed text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <ControlButton type="button" variant="neutral" disabled={deleting} onClick={onClose} className="flex-1">
              <Close size={16} /> Cancel
            </ControlButton>
            <ControlButton
              type="button"
              variant="danger"
              disabled={deleting || !confirmationValid}
              onClick={onConfirm}
              className="flex-1"
            >
              {deleting ? (
                <>
                  <CircleDash size={16} className="animate-spin" />
                  {cleanupPass > 0 ? `Deleting all… pass ${cleanupPass}` : 'Deleting all…'}
                </>
              ) : (
                <><TrashCan size={16} /> Delete All</>
              )}
            </ControlButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
