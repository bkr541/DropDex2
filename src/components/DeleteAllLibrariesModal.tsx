import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Refresh, Trash, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { ControlButton } from './ui/controls';
import { SlideToDelete } from './SlideToDelete';

interface DeleteAllLibrariesModalProps {
  open: boolean;
  visibleSnapshotCount: number;
  deleting: boolean;
  cleanupPass?: number;
  initialCount?: number;
  remainingCount?: number;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}


function formatSecondsRemaining(seconds: number): string {
  if (seconds < 5) return 'almost done';
  if (seconds < 60) return `~${Math.ceil(seconds)}s remaining`;
  const mins = Math.ceil(seconds / 60);
  return `~${mins}m remaining`;
}

export function DeleteAllLibrariesModal({
  open,
  visibleSnapshotCount,
  deleting,
  cleanupPass = 0,
  initialCount = 0,
  remainingCount = 0,
  error,
  onClose,
  onConfirm,
}: DeleteAllLibrariesModalProps) {
  const [confirmed, setConfirmed] = useState(false);

  // Time estimation for the deletion progress
  const deleteStartRef = useRef<number | null>(null);
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      deleteStartRef.current = null;
      setEstimatedSecondsRemaining(null);
    }
  }, [open]);

  useEffect(() => {
    if (!deleting) {
      deleteStartRef.current = null;
      setEstimatedSecondsRemaining(null);
      return;
    }
    if (deleteStartRef.current === null) {
      deleteStartRef.current = Date.now();
    }
    if (initialCount <= 0) return;

    const deletedSoFar = initialCount - remainingCount;
    const pct = deletedSoFar / initialCount;
    if (pct > 0 && deleteStartRef.current != null) {
      const elapsedMs = Date.now() - deleteStartRef.current;
      const totalEstimatedMs = elapsedMs / pct;
      const remainingMs = totalEstimatedMs - elapsedMs;
      setEstimatedSecondsRemaining(Math.max(0, remainingMs / 1000));
    }
  }, [deleting, initialCount, remainingCount]);

  if (!open) return null;

  const deletedCount = Math.max(0, initialCount - remainingCount);
  const deletePct = initialCount > 0 ? Math.round((deletedCount / initialCount) * 100) : 0;

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
          className="studio-surface profile-modal import-modal relative w-full max-w-[624px] px-7 pb-6 pt-5"
        >
          {deleting ? (
            /* ── Deletion in progress: progress view ── */
            <div className="text-center">
              <div className="import-group shrink-0">
                <div className="import-status-icon">
                  <Refresh className="animate-spin text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />
                </div>
                <h2 id="delete-all-libraries-title" className="import-heading">Deleting Rekordbox Libraries…</h2>
              </div>
              <div className="import-group import-group--amber mb-3 flex items-center gap-3 text-left">
                <WarningTriangle width={16} height={16} aria-hidden="true" className="shrink-0 text-amber-400" />
                <p className="text-[11px] leading-snug text-amber-100">Do not close this window until deletion is complete.</p>
              </div>

              {/* Progress bar */}
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface)]">
                <div
                  className="h-full rounded-full bg-[var(--color-control-primary)] transition-all duration-500"
                  style={{ width: `${deletePct}%` }}
                />
              </div>

              <div className="mt-3 flex items-baseline justify-between text-sm">
                <span className="font-semibold text-foreground">{deletePct}%</span>
                {estimatedSecondsRemaining != null ? (
                  <span className="text-xs text-muted-foreground">
                    {formatSecondsRemaining(estimatedSecondsRemaining)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Calculating…</span>
                )}
              </div>

              {initialCount > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {deletedCount.toLocaleString()} of {initialCount.toLocaleString()} {initialCount === 1 ? 'library' : 'libraries'} deleted
                </p>
              )}

              {error && (
                <div className="import-group mt-4 text-left text-xs leading-relaxed text-red-300">
                  {error}
                </div>
              )}
            </div>
          ) : (
            /* ── Confirmation view ── */
            <>
              <ControlButton variant="ghost" className="!absolute right-3 top-3 z-20" onClick={onClose} aria-label="Close">
                <Xmark width={18} height={18} aria-hidden="true" />
              </ControlButton>
              <div className="flex items-center gap-2 pr-10">
                <WarningTriangle width={24} height={24} aria-hidden="true" className="shrink-0 text-[var(--color-control-primary)]" />
                <h2 id="delete-all-libraries-title" className="import-modal__title text-[26px] leading-tight">
                  Delete all {visibleSnapshotCount.toLocaleString()} Rekordbox libraries?
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Permanently removes all snapshots and their imported tracks, playlists, analysis data, and assets. Your account, profile, and app preferences are not affected.
              </p>
              <div className="import-group import-group--amber mt-3 flex items-center gap-3 text-left">
                <WarningTriangle width={16} height={16} aria-hidden="true" className="shrink-0 text-amber-400" />
                <p className="text-[11px] leading-snug text-amber-100">This is a permanent action and cannot be undone.</p>
              </div>

              <SlideToDelete disabled={deleting} onChange={setConfirmed} />

              {error && (
                <div className="import-group mt-3 text-xs leading-relaxed text-red-300">
                  {error}
                </div>
              )}

              <div className="mt-auto flex justify-center gap-3 pt-5">
                <ControlButton type="button" variant="secondary" onClick={onClose}>
                  <Xmark width={16} height={16} aria-hidden="true" /> Cancel
                </ControlButton>
                <ControlButton
                  type="button"
                  variant="danger"
                  disabled={!confirmed}
                  onClick={onConfirm}
                >
                  <Trash width={16} height={16} aria-hidden="true" /> Delete All
                </ControlButton>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
