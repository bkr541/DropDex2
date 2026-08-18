import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
import type { DiscoveryScrapeJob } from '../../types';
import { ArrowRight, CheckmarkFilled, Close, CloseFilled } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';

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
            className="bg-[var(--color-card)] text-[var(--color-card-foreground)] w-full max-w-lg rounded-3xl p-6 relative shadow-2xl"
          >
            {/* Close / background button */}
            <ControlButton variant="ghost" onClick={onClose} aria-label={isActive ? 'Run in background' : 'Close'} className="absolute top-4 right-4 opacity-30 hover:opacity-60">
              <Close size={18} />
            </ControlButton>

            <div className="flex gap-5 items-start">
              {/* Header */}
              <div className="min-w-0 flex-1 pr-6">
                {job?.artist_name && (
                  <h2 className="text-2xl font-black leading-tight truncate">
                    {job.artist_name}
                  </h2>
                )}
                <p className="text-[9px] uppercase tracking-[0.22em] opacity-40 mt-1 font-semibold">
                  Search Progress
                </p>
                {pollingError && (
                  <p className="mt-2 text-[10px] text-red-400 font-mono break-words">
                    Status refresh failed. Retrying automatically.
                  </p>
                )}
              </div>

              {/* Status area */}
              <div
                className={cn(
                  'flex flex-col items-center justify-center w-48 shrink-0 rounded-2xl border-2 border-dashed gap-3 px-4 py-5',
                  isActive && 'border-[var(--color-border-subtle)]',
                  isCompleted && 'border-emerald-500/30',
                  isFailed && 'border-red-400/30',
                )}
              >
                {!job && pollingError && (
                  <>
                    <CloseFilled size={28} className="text-red-400" />
                    <div className="text-center space-y-1">
                      <p className="text-xs font-bold text-red-400">Unavailable</p>
                      <p className="text-[10px] opacity-55 leading-relaxed">Retrying automatically.</p>
                    </div>
                  </>
                )}

                {isActive && (
                  <>
                    <DotSpinner />
                    <div className="text-center space-y-0.5">
                      <p className="text-xs font-bold">
                        {isRunning ? 'Finding sets…' : 'Waiting to start…'}
                      </p>
                      <p className="text-[10px] opacity-45">This may take a moment</p>
                    </div>
                  </>
                )}

                {isCompleted && (
                  <>
                    <CheckmarkFilled size={28} className="text-emerald-500" />
                    <div className="text-center space-y-0.5">
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Sets Found!</p>
                      {(job?.results_found ?? 0) > 0 && (
                        <p className="text-[10px] opacity-45">
                          {job?.results_found ?? 0}
                          {job?.total_results_reported ? ` of ${job.total_results_reported}` : ''} collected
                        </p>
                      )}
                    </div>
                  </>
                )}

                {isFailed && (
                  <>
                    <CloseFilled size={28} className="text-red-400" />
                    <div className="text-center space-y-0.5">
                      <p className="text-xs font-bold text-red-400">Search failed</p>
                      {job?.error_message && (
                        <p className="text-[10px] font-mono opacity-55 break-words leading-relaxed">
                          {job?.error_message}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer button */}
            <ControlButton
              onClick={onClose}
              variant={isActive ? 'neutral' : isCompleted ? 'primary' : 'danger-outline'}
              className="w-full mt-5"
            >
              {isActive ? <><ArrowRight size={16} /> Run in Background</> : <><Close size={16} /> Close</>}
            </ControlButton>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
