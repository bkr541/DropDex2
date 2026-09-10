import { Close, DataBase } from '@carbon/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import type React from 'react';
import { ControlButton } from './ui/controls';
import { ImportStageProgress } from './ImportStageProgress';
import type { ImportUiStep } from './ImportStageProgress';

export type { ImportUiStep };

/**
 * Persistent modal shell for the entire Rekordbox import workflow.
 *
 * Fixed outer geometry (h-[600px] max-w-xl) so the modal frame never moves
 * or resizes as phases advance.  The shared header and five-stage stepper
 * remain visible on every screen.  Only the scrollable body region changes.
 *
 * The abortOverlay, when provided, is rendered absolutely above the entire
 * modal — header, stepper, and body — so confirmation dialogs always block
 * all content.
 */
export function ImportProgressModal({
  currentStep,
  onClose,
  abortOverlay,
  children,
}: {
  currentStep: ImportUiStep;
  /** Safety-aware close handler — must be handleClose from ImportLibraryModal. */
  onClose: () => void;
  /** When truthy, rendered as a full-modal blocking overlay. */
  abortOverlay?: React.ReactNode;
  /** Phase-specific content rendered in the scrollable body region. */
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      className="relative w-full max-w-xl h-[600px] max-h-[calc(100dvh-2rem)] overflow-hidden bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-3xl shadow-2xl flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-progress-title"
    >
      {/* Full-modal abort overlay — covers header, stepper, and body */}
      <AnimatePresence>
        {abortOverlay && (
          <motion.div
            key="abort-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 rounded-3xl p-8"
          >
            {abortOverlay}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shared header — identical on every phase */}
      <div className="flex items-center justify-between px-7 pt-5 pb-0 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
            <DataBase className="text-primary" size={20} aria-hidden />
          </div>
          <h2 id="import-progress-title" className="text-lg font-bold leading-tight">
            Import Rekordbox Library
          </h2>
        </div>
        <ControlButton variant="ghost" onClick={onClose} aria-label="Close">
          <Close size={18} />
        </ControlButton>
      </div>

      {/* Five-stage progress indicator */}
      <div className="px-7 pt-6 pb-0 shrink-0">
        <ImportStageProgress currentStep={currentStep} />
      </div>

      {/* Scrollable phase body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-4">
        {children}
      </div>
    </motion.div>
  );
}

/** Small helper: user-facing badge text for a track's parse status. */
export function issueBadgeLabel(status: string): string {
  if (status === 'partial') return 'Needs Review';
  if (status === 'failed') return 'Not Processed';
  if (status === 'missing_required') return 'Analysis File Missing';
  return status;
}

/**
 * Maps a coarse status + optional backend failure reason to a short,
 * user-readable explanation.  Never exposes Python tracebacks, SQL, or
 * internal paths.  Falls back to a generic truthful sentence when no
 * recognizable reason is available.
 */
export function userFriendlyIssueReason(
  status: string,
  failureReason: string | null | undefined,
): string {
  if (failureReason) {
    const r = failureReason.toLowerCase();
    const isSafe =
      !failureReason.includes('\n') &&
      !failureReason.includes('Traceback') &&
      !failureReason.includes('  File "') &&
      !failureReason.includes('supabase') &&
      !failureReason.includes('/usr/') &&
      !failureReason.includes('/home/') &&
      failureReason.length < 160;

    if (isSafe) {
      if (r.includes('color waveform') || (r.includes('ext') && r.includes('missing'))) {
        return 'Color waveform analysis file was not found for this track.';
      }
      if (r.includes('dat') && (r.includes('missing') || r.includes('not found'))) {
        return 'Required analysis file (.DAT) was not found for this track.';
      }
      if (r.includes('decode') || r.includes('corrupt') || r.includes('invalid header')) {
        return 'Analysis file data could not be decoded — the file may be corrupt.';
      }
      if (r.includes('timeout') || r.includes('timed out')) {
        return 'Analysis processing timed out for this track.';
      }
      if (r.includes('parse') || r.includes('struct')) {
        return 'Analysis file structure could not be parsed for this track.';
      }
      return failureReason;
    }
  }

  if (status === 'partial') {
    return 'Some analysis data could not be read from this track\'s analysis file.';
  }
  if (status === 'missing_required') {
    return 'The required analysis file was not found for this track.';
  }
  return 'DropDex could not read the required Rekordbox analysis data for this track.';
}
