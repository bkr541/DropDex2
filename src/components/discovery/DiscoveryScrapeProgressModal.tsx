import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CheckmarkFilled, Close, CloseFilled, Search } from '@carbon/icons-react';
import type { DiscoveryScrapeJob } from '../../types';
import { ControlButton } from '../ui/controls';
import { QuietProgress } from '../ui/feedback';
import { SCRAPE_PHASES, scrapeOverallPercent, scrapeStageIndex, scrapeStagePercent } from './scrapeStages';

interface DiscoveryScrapeProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: DiscoveryScrapeJob | null;
  pollingError?: string | null;
}

/**
 * The artist set search, shown with the shared Quiet Figure progress display inside the same shell, header and button as the Rekordbox
 * import: a percentage, the four phases (queued, searching, collecting, complete), one sentence, and three figures.
 */
export function DiscoveryScrapeProgressModal({ isOpen, onClose, job, pollingError }: DiscoveryScrapeProgressModalProps) {
  if (!job && !pollingError) return null;

  const isCompleted = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
  const isUnavailable = !job && !!pollingError;
  const isActive = !isCompleted && !isFailed && !isUnavailable;
  const found = job?.results_found ?? 0;
  const artist = job?.artist_name ?? 'this artist';
  const stageIndex = scrapeStageIndex(job);
  const status = isCompleted ? 'done' : isFailed || isUnavailable ? 'failed' : 'running';

  const headline = isUnavailable ? 'Can’t check progress right now. Trying again automatically.'
    : isCompleted ? (found > 0 ? `${found.toLocaleString()} ${found === 1 ? 'set' : 'sets'} collected.` : 'No sets were found for this artist yet.')
    : isFailed ? 'The search stopped before it finished.'
    : stageIndex === 0 ? 'Your search is waiting to start.'
    : stageIndex === 1 ? `Searching for ${artist}’s sets. You can keep using DropDex while it runs.`
    : `Collecting sets… ${found.toLocaleString()} found so far.`;

  const figures = isUnavailable ? undefined : [
    { label: 'Pages searched', value: (job?.pages_scraped ?? 0).toLocaleString() },
    { label: 'Sets found', value: found.toLocaleString() },
    { label: 'Total listed', value: job?.total_results_reported != null ? job.total_results_reported.toLocaleString() : '—' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !isActive) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-[624px] overflow-hidden bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-3xl shadow-2xl flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discovery-scrape-title"
            data-testid="discovery-scrape-modal"
          >
            <div className="flex items-center justify-between px-7 pt-5 pb-0 shrink-0">
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                  <Search className="text-primary" size={24} aria-hidden />
                </div>
                <h2 id="discovery-scrape-title" className="truncate text-xl font-bold leading-tight">
                  {job?.artist_name ? `Find ${job.artist_name}’s Sets` : 'Find Sets'}
                </h2>
              </div>
              <ControlButton variant="ghost" onClick={onClose} aria-label={isActive ? 'Run in background' : 'Close'}>
                <Close size={18} />
              </ControlButton>
            </div>

            <div className="px-7 pt-5 pb-2">
              <QuietProgress
                title="Set search"
                phases={SCRAPE_PHASES}
                activeIndex={stageIndex}
                percent={scrapeOverallPercent(job)}
                stagePercent={scrapeStagePercent(job)}
                status={status}
                headline={headline}
                caption={isFailed ? 'Stopped' : isUnavailable ? 'Unavailable' : undefined}
                figures={figures}
              >
                {isCompleted && (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left">
                    <CheckmarkFilled size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                    <p className="text-xs leading-relaxed text-emerald-100">The sets are saved. You can browse them on the artist page.</p>
                  </div>
                )}
                {isFailed && (
                  <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left">
                    <CloseFilled size={16} className="mt-0.5 shrink-0 text-red-400" />
                    <p className="text-xs leading-relaxed text-red-100 break-words">{job?.error_message || 'The search could not finish. Please try again.'}</p>
                  </div>
                )}
              </QuietProgress>
            </div>

            <div className="flex justify-center px-7 pb-6 pt-3 shrink-0">
              {isCompleted ? (
                <ControlButton variant="primary" onClick={onClose}><CheckmarkFilled size={16} /> Done</ControlButton>
              ) : (
                <ControlButton variant="secondary" onClick={onClose}>
                  {isActive ? <><ArrowRight size={16} /> Run in Background</> : <><Close size={16} /> Close</>}
                </ControlButton>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
