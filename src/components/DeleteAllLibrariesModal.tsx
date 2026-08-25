import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CircleDash, Close, TrashCan, WarningAlt } from '@carbon/icons-react';
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

const THUMB_SIZE = 44;
const TRACK_PAD = 4;

export function DeleteAllLibrariesModal({
  open,
  visibleSnapshotCount,
  deleting,
  cleanupPass = 0,
  error,
  onClose,
  onConfirm,
}: DeleteAllLibrariesModalProps) {
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setProgress(0);
      setDragging(false);
    }
  }, [open]);

  if (!open) return null;

  const confirmed = progress >= 1;

  const maxOffset = trackRef.current
    ? trackRef.current.offsetWidth - THUMB_SIZE - TRACK_PAD * 2
    : 0;
  const thumbX = progress * maxOffset;
  const fillWidth = TRACK_PAD + thumbX + THUMB_SIZE;

  function handleThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (deleting || confirmed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function handleThumbPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const max = trackRef.current.offsetWidth - THUMB_SIZE - TRACK_PAD * 2;
    const raw = e.clientX - rect.left - THUMB_SIZE / 2 - TRACK_PAD;
    setProgress(Math.max(0, Math.min(1, max > 0 ? raw / max : 0)));
  }

  function handleThumbPointerUp() {
    if (!dragging) return;
    setDragging(false);
    setProgress(prev => (prev >= 0.9 ? 1 : 0));
  }

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
                Delete all <span className="text-red-400">{visibleSnapshotCount.toLocaleString()}</span> Rekordbox libraries?
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Permanently removes all snapshots and their imported tracks, playlists, analysis data, and assets. Your account, profile, and app preferences are not affected.
              </p>
            </div>
          </div>

          {/* Drag-to-confirm slider */}
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Slide to enable deletion
            </p>
            <div
              ref={trackRef}
              className="relative h-[52px] overflow-hidden rounded-full border border-red-500/20 select-none"
            >
              {/* Fill — only visible when confirmed */}
              {confirmed && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'linear-gradient(90deg, #7f1619 0%, #b01318 100%)' }}
                />
              )}
              {/* Idle label */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{ opacity: Math.max(0, 1 - progress * 2.5) }}
              >
                <span className="text-[11px] font-semibold tracking-wider text-red-400/40">
                  Drag to confirm
                </span>
              </div>
              {/* Confirmed label */}
              {confirmed && !deleting && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="text-[11px] font-semibold tracking-wider text-red-300/80">
                    Ready — press Delete All
                  </span>
                </div>
              )}
              {/* Thumb */}
              <div
                onPointerDown={handleThumbPointerDown}
                onPointerMove={handleThumbPointerMove}
                onPointerUp={handleThumbPointerUp}
                className="absolute flex items-center justify-center rounded-full bg-red-400"
                style={{
                  left: TRACK_PAD,
                  top: TRACK_PAD,
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  transform: `translateX(${thumbX}px)`,
                  transition: dragging ? 'none' : 'transform 220ms ease',
                  cursor: confirmed || deleting ? 'default' : dragging ? 'grabbing' : 'grab',
                }}
              >
                {confirmed ? (
                  <svg viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="rgba(255,200,200,0.9)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="4 10 8 14 16 6" />
                  </svg>
                ) : (
                  <ArrowRight size={18} className="text-white" />
                )}
              </div>
            </div>
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
              variant="danger-outline"
              disabled={deleting || !confirmed}
              onClick={onConfirm}
              className="flex-1"
            >
              {deleting ? (
                <>
                  <CircleDash size={16} className="animate-spin" />
                  Deleting all…
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
