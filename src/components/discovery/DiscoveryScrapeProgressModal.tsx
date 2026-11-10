import { AnimatePresence } from 'motion/react';
import { ArrowRight, CheckCircle, Search, Xmark, XmarkCircle } from 'iconoir-react/regular';
import type { DiscoveryScrapeJob } from '../../types';
import { ControlButton } from '../ui/controls';
import { QuietProgress } from '../ui/feedback';
import { ImportProgressModal } from '../ImportProgressModal';
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget && !isActive) onClose(); }}
        >
          <ImportProgressModal
            title={job?.artist_name ? `Find ${job.artist_name}’s Sets` : 'Find Sets'}
            icon={<Search className="shrink-0 text-[var(--color-control-primary)]" width={24} height={24} aria-hidden />}
            stepKey={`scrape-${stageIndex}-${status}`}
            status={isFailed || isUnavailable ? 'failed' : undefined}
            onClose={onClose}
            compact
            progress={(
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
              />
            )}
          >
            <div className="flex h-full flex-col" data-testid="discovery-scrape-modal">
              {isCompleted && (
                <div className="import-group import-group--success flex items-start gap-3 text-left">
                  <CheckCircle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-green-500" />
                  <p className="text-xs leading-relaxed text-green-100">The sets are saved. You can browse them on the artist page.</p>
                </div>
              )}
              {isFailed && (
                <div className="import-group flex items-start gap-3 text-left">
                  <XmarkCircle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-400" />
                  <p className="break-words text-xs leading-relaxed text-red-100">{job?.error_message || 'The search could not finish. Please try again.'}</p>
                </div>
              )}
              <div className="mt-auto flex justify-center gap-3 pt-4">
                {isCompleted ? (
                  <ControlButton variant="primary" onClick={onClose}><CheckCircle width={16} height={16} aria-hidden="true" /> Done</ControlButton>
                ) : (
                  <ControlButton variant="secondary" onClick={onClose}>
                    {isActive ? <><ArrowRight width={16} height={16} aria-hidden="true" /> Run in Background</> : <><Xmark width={16} height={16} aria-hidden="true" /> Close</>}
                  </ControlButton>
                )}
              </div>
            </div>
          </ImportProgressModal>
        </div>
      )}
    </AnimatePresence>
  );
}
