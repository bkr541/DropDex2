import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { DiscoveryScrapeJob } from '../../types';

interface DiscoveryScrapeProgressProps {
  job: DiscoveryScrapeJob;
}

export function DiscoveryScrapeProgress({ job }: DiscoveryScrapeProgressProps) {
  const isQueued = job.status === 'queued';
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';

  return (
    <div
      className={cn(
        'glass p-4 rounded-2xl border-l-4 flex items-start gap-4',
        isRunning && 'border-l-secondary',
        isQueued && 'border-l-[var(--color-muted-foreground)]',
        isCompleted && 'border-l-green-500',
        isFailed && 'border-l-red-500',
      )}
    >
      <div className="shrink-0 mt-0.5">
        {(isQueued || isRunning) && (
          <Loader2
            className={cn('animate-spin', isRunning ? 'text-secondary' : 'text-muted-foreground')}
            size={20}
          />
        )}
        {isCompleted && <CheckCircle2 size={20} className="text-green-500" />}
        {isFailed && <XCircle size={20} className="text-red-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-sm font-bold uppercase tracking-wider',
            isRunning && 'text-secondary',
            isQueued && 'text-muted-foreground',
            isCompleted && 'text-green-500',
            isFailed && 'text-red-400',
          )}
        >
          {isQueued && 'Queued — waiting to start'}
          {isRunning && 'Scraping 1001Tracklists…'}
          {isCompleted && 'Scrape complete'}
          {isFailed && 'Scrape failed'}
        </p>

        {(isRunning || isCompleted) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {job.pages_scraped > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                {job.pages_scraped} page{job.pages_scraped !== 1 ? 's' : ''} scraped
              </span>
            )}
            {job.results_found > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                {job.results_found}
                {job.total_results_reported != null
                  ? ` / ${job.total_results_reported}`
                  : ''}{' '}
                found
              </span>
            )}
          </div>
        )}

        {isFailed && job.error_message && (
          <p className="text-xs text-red-300 mt-1 font-mono break-words">{job.error_message}</p>
        )}
      </div>
    </div>
  );
}
