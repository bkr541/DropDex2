import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { RekordboxImport } from '../types';
import {
  getPersistedDeleteStrategy,
  type DeleteActiveStrategy,
} from '../lib/rekordbox/libraryDeletion';
import { cn } from '../lib/utils';
import { Refresh, Trash, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { ControlButton } from './ui/controls';
import { SlideToDelete } from './SlideToDelete';

interface DeleteLibraryModalProps {
  target: RekordboxImport | null;
  /** Kept for callers; the modal now has one look. */
  profileStyle?: boolean;
  isActive: boolean;
  nextUsableImport: RekordboxImport | null;
  deleting: boolean;
  deletingRetryCount?: number;
  error: string | null;
  onClose: () => void;
  onConfirm: (strategy: DeleteActiveStrategy) => void;
}

export function DeleteLibraryModal({
  target,
  isActive,
  nextUsableImport,
  deleting,
  deletingRetryCount = 0,
  error,
  onClose,
  onConfirm,
}: DeleteLibraryModalProps) {
  const [confirmationValid, setConfirmationValid] = useState(false);
  const [strategy, setStrategy] = useState<DeleteActiveStrategy>('activate_next');

  const persistedStrategy = target ? getPersistedDeleteStrategy(target) : null;
  const retryingPendingDelete = persistedStrategy != null;
  const canChooseFallback = Boolean(isActive && nextUsableImport && !retryingPendingDelete);
  const effectiveStrategy: DeleteActiveStrategy = persistedStrategy ?? (isActive
    ? (canChooseFallback ? strategy : 'start_over')
    : 'activate_next');

  useEffect(() => {
    setConfirmationValid(false);
    setStrategy(isActive ? (nextUsableImport ? 'activate_next' : 'start_over') : 'activate_next');
  }, [target?.id, isActive, nextUsableImport?.id]);

  if (!target) return null;

  const baseActionLabel = isActive || persistedStrategy === 'start_over'
    ? effectiveStrategy === 'start_over'
      ? 'Delete & Start Over'
      : 'Delete Active Book'
    : 'Delete Book';
  const actionLabel = retryingPendingDelete ? `Retry ${baseActionLabel}` : baseActionLabel;

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
          className="studio-surface profile-modal import-modal relative w-full max-w-[624px] px-7 pb-6 pt-5"
        >
          <ControlButton variant="ghost" className="!absolute right-3 top-3 z-20" disabled={deleting} onClick={onClose} aria-label="Close">
            <Xmark width={18} height={18} aria-hidden="true" />
          </ControlButton>
          <div className="flex items-center gap-2 pr-10">
            <WarningTriangle width={24} height={24} aria-hidden="true" className="shrink-0 text-[var(--color-control-primary)]" />
            <h2 id="delete-library-title" className="import-modal__title text-[26px] leading-tight">
              {isActive ? 'Delete active Rekordbox library?' : 'Delete Rekordbox library?'}
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            DropDex will permanently delete this snapshot&apos;s imported tracks, playlists, cues, beat grids, phrase analysis, waveforms,
            recommendation data, retained analysis assets, cloud analysis objects, and staging files. Your DropDex account and app preferences are not affected.
          </p>
          <p className="mt-2 truncate font-mono text-xs text-muted-foreground" title={target.source_filename}>{target.source_filename}</p>

          <div className="import-group import-group--amber mt-3 flex items-center gap-3 text-left">
            <WarningTriangle width={16} height={16} aria-hidden="true" className="shrink-0 text-amber-400" />
            <p className="text-[11px] leading-snug text-amber-100">
              {retryingPendingDelete
                ? `Deletion is already pending. Retry continues the original action: ${baseActionLabel}.`
                : isActive && !nextUsableImport
                  ? 'This is your only usable library. Deleting it returns DropDex to the empty state.'
                  : 'This is a permanent action and cannot be undone.'}
            </p>
          </div>

          {canChooseFallback && (
            <div className="mt-3">
              <p className="import-group__label">After deletion</p>
              <div className="flex gap-3">
                {([
                  ['activate_next', 'Delete Active Book', `Switch to the newest remaining snapshot: ${nextUsableImport?.source_filename ?? ''}.`, 'border-[var(--color-control-primary)]'],
                  ['start_over', 'Delete & Start Over', 'Leave DropDex with no active library. Other snapshots can be activated later in Settings.', 'border-[#d9707c]'],
                ] as const).map(([value, label, text, selectedBorder]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={deleting}
                    aria-pressed={strategy === value}
                    onClick={() => setStrategy(value)}
                    className={cn('import-group flex-1 !mb-0 text-left transition-colors', strategy === value ? selectedBorder : 'hover:border-[#ffffff33]')}
                  >
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3">
            <SlideToDelete disabled={deleting} onChange={setConfirmationValid} />
          </div>

          {error && (
            <div className="import-group mt-3 text-xs leading-relaxed text-red-300">{error}</div>
          )}

          <div className="flex justify-center gap-3 pt-5">
            <ControlButton type="button" variant="secondary" disabled={deleting} onClick={onClose}>
              <Xmark width={16} height={16} aria-hidden="true" /> Cancel
            </ControlButton>
            <ControlButton
              type="button"
              variant="danger"
              disabled={deleting || !confirmationValid}
              onClick={() => onConfirm(effectiveStrategy)}
            >
              {deleting ? (
                <>
                  <Refresh width={16} height={16} aria-hidden="true" className="animate-spin" />
                  {deletingRetryCount > 0 ? `Cleaning up… pass ${deletingRetryCount}` : 'Deleting…'}
                </>
              ) : (
                <><Trash width={16} height={16} aria-hidden="true" /> {actionLabel}</>
              )}
            </ControlButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
