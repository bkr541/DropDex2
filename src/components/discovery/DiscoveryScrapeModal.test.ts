import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryScrapeJob } from '../../types';
import { SCRAPE_PHASES, scrapeStageIndex } from './scrapeStages';
import { DiscoveryScrapeProgressModal } from './DiscoveryScrapeProgressModal';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const job = (over: Partial<DiscoveryScrapeJob> = {}): DiscoveryScrapeJob => ({
  job_id: 'j', artist_id: 'a', artist_name: 'ILLENIUM', source: '1001tracklists', status: 'running', pages_scraped: 0, results_found: 0,
  total_results_reported: null, error_message: null, created_at: null, started_at: '2026-11-06T00:00:00Z', completed_at: null, ...over,
});
const render = (j: DiscoveryScrapeJob | null, pollingError: string | null = null) =>
  renderToStaticMarkup(createElement(DiscoveryScrapeProgressModal, { isOpen: true, onClose: vi.fn(), job: j, pollingError }));

describe('Discovery set search popover', () => {
  it('uses the shared Quiet Figure display inside the Rekordbox import shell', () => {
    const markup = render(job());
    expect(markup).toContain('max-w-[624px]');
    expect(markup).toContain('bg-primary/10 rounded-xl');
    expect(markup).toContain('data-testid="quiet-progress"');
    expect(markup).toContain('data-testid="quiet-phases"');
    for (const label of ['Queued', 'Searching', 'Collecting', 'Complete']) expect(markup).toContain(label);
    for (const label of ['Pages searched', 'Sets found', 'Total listed']) expect(markup).toContain(label);
    expect(read('./DiscoveryScrapeProgressModal.tsx')).toContain('<QuietProgress');
    expect(read('./DiscoveryScrapeProgressModal.tsx')).not.toContain('StageStepper');
  });

  it('moves through queued, searching, collecting and complete', () => {
    expect(SCRAPE_PHASES.map((phase) => phase.id)).toEqual(['queued', 'search', 'collect', 'complete']);
    expect(scrapeStageIndex(null)).toBe(0);
    expect(scrapeStageIndex(job({ status: 'queued', started_at: null }))).toBe(0);
    expect(scrapeStageIndex(job())).toBe(1);
    expect(scrapeStageIndex(job({ pages_scraped: 2, results_found: 14 }))).toBe(2);
    expect(scrapeStageIndex(job({ status: 'completed', results_found: 14 }))).toBe(3);
    expect(scrapeStageIndex(job({ status: 'failed', pages_scraped: 1 }))).toBe(2);
  });

  it('says plainly what is happening at each point', () => {
    expect(render(job({ status: 'queued', started_at: null }))).toContain('Your search is waiting to start.');
    expect(render(job())).toContain('Searching for ILLENIUM’s sets.');
    expect(render(job({ pages_scraped: 1, results_found: 9 }))).toContain('9 found so far.');
    expect(render(job())).toContain('Run in Background');
  });

  it('finishes with a tick, a count, the figures and a Done button', () => {
    const markup = render(job({ status: 'completed', pages_scraped: 3, results_found: 41, total_results_reported: 52 }));
    expect(markup).toContain('41 sets collected.');
    expect(markup).toContain('>52<');
    expect(markup).toContain('Done');
  });

  it('shows a failure in red with the reason and a Close button', () => {
    const markup = render(job({ status: 'failed', error_message: 'The site did not answer.' }));
    expect(markup).toContain('The search stopped before it finished.');
    expect(markup).toContain('The site did not answer.');
    expect(markup).toContain('text-red-400');
    expect(render(job({ status: 'failed' }))).toContain('The search could not finish. Please try again.');
  });

  it('says so when progress cannot be checked, instead of rendering nothing', () => {
    expect(render(null, 'boom')).toContain('Can’t check progress right now');
    expect(renderToStaticMarkup(createElement(DiscoveryScrapeProgressModal, { isOpen: true, onClose: vi.fn(), job: null, pollingError: null }))).toBe('');
  });
});
