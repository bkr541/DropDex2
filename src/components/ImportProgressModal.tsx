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
      className="relative w-full max-w-[624px] h-[600px] max-h-[calc(100dvh-2rem)] overflow-hidden bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-3xl shadow-2xl flex flex-col"
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
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
            <DataBase className="text-primary" size={24} aria-hidden />
          </div>
          <h2 id="import-progress-title" className="text-xl font-bold leading-tight">
            Import Rekordbox Library
          </h2>
        </div>
        <ControlButton variant="ghost" onClick={onClose} aria-label="Close">
          <Close size={18} />
        </ControlButton>
      </div>

      {/* Five-stage progress indicator — fixed width centered in the wider modal */}
      <div className="px-[52px] pt-6 pb-0 shrink-0">
        <ImportStageProgress currentStep={currentStep} />
      </div>

      {/* Scrollable phase body — overflow-hidden clips x so the slide is visible */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="h-full overflow-y-auto px-7 py-4"
          >
            {children}
          </motion.div>
        </AnimatePresence>
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

export function trackExpandedDetail(
  status: string,
  failureReason: string | null | undefined,
  warnings: Array<{ code?: string }> | null | undefined,
): string {
  const codes = new Set((warnings ?? []).map(w => w.code ?? ''));

  if (status === 'missing_required') {
    return "The analysis file for this track wasn't found on the USB drive. Without it, DropDex can't read the beat grid, waveform, or cue points. Try re-exporting your library from Rekordbox and importing again.";
  }

  if (status === 'failed') {
    if (codes.has('FEATURE_WRITE_ERROR')) {
      return "This track's analysis data was read successfully but couldn't be saved to your library. Re-importing or running the analysis again should fix it.";
    }
    const r = (failureReason ?? '').toLowerCase();
    if (r.includes('parse') || r.includes('struct') || r.includes('corrupt') || r.includes('decode')) {
      return "DropDex couldn't read the analysis file for this track — it may be from an unsupported Rekordbox version or the file may be damaged. Re-analyzing the track in Rekordbox and importing again may help.";
    }
    return "DropDex ran into an unexpected error while processing this track and had to skip it. Re-importing should fix it in most cases.";
  }

  if (status === 'partial') {
    if (codes.has('WAVEFORM_PARSE_ERROR') || codes.has('WAVEFORM_TRUNCATED') || codes.has('WAVEFORM_COUNT_MISMATCH')) {
      return "This track was imported, but there was a problem reading its waveform. Everything else — beat grid, cue points, and playback — should work normally.";
    }
    if (codes.has('BEAT_PARSE_ERROR') || codes.has('BEAT_COUNT_MISMATCH')) {
      return "This track was imported, but the beat grid data couldn't be fully read. Tempo markers or beat positions may be missing or incomplete.";
    }
    if (codes.has('PHRASE_PARSE_ERROR') || codes.has('PHRASE_UNKNOWN_MOOD') || codes.has('PHRASE_UNKNOWN_KIND')) {
      return "This track was imported successfully. The phrase and energy section data couldn't be fully read, but beat grid, waveform, and cue points are unaffected.";
    }
    if (codes.has('CUE_MEMORY_CONFLICT') || codes.has('CUE_HOT_PCO2_CONFLICT')) {
      return "This track was imported, but two cue points were in the same position so one was removed. All other cue points and track data are intact.";
    }
    return "This track was imported, but some of its detailed analysis data — like waveform or beat markers — couldn't be fully read from the file.";
  }

  return "This track couldn't be fully processed. Re-importing may resolve the issue.";
}
