import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CheckmarkFilled, CircleDash, Close, CloseFilled, Search } from '@carbon/icons-react';
import type { DiscoveryScrapeJob } from '../../types';
import { ControlButton } from '../ui/controls';
import { StageStepper } from '../StageStepper';
import { SCRAPE_STEPS, scrapeStageIndex } from './scrapeStages';

interface DiscoveryScrapeProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: DiscoveryScrapeJob | null;
  pollingError?: string | null;
}

/**
 * The set search for an artist, laid out like the Rekordbox import: the same shell, header, stage row, round status
 * icon, headline, three figure cards and button.
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

  const headline = isUnavailable ? 'Can’t check progress'
    : isCompleted ? 'Sets Found!'
    : isFailed ? 'Search failed'
    : stageIndex === 0 ? 'Getting ready…'
    : stageIndex === 1 ? `Searching for ${artist}’s sets…`
    : 'Collecting sets…';
  const detail = isUnavailable ? 'Trying again automatically.'
    : isCompleted ? (found > 0 ? `${found.toLocaleString()} ${found === 1 ? 'set' : 'sets'} collected.` : 'No sets were found for this artist yet.')
    : isFailed ? null
    : stageIndex === 0 ? 'Your search is waiting to start.'
    : stageIndex === 1 ? 'This can take a minute. You can keep using DropDex while it runs.'
    : `${found.toLocaleString()} found so far.`;

  const stats = [
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
            className="relative w-full max-w-[624px] h-[560px] max-h-[calc(100dvh-2rem)] overflow-hidden bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-3xl shadow-2xl flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discovery-scrape-title"
            data-testid="discovery-scrape-modal"
          >
            {/* Header — the same as the import */}
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

            <div className="px-[52px] pt-6 pb-0 shrink-0">
              <StageStepper steps={SCRAPE_STEPS} activeIndex={stageIndex} ariaLabel="Set search progress" failed={isFailed || isUnavailable} />
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-4 text-center">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${isFailed || isUnavailable ? 'bg-red-500/10' : isCompleted ? 'bg-emerald-500/10' : 'bg-[#168cff]/10'}`}>
                {isCompleted && <CheckmarkFilled className="text-emerald-400" size={24} />}
                {(isFailed || isUnavailable) && <CloseFilled className="text-red-400" size={24} />}
                {isActive && <CircleDash className="animate-spin text-[#168cff]" size={24} />}
              </div>
              <h3 className="text-xl font-bold mb-1">{headline}</h3>
              {detail && <p className="text-sm text-muted-foreground mb-4">{detail}</p>}

              {isCompleted && (
                <div className="my-3 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left">
                  <CheckmarkFilled size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                  <p className="text-xs leading-relaxed text-emerald-100">The sets are saved. You can browse them on the artist page.</p>
                </div>
              )}
              {isFailed && (
                <div className="my-3 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left">
                  <CloseFilled size={16} className="mt-0.5 shrink-0 text-red-400" />
                  <p className="text-xs leading-relaxed text-red-100 break-words">{job?.error_message || 'The search could not finish. Please try again.'}</p>
                </div>
              )}

              {!isUnavailable && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {stats.map(({ label, value }) => (
                    <div key={label} className="glass rounded-xl p-3">
                      <p className="text-lg font-black font-mono truncate" title={value}>{value}</p>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Button */}
            <div className="flex justify-center px-7 pb-6 shrink-0">
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
