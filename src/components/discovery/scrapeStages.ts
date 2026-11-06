import { CheckmarkFilled, Document, Search, Time } from '@carbon/icons-react';
import type { StageStep } from '../StageStepper';
import type { DiscoveryScrapeJob } from '../../types';

export const SCRAPE_STEPS: readonly StageStep[] = [
  { id: 'queued', label: 'QUEUED', Icon: Time },
  { id: 'search', label: 'SEARCHING', Icon: Search },
  { id: 'collect', label: 'COLLECTING', Icon: Document },
  { id: 'complete', label: 'COMPLETE', Icon: CheckmarkFilled },
];

const COMPLETE = SCRAPE_STEPS.length - 1;

/** Which stage the set search is at: waiting, looking for sets, collecting what it found, or done. A failed search stays where it stopped. */
export function scrapeStageIndex(job: Pick<DiscoveryScrapeJob, 'status' | 'pages_scraped' | 'results_found' | 'started_at'> | null): number {
  if (!job) return 0;
  if (job.status === 'completed') return COMPLETE;
  if (job.results_found > 0 || job.pages_scraped > 0) return 2;
  if (job.status === 'running' || job.started_at) return 1;
  return 0;
}
