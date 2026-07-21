import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DiscoveryScrapeJob } from '../../types';

interface DiscoveryScrapeProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: DiscoveryScrapeJob | null;
  pollingError?: string | null;
}

function DotSpinner() {
  return (
    <div className="relative w-12 h-12">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="absolute w-2 h-2"
          style={{
            top: 0,
            left: '50%',
            marginLeft: '-4px',
            transformOrigin: '4px 24px',
            transform: `rotate(${i * 45}deg)`,
          }}
        >
          <motion.div
            className="w-2 h-2 rounded-full bg-primary"
            animate={{ opacity: [1, 0.15] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: (i / 8) * 0.8,
              ease: 'linear',
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function DiscoveryScrapeProgressModal({
  isOpen,
  onClose,
  job,
  pollingError,
}: DiscoveryScrapeProgressModalProps) {
  if (!job && !pollingError) return null;

  const isQueued = job?.status === 'queued';
  const isRunning = job?.status === 'running';
  const isCompleted = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
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
            className="bg-[var(--color-card)] text-[var(--color-card-foreground)] w-full max-w-sm rounded-3xl p-7 relative shadow-2xl"
          >
            {/* Close / background button */}
            <button
              onClick={onClose}
              className="absolute top-5 right-5 opacity-30 hover:opacity-60 transition-opacity p-1 rounded-lg"
              aria-label={isActive ? 'Run in background' : 'Close'}
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div className="mb-5 pr-8">
              {job?.artist_name && (
                <h2 className="text-[2rem] font-black leading-none truncate">
                  {job.artist_name}
                </h2>
              )}
              <p className="text-[9px] uppercase tracking-[0.22em] opacity-40 mt-1.5 font-semibold">
                Search Progress
              </p>
            </div>

            {/* Status container — min-h keeps consistent modal size across states */}
            {pollingError && (
              <p className="mb-3 text-[10px] text-red-400 font-mono break-words">
                Status refresh failed. Retrying automatically: {pollingError}
              </p>
            )}

            <div
              className={cn(
                'flex flex-col items-center justify-center min-h-[176px] rounded-2xl border-2 border-dashed gap-3 px-6 py-6',
                isActive && 'border-[var(--color-border-subtle)]',
                isCompleted && 'border-emerald-500/30',
                isFailed && 'border-red-400/30',
              )}
            >
              {!job && pollingError && (
                <>
                  <XCircle size={32} className="text-red-400" />
                  <div className="text-center space-y-1 px-2">
                    <p className="text-sm font-bold text-red-400">Status temporarily unavailable</p>
                    <p className="text-[10px] font-mono opacity-55 break-words leading-relaxed">
                      DropDex is retrying automatically.
                    </p>
                  </div>
                </>
              )}

              {isActive && (
                <>
                  <DotSpinner />
                  <div className="text-center space-y-1 mt-1">
                    <p className="text-sm font-bold">
                      {isRunning ? 'Finding artist sets…' : 'Waiting to start…'}
                    </p>
                    <p className="text-xs opacity-45">This may take a few moments</p>
                  </div>
                </>
              )}

              {isCompleted && (
                <>
                  <CheckCircle2 size={32} className="text-emerald-500" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      Sets Found!
                    </p>
                    {(job?.results_found ?? 0) > 0 && (
                      <p className="text-xs opacity-45">
                        {job?.results_found ?? 0}
                        {job?.total_results_reported ? ` of ${job.total_results_reported}` : ''} sets collected
                      </p>
                    )}
                  </div>
                </>
              )}

              {isFailed && (
                <>
                  <XCircle size={32} className="text-red-400" />
                  <div className="text-center space-y-1 px-2">
                    <p className="text-sm font-bold text-red-400">Search failed</p>
                    {job?.error_message && (
                      <p className="text-[10px] font-mono opacity-55 break-words leading-relaxed">
                        {job?.error_message}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer button */}
            <button
              onClick={onClose}
              className={cn(
                'w-full mt-5 py-[18px] rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all active:scale-[0.98]',
                isActive
                  ? 'bg-[var(--color-avatar-bg)] text-[var(--color-text-subdued)] hover:opacity-80'
                  : isCompleted
                  ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
              )}
            >
              {isActive ? 'Run in Background' : 'Close'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
