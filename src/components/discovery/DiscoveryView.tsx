import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useArtistDiscoverySearch } from '../../hooks/useArtistDiscoverySearch';
import { useArtistDetail } from '../../hooks/useArtistDetail';
import { useArtistSetlists } from '../../hooks/useArtistSetlists';
import { useDiscoveryScrapeJob } from '../../hooks/useDiscoveryScrapeJob';
import { startArtistSetlistScrape } from '../../lib/api/discovery';
import { isAbortError } from '../../lib/api/responseValidation';
import { ArtistSearchInput } from './ArtistSearchInput';
import { ArtistSearchResults } from './ArtistSearchResults';
import { DiscoveryScrapeProgressModal } from './DiscoveryScrapeProgressModal';
import { ArtistPage } from './ArtistPage';
import { TrackListPage } from './TrackListPage';
import { DiscoveryHomeFeed } from './DiscoveryHomeFeed';
import type { DiscoveryArtist, DiscoverySetlistResult } from '../../types';

interface DiscoveryViewProps {
  accessToken: string | null;
}

export function DiscoveryView({ accessToken }: DiscoveryViewProps) {
  const [query, setQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<DiscoveryArtist | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showScrapeModal, setShowScrapeModal] = useState(false);
  const [selectedSetlistForDetail, setSelectedSetlistForDetail] =
    useState<DiscoverySetlistResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeStarting, setScrapeStarting] = useState(false);
  const [showArtistPage, setShowArtistPage] = useState(false);
  const scrapeStartControllerRef = useRef<AbortController | null>(null);
  const scrapeStartGenerationRef = useRef(0);

  const {
    results: searchResults,
    loading: searchLoading,
    error: searchError,
  } = useArtistDiscoverySearch(
    query,
    accessToken,
  );
  const {
    setlists,
    total,
    loading: setlistsLoading,
    loadingMore,
    error: setlistsError,
    loadMoreError,
    refetch: refetchSetlists,
    loadMore,
    hasMore,
  } = useArtistSetlists(selectedArtist?.id ?? null, accessToken);
  const { job: scrapeJob, error: scrapePollingError } = useDiscoveryScrapeJob(
    activeJobId,
    accessToken,
  );
  const { detail: artistDetail, loading: detailLoading } = useArtistDetail(
    selectedArtist?.id ?? null,
    accessToken,
  );


  useEffect(() => () => scrapeStartControllerRef.current?.abort(), []);

  const beginScrapeStart = () => {
    scrapeStartControllerRef.current?.abort();
    const controller = new AbortController();
    scrapeStartControllerRef.current = controller;
    const generation = ++scrapeStartGenerationRef.current;
    return { controller, generation };
  };

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

  const handleArtistSelect = async (artist: DiscoveryArtist) => {
    setSelectedArtist(artist);
    setQuery('');
    setActiveJobId(null);
    setShowScrapeModal(false);
    setScrapeError(null);
    setSelectedSetlistForDetail(null);
    setShowArtistPage(false);

    if (!accessToken) return;

    // Auto-start scrape immediately on artist selection using the artist
    // argument directly — selectedArtist state update hasn't propagated yet.
    const { controller, generation } = beginScrapeStart();
    setScrapeStarting(true);
    try {
      const response = await startArtistSetlistScrape(artist.id, accessToken, controller.signal);
      if (generation !== scrapeStartGenerationRef.current) return;
      setActiveJobId(response.job_id);
      setShowScrapeModal(true);
    } catch (err: unknown) {
      if (generation !== scrapeStartGenerationRef.current || isAbortError(err)) return;
      setScrapeError(err instanceof Error ? err.message : 'Failed to start scrape');
    } finally {
      if (generation === scrapeStartGenerationRef.current) setScrapeStarting(false);
    }
  };

  const handleStartScrape = async () => {
    if (!selectedArtist || !accessToken) return;
    const artistId = selectedArtist.id;
    const { controller, generation } = beginScrapeStart();
    setScrapeStarting(true);
    setScrapeError(null);
    try {
      const response = await startArtistSetlistScrape(artistId, accessToken, controller.signal);
      if (generation !== scrapeStartGenerationRef.current) return;
      setActiveJobId(response.job_id);
      setShowScrapeModal(true);
    } catch (err: unknown) {
      if (generation !== scrapeStartGenerationRef.current || isAbortError(err)) return;
      setScrapeError(err instanceof Error ? err.message : 'Failed to start scrape');
    } finally {
      if (generation === scrapeStartGenerationRef.current) setScrapeStarting(false);
    }
  };

  const handleOpenSetlist = (setlist: DiscoverySetlistResult) => {
    setSelectedSetlistForDetail(setlist);
  };

  const handleBackFromTrackList = () => {
    setSelectedSetlistForDetail(null);
  };

  const showSearchResults = query.trim().length >= 2;

  return (
    <div className="md:max-w-7xl md:mx-auto">
      {/* Scrape progress modal */}
      <DiscoveryScrapeProgressModal
        isOpen={showScrapeModal}
        onClose={() => setShowScrapeModal(false)}
        job={scrapeJob}
        pollingError={scrapePollingError}
      />

      {/* Search input — hidden while viewing a set's track list */}
      {!selectedSetlistForDetail && (
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
          {searchError && showSearchResults && (
            <p className="text-xs text-red-400 font-mono px-1">{searchError}</p>
          )}
          {showSearchResults && (
            <ArtistSearchResults
              results={searchResults}
              onSelect={handleArtistSelect}
              query={query.trim()}
            />
          )}
        </div>
      )}

      {/* Main content area */}
      {selectedSetlistForDetail ? (
        <TrackListPage
          setlist={selectedSetlistForDetail}
          accessToken={accessToken}
          onBack={handleBackFromTrackList}
        />
      ) : !showSearchResults ? (
        <>
          {selectedArtist && showArtistPage ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ArtistPage
                artist={selectedArtist}
                artistDetail={artistDetail}
                detailLoading={detailLoading}
                setlists={setlists}
                total={total}
                loading={setlistsLoading}
                loadingMore={loadingMore}
                error={setlistsError}
                loadMoreError={loadMoreError}
                hasMore={hasMore}
                scrapeJob={scrapeJob}
                scrapeStarting={scrapeStarting}
                scrapeError={scrapeError}
                onOpenSetlist={handleOpenSetlist}
                onRefresh={handleStartScrape}
                onViewProgress={() => setShowScrapeModal(true)}
                onLoadMore={loadMore}
              />
            </motion.div>
          ) : !selectedArtist ? (
            <DiscoveryHomeFeed
              onSelectArtist={handleArtistSelect}
              onOpenSetlist={handleOpenSetlist}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
