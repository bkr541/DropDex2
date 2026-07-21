import { useState } from 'react';
import { Loader2, ListMusic, ChevronDown, Search } from 'lucide-react';
import { ArtistHero } from './ArtistHero';
import { ArtistStylesSidebar } from './ArtistStylesSidebar';
import { type ArtistTabId } from './ArtistResultsTabs';
import { ArtistResultsToolbar, type SortKey } from './ArtistResultsToolbar';
import { ArtistSetlistCard } from './ArtistSetlistCard';
import type { DiscoveryArtist, DiscoveryArtistDetail, DiscoverySetlistResult, DiscoveryScrapeJob } from '../../types';

function sortSetlists(
  setlists: DiscoverySetlistResult[],
  key: SortKey,
): DiscoverySetlistResult[] {
  const sorted = [...setlists];
  switch (key) {
    case 'date_desc':
      return sorted.sort((a, b) => (b.set_date ?? '').localeCompare(a.set_date ?? ''));
    case 'date_asc':
      return sorted.sort((a, b) => (a.set_date ?? '').localeCompare(b.set_date ?? ''));
    case 'most_viewed':
      return sorted.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    case 'highest_completion':
      return sorted.sort((a, b) => (b.completion_pct ?? 0) - (a.completion_pct ?? 0));
    default:
      return sorted;
  }
}

interface ArtistPageProps {
  artist: DiscoveryArtist;
  artistDetail: DiscoveryArtistDetail | null;
  detailLoading: boolean;
  setlists: DiscoverySetlistResult[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  hasMore: boolean;
  scrapeJob: DiscoveryScrapeJob | null;
  scrapeStarting: boolean;
  scrapeError: string | null;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
  onRefresh: () => void;
  onViewProgress: () => void;
  onLoadMore: () => void;
}

export function ArtistPage({
  artist,
  artistDetail,
  detailLoading,
  setlists,
  total,
  loading,
  loadingMore,
  error,
  loadMoreError,
  hasMore,
  scrapeJob,
  scrapeStarting,
  scrapeError,
  onOpenSetlist,
  onRefresh,
  onViewProgress,
  onLoadMore,
}: ArtistPageProps) {
  const [activeTab, setActiveTab] = useState<ArtistTabId>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [filterQuery, setFilterQuery] = useState('');

  const isJobActive = scrapeJob?.status === 'queued' || scrapeJob?.status === 'running';
  const isScrapeActive = scrapeStarting || isJobActive;

  const q = filterQuery.trim().toLowerCase();
  const filtered =
    q.length >= 2
      ? setlists.filter(
          (s) =>
            (s.title ?? '').toLowerCase().includes(q) ||
            (s.creator_username ?? '').toLowerCase().includes(q) ||
            (s.music_styles ?? []).some((style) => style.toLowerCase().includes(q)) ||
            (s.set_date ?? '').includes(q),
        )
      : setlists;
  const displayed = sortSetlists(filtered, sortKey);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <ArtistHero
        artist={artist}
        artistDetail={artistDetail}
        detailLoading={detailLoading}
        scrapeJob={scrapeJob}
        scrapeStarting={scrapeStarting}
        onRefresh={onRefresh}
        onViewProgress={onViewProgress}
        hasSetlists={setlists.length > 0}
      />

      {scrapeError && (
        <p className="text-xs text-red-400 font-mono px-1">{scrapeError}</p>
      )}

      {/* Two-column layout: sidebar + results */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Sidebar — only shown when there's style data */}
        {setlists.length > 0 && (
          <div className="w-full lg:w-56 xl:w-64 lg:shrink-0">
            <ArtistStylesSidebar setlists={setlists} />
          </div>
        )}

        {/* Main results area */}
        <div className="flex-1 min-w-0 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-primary" size={28} />
            </div>
          ) : error ? (
            <div className="text-center py-12 space-y-2">
              <p className="text-red-400 font-bold text-sm">Failed to load setlists</p>
              <p className="text-xs text-muted-foreground font-mono">{error}</p>
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl space-y-3">
              {isScrapeActive ? (
                <>
                  <Search size={36} className="mx-auto text-primary opacity-40" />
                  <p className="text-sm font-bold text-muted-foreground">Searching for setlists…</p>
                </>
              ) : (
                <>
                  <ListMusic size={36} className="mx-auto text-muted-foreground opacity-30" />
                  <div>
                    <p className="text-sm font-bold text-muted-foreground">No setlists found yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use &ldquo;Retry Search&rdquo; to scrape 1001Tracklists for this artist.
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <ArtistResultsToolbar
                total={total}
                loaded={setlists.length}
                sortKey={sortKey}
                onSortChange={setSortKey}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                filterQuery={filterQuery}
                onFilterChange={setFilterQuery}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayed.map((setlist) => (
                  <ArtistSetlistCard
                    key={setlist.id}
                    setlist={setlist}
                    onOpen={onOpenSetlist}
                  />
                ))}
              </div>

              {hasMore && (
                <div className="flex flex-col items-center gap-2 pt-2">
                  {loadMoreError && (
                    <p className="max-w-xl text-center text-xs text-red-400 font-mono">
                      Could not load more setlists: {loadMoreError}
                    </p>
                  )}
                  <button
                    onClick={onLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-xs font-bold uppercase tracking-widest hover:bg-[var(--color-surface-hover)] transition-all disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Loading…
                      </>
                    ) : (
                      <>
                        <ChevronDown size={14} />
                        {loadMoreError ? 'Retry Load More' : 'Load More'}
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
