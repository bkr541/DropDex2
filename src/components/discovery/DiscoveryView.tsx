import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useArtistDiscoverySearch } from '../../hooks/useArtistDiscoverySearch';
import { useArtistSetlists } from '../../hooks/useArtistSetlists';
import { useDiscoveryScrapeJob } from '../../hooks/useDiscoveryScrapeJob';
import { startArtistSetlistScrape } from '../../lib/api/discovery';
import { ArtistSearchInput } from './ArtistSearchInput';
import { ArtistSearchResults } from './ArtistSearchResults';
import { DiscoveryScrapeProgressModal } from './DiscoveryScrapeProgressModal';
import { ArtistPage } from './ArtistPage';
import type { DiscoveryArtist, DiscoverySetlistResult } from '../../types';

interface DiscoveryViewProps {
  accessToken: string | null;
}

export function DiscoveryView({ accessToken }: DiscoveryViewProps) {
  const [query, setQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<DiscoveryArtist | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showScrapeModal, setShowScrapeModal] = useState(false);
  const [selectedSetlist, setSelectedSetlist] = useState<DiscoverySetlistResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeStarting, setScrapeStarting] = useState(false);
  const [showArtistPage, setShowArtistPage] = useState(false);

  const { results: searchResults, loading: searchLoading } = useArtistDiscoverySearch(
    query,
    accessToken,
  );
  const {
    setlists,
    total,
    loading: setlistsLoading,
    loadingMore,
    error: setlistsError,
    refetch: refetchSetlists,
    loadMore,
    hasMore,
  } = useArtistSetlists(selectedArtist?.id ?? null, accessToken);
  const { job: scrapeJob } = useDiscoveryScrapeJob(activeJobId, accessToken);

  // Transition to artist page once the initial setlist load finishes (even if empty)
  const prevSetlistsLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevSetlistsLoadingRef.current;
    prevSetlistsLoadingRef.current = setlistsLoading;
    if (wasLoading && !setlistsLoading && selectedArtist) {
      setShowArtistPage(true);
    }
  }, [setlistsLoading, selectedArtist]);

  // Transition to artist page when scrape completes and refresh results
  const prevJobStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevJobStatusRef.current;
    const curr = scrapeJob?.status;
    prevJobStatusRef.current = curr;
    if (prev !== 'completed' && curr === 'completed') {
      refetchSetlists();
      setShowArtistPage(true);
    }
  }, [scrapeJob?.status, refetchSetlists]);

  const handleArtistSelect = (artist: DiscoveryArtist) => {
    setSelectedArtist(artist);
    setQuery('');
    setActiveJobId(null);
    setShowScrapeModal(false);
    setScrapeError(null);
    setSelectedSetlist(null);
    setShowArtistPage(false);
  };

  const handleStartScrape = async () => {
    if (!selectedArtist || !accessToken) return;
    setScrapeStarting(true);
    setScrapeError(null);
    try {
      const response = await startArtistSetlistScrape(selectedArtist.id, accessToken);
      setActiveJobId(response.job_id);
      setShowScrapeModal(true);
    } catch (err: unknown) {
      setScrapeError(err instanceof Error ? err.message : 'Failed to start scrape');
    } finally {
      setScrapeStarting(false);
    }
  };

  const showSearchResults = query.trim().length >= 2;

  return (
    <div className="md:max-w-7xl md:mx-auto">
      {/* Scrape progress modal */}
      <DiscoveryScrapeProgressModal
        isOpen={showScrapeModal}
        onClose={() => setShowScrapeModal(false)}
        job={scrapeJob}
      />

      {/* Search input — always visible */}
      <div className="space-y-4 mb-8">
        <ArtistSearchInput
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          loading={searchLoading}
          placeholder={
            selectedArtist && showArtistPage
              ? `Search for a different artist…`
              : 'Search DropDex artists…'
          }
        />
        {showSearchResults && (
          <ArtistSearchResults
            results={searchResults}
            onSelect={handleArtistSelect}
            query={query.trim()}
          />
        )}
      </div>

      {/* Main content area */}
      {!showSearchResults && (
        <>
          {selectedArtist && showArtistPage ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ArtistPage
                artist={selectedArtist}
                setlists={setlists}
                total={total}
                loading={setlistsLoading}
                loadingMore={loadingMore}
                error={setlistsError}
                hasMore={hasMore}
                scrapeJob={scrapeJob}
                scrapeStarting={scrapeStarting}
                scrapeError={scrapeError}
                selectedSetlist={selectedSetlist}
                onSelectSetlist={(s) =>
                  setSelectedSetlist((prev) => (prev?.id === s.id ? null : s))
                }
                onRefresh={handleStartScrape}
                onViewProgress={() => setShowScrapeModal(true)}
                onLoadMore={loadMore}
              />
            </motion.div>
          ) : !selectedArtist ? (
            <div className="text-center py-20 space-y-2">
              <p className="text-sm text-muted-foreground">
                Search for an artist above to discover their setlists
              </p>
              <p className="text-xs text-muted-foreground opacity-60">
                Only artists in the DropDex catalog can be searched
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
