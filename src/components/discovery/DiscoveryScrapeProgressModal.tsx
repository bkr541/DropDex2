import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DiscoveryScrapeJob } from '../../types';

interface DiscoveryScrapeProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: DiscoveryScrapeJob | null;
}

export function DiscoveryScrapeProgressModal({
  isOpen,
  onClose,
  job,
}: DiscoveryScrapeProgressModalProps) {
  if (!job) return null;

  const isQueued = job.status === 'queued';
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isActive = isQueued || isRunning;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isActive) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            className="glass w-full max-w-sm rounded-2xl p-6 space-y-4 relative"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
                Search Progress
              </p>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-[var(--color-surface-hover)]"
                aria-label={isActive ? 'Run in background' : 'Close'}
              >
                <X size={14} />
              </button>
            </div>

            {/* Artist name */}
            {job.artist_name && (
              <h3 className="font-black text-xl leading-tight truncate">
                {job.artist_name}
              </h3>
            )}

            {/* Status block */}
            <div
              className={cn(
                'flex items-start gap-3 px-4 py-3 rounded-xl',
                isRunning && 'bg-secondary/10',
                isQueued && 'bg-[var(--color-surface)]',
                isCompleted && 'bg-emerald-500/10',
                isFailed && 'bg-red-500/10',
              )}
            >
              <div className="shrink-0 mt-0.5">
                {isActive && (
                  <Loader2
                    size={20}
                    className={cn(
                      'animate-spin',
                      isRunning ? 'text-secondary' : 'text-muted-foreground',
                    )}
                  />
                )}
                {isCompleted && <CheckCircle2 size={20} className="text-emerald-700" />}
                {isFailed && <XCircle size={20} className="text-red-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'text-sm font-bold uppercase tracking-wider',
                    isRunning && 'text-secondary',
                    isQueued && 'text-muted-foreground',
                    isCompleted && 'text-emerald-700',
                    isFailed && 'text-red-400',
                  )}
                >
                  {isQueued && 'Queued — waiting to start'}
                  {isRunning && 'Finding Artist Sets…'}
                  {isCompleted && 'Sets Found'}
                  {isFailed && 'Search failed'}
                </p>

                {isFailed && job.error_message && (
                  <p className="text-xs text-red-300 mt-1 font-mono break-words">
                    {job.error_message}
                  </p>
                )}
              </div>
            </div>

            {/* Footer button */}
            <button
              onClick={onClose}
              className={cn(
                'w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95',
                isActive
                  ? 'bg-[var(--color-surface)] text-muted-foreground hover:bg-[var(--color-surface-hover)]'
                  : isCompleted
                  ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
              )}
            >
              {isActive ? 'Run in background' : 'Close'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
