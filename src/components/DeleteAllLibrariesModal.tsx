import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleDash, WarningAlt } from '@carbon/icons-react';

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
          className="w-full max-w-lg rounded-3xl border border-red-500/25 bg-[var(--color-panel)] p-6 shadow-2xl"
        >
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-red-500/10 p-3 text-red-400">
              <WarningAlt size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Permanent action</p>
              <h2 id="delete-all-libraries-title" className="mt-1 text-xl font-black">
                Delete all Rekordbox library data?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                DropDex will permanently delete every Rekordbox snapshot owned by this account, including imported
                tracks, playlists, cues, beat grids, phrase analysis, waveforms, recommendation data, retained analysis
                assets, cloud analysis objects, staging files, and the active-library selection.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your DropDex account, profile, theme, and non-library preferences are not affected.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-sm font-bold text-red-300">
              {visibleSnapshotCount === 1
                ? '1 visible snapshot will be removed.'
                : `${visibleSnapshotCount.toLocaleString()} visible snapshots will be removed.`}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The backend also removes any stale or hidden Rekordbox snapshot rows that belong to this account, so this
              action returns the library to a true first-import state.
            </p>
          </div>

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
              className="mt-2 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm outline-none transition-colors focus:border-red-500/60"
              placeholder="DELETE ALL"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Confirmation is case-sensitive.</p>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-relaxed text-red-300">
              {error}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              disabled={deleting}
              onClick={onClose}
              className="flex-1 rounded-xl border border-[var(--color-border-subtle)] px-4 py-3 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting || !confirmationValid}
              onClick={onConfirm}
              className="flex-1 rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? (
                <span className="inline-flex items-center gap-2">
                  <CircleDash size={14} className="animate-spin" />
                  {cleanupPass > 0 ? `Deleting all… pass ${cleanupPass}` : 'Deleting all…'}
                </span>
              ) : 'Delete All'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
