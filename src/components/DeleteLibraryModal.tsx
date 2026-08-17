import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { RekordboxImport } from '../types';
import {
  getPersistedDeleteStrategy,
  isDeleteConfirmationValid,
  type DeleteActiveStrategy,
} from '../lib/rekordbox/libraryDeletion';
import { cn } from '../lib/utils';

interface DeleteLibraryModalProps {
  target: RekordboxImport | null;
  isActive: boolean;
  nextUsableImport: RekordboxImport | null;
  deleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (strategy: DeleteActiveStrategy) => void;
}

export function DeleteLibraryModal({
  target,
  isActive,
  nextUsableImport,
  deleting,
  error,
  onClose,
  onConfirm,
}: DeleteLibraryModalProps) {
  const [confirmation, setConfirmation] = useState('');
  const [strategy, setStrategy] = useState<DeleteActiveStrategy>('activate_next');

  const persistedStrategy = target ? getPersistedDeleteStrategy(target) : null;
  const retryingPendingDelete = persistedStrategy != null;
  const canChooseFallback = Boolean(isActive && nextUsableImport && !retryingPendingDelete);
  const effectiveStrategy: DeleteActiveStrategy = persistedStrategy ?? (isActive
    ? (canChooseFallback ? strategy : 'start_over')
    : 'activate_next');

  useEffect(() => {
    setConfirmation('');
    setStrategy(isActive ? (nextUsableImport ? 'activate_next' : 'start_over') : 'activate_next');
  }, [target?.id, isActive, nextUsableImport?.id]);

  if (!target) return null;

  const baseActionLabel = isActive || persistedStrategy === 'start_over'
    ? effectiveStrategy === 'start_over'
      ? 'Delete & Start Over'
      : 'Delete Active Library'
    : 'Delete Library';
  const actionLabel = retryingPendingDelete ? `Retry ${baseActionLabel}` : baseActionLabel;
  const confirmationValid = isDeleteConfirmationValid(confirmation);

  return (
    <AnimatePresence>
      <motion.div
        key={target.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
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
          aria-labelledby="delete-library-title"
          className="w-full max-w-lg rounded-3xl border border-red-500/20 bg-[var(--color-panel)] p-6 shadow-2xl"
        >
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-red-500/10 p-3 text-red-400">
              <AlertTriangle size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Permanent action</p>
              <h2 id="delete-library-title" className="mt-1 text-xl font-black">
                {isActive ? 'Delete active Rekordbox library?' : 'Delete Rekordbox library?'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                DropDex will permanently delete this snapshot&apos;s imported tracks, playlists, cues, beat grids,
                phrase analysis, waveforms, recommendation data, retained analysis assets, cloud analysis objects,
                and staging files. Your DropDex account and app preferences are not affected.
              </p>
              <p className="mt-2 truncate font-mono text-xs text-muted-foreground" title={target.source_filename}>
                {target.source_filename}
              </p>
            </div>
          </div>

          {retryingPendingDelete && (
            <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-bold text-amber-300">Deletion is already pending.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Retry will continue the original confirmed action: <span className="font-bold">{baseActionLabel}</span>.
                The strategy cannot change while this hard delete is in progress.
              </p>
            </div>
          )}

          {canChooseFallback && (
            <div className="mt-5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">After deletion</p>
              <button
                type="button"
                disabled={deleting}
                aria-pressed={strategy === 'activate_next'}
                onClick={() => setStrategy('activate_next')}
                className={cn(
                  'w-full rounded-2xl border p-4 text-left transition-colors',
                  strategy === 'activate_next'
                    ? 'border-primary bg-primary/10'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]',
                )}
              >
                <p className="text-sm font-bold">Delete Active Library</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Switch automatically to the newest remaining usable snapshot: <span className="font-mono">{nextUsableImport?.source_filename}</span>.
                </p>
              </button>
              <button
                type="button"
                disabled={deleting}
                aria-pressed={strategy === 'start_over'}
                onClick={() => setStrategy('start_over')}
                className={cn(
                  'w-full rounded-2xl border p-4 text-left transition-colors',
                  strategy === 'start_over'
                    ? 'border-red-500/50 bg-red-500/10'
                    : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]',
                )}
              >
                <p className="text-sm font-bold">Delete &amp; Start Over</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Leave DropDex with no active library and return to the initial import experience. Other snapshots remain in Settings and can be activated later.
                </p>
              </button>
            </div>
          )}

          {isActive && !nextUsableImport && !retryingPendingDelete && (
            <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-sm font-bold text-amber-300">This is your only usable library.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Deleting it will return DropDex to the same empty state shown before the first Rekordbox import.
              </p>
            </div>
          )}

          <div className="mt-5">
            <label htmlFor="delete-library-confirmation" className="text-xs font-bold">
              Type <span className="font-mono text-red-400">DELETE</span> exactly to confirm
            </label>
            <input
              id="delete-library-confirmation"
              autoFocus
              disabled={deleting}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 font-mono text-sm outline-none transition-colors focus:border-red-500/60"
              placeholder="DELETE"
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
              onClick={() => onConfirm(effectiveStrategy)}
              className="flex-1 rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? (
                <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Deleting…</span>
              ) : actionLabel}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
