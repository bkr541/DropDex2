import { AnimatePresence, motion } from 'motion/react';
import type React from 'react';

/**
 * Stable-geometry dialog shell for the post-start Rekordbox import workflow.
 *
 * The outer box is always exactly 560 px tall and max-xl wide so stage
 * transitions (Uploading → Analysis Running → Import Complete → Track Issues)
 * never change the modal dimensions.  Scrolling is handled by the inner
 * overflow-y-auto region; the abort-confirmation overlay is projected
 * absolutely on top of all content.
 *
 * Usage: wrap each post-start phase's content in this shell, then render
 * the phase-specific JSX as children.  Use flex flex-col min-h-full inside
 * children to anchor action buttons at the bottom with mt-auto.
 */
export function ImportProgressModal({
  abortOverlay,
  children,
}: {
  /** When truthy, rendered as a blocking overlay over the modal content. */
  abortOverlay?: React.ReactNode;
  /** Phase-specific content.  Scrolls when it exceeds the available height. */
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      className="relative w-full max-w-xl bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      style={{ height: 560 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-progress-title"
    >
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

      {/* min-h-0 lets flex-1 shrink so overflow-y-auto actually scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto p-8">
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
    // Reject multi-line strings (tracebacks) and internal module paths
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
      // Short, clean string that doesn't match a known pattern — safe to surface
      return failureReason;
    }
  }

  // Status-based fallbacks
  if (status === 'partial') {
    return 'Some analysis data could not be read from this track\'s analysis file.';
  }
  if (status === 'missing_required') {
    return 'The required analysis file was not found for this track.';
  }
  // failed or unknown
  return 'DropDex could not read the required Rekordbox analysis data for this track.';
}
