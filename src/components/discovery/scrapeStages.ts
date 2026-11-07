import type { QuietPhase } from '../ui/feedback';
import { quietOverallPercent } from '../ui/feedback';
import type { DiscoveryScrapeJob } from '../../types';

/** The phases of an artist set search, in order. The last one is the finished state. */
export const SCRAPE_PHASES: readonly QuietPhase[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'search', label: 'Searching' },
  { id: 'collect', label: 'Collecting' },
  { id: 'complete', label: 'Complete' },
];

const COMPLETE = SCRAPE_PHASES.length - 1;

type JobProgress = Pick<DiscoveryScrapeJob, 'status' | 'pages_scraped' | 'results_found' | 'started_at'> & Partial<Pick<DiscoveryScrapeJob, 'total_results_reported'>>;

/** Which phase the set search is at: waiting, looking for sets, collecting what it found, or done. A failed search stays where it stopped. */
export function scrapeStageIndex(job: JobProgress | null): number {
  if (!job) return 0;
  if (job.status === 'completed') return COMPLETE;
  if (job.results_found > 0 || job.pages_scraped > 0) return 2;
  if (job.status === 'running' || job.started_at) return 1;
  return 0;
}

/** How far through its current phase the search is: half way through "searching" until sets arrive, then the share of the listed sets collected. */
export function scrapeStagePercent(job: JobProgress | null): number {
  if (!job) return 0;
  const stage = scrapeStageIndex(job);
  if (stage === 1) return 50;
  if (stage === 2) return job.total_results_reported ? Math.min(100, Math.round((job.results_found / job.total_results_reported) * 100)) : 50;
  return 0;
}

export function scrapeOverallPercent(job: JobProgress | null): number {
  return quietOverallPercent(scrapeStageIndex(job), SCRAPE_PHASES.length, scrapeStagePercent(job), job?.status === 'completed');
}
