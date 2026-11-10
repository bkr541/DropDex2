import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import '../ui/studio.css';
import './DiscoveryView.css';
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
import { DiscoveryHero } from './DiscoveryHero';
import { GenreBrowser } from './GenreBrowser';
import { GenreArtistGrid } from './GenreArtistGrid';
import { useCatalogGenres } from '../../hooks/useCatalogGenres';
import { useDiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import { useDiscoveryForYou } from '../../hooks/useDiscoveryForYou';
import type { DiscoveryArtist, DiscoverySetlistResult } from '../../types';

interface DiscoveryViewProps {
  accessToken: string | null;
  /** The signed-in user, whose favorite artists and genres shape the personal rows. */
  userId?: string | null;
  /** Opens the profile so the user can pick favorites. */
  onEditTaste?: () => void;
}

export function DiscoveryView({ accessToken, userId = null, onEditTaste }: DiscoveryViewProps) {
  const [query, setQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<DiscoveryArtist | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showScrapeModal, setShowScrapeModal] = useState(false);
  const [selectedSetlistForDetail, setSelectedSetlistForDetail] =
    useState<DiscoverySetlistResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeStarting, setScrapeStarting] = useState(false);
  const [showArtistPage, setShowArtistPage] = useState(false);
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(null);
  // The genre list an artist was opened from, so Back returns to it.
  const [genreBeforeArtist, setGenreBeforeArtist] = useState<string | null>(null);
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
  const feed = useDiscoveryFeed();
  const feedSetCount = feed.artists.reduce((total, artist) => total + artist.setlist_count, 0);
  const { genres: catalogGenres, loading: genresLoading, error: genresError, retry: retryGenres } = useCatalogGenres();
  const forYou = useDiscoveryForYou(userId, catalogGenres);
  const selectedGenre = catalogGenres.find((genre) => genre.id === selectedGenreId) ?? null;
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
    setGenreBeforeArtist(selectedGenreId);
    setSelectedGenreId(null);
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

  const handleBackFromArtist = () => {
    // Ignore a scrape that is still starting for this artist, then return to where they were picked from.
    scrapeStartControllerRef.current?.abort();
    scrapeStartGenerationRef.current += 1;
    setScrapeStarting(false);
    setSelectedArtist(null);
    setShowArtistPage(false);
    setActiveJobId(null);
    setShowScrapeModal(false);
    setScrapeError(null);
    setSelectedGenreId(genreBeforeArtist);
    setGenreBeforeArtist(null);
  };

  const handleOpenSetlist = (setlist: DiscoverySetlistResult) => {
    setSelectedSetlistForDetail(setlist);
  };

  const handleBackFromTrackList = () => {
    setSelectedSetlistForDetail(null);
  };

  const showSearchResults = query.trim().length >= 2;
  const showHomeFeed = !showSearchResults && !selectedGenre && !selectedArtist;

  return (
    <div className="studio discovery-studio min-w-0" data-testid="discovery-view">
      {/* Scrape progress modal */}
      <DiscoveryScrapeProgressModal
        isOpen={showScrapeModal}
        onClose={() => setShowScrapeModal(false)}
        job={scrapeJob}
        pollingError={scrapePollingError}
      />

      {!selectedSetlistForDetail && (
        <header className="studio-band discovery-header" data-testid="discovery-header">
          <div className="studio-stats" data-testid="discovery-stats">
            <div className="studio-stat"><span>{genresLoading ? '—' : catalogGenres.length.toLocaleString()}</span><small>Genres</small></div>
            <div className="studio-stat"><span>{feed.loading ? '—' : feed.artists.length.toLocaleString()}</span><small>Top artists</small></div>
            <div className="studio-stat"><span>{feed.loading ? '—' : feedSetCount.toLocaleString()}</span><small>Sets</small></div>
          </div>
        </header>
      )}

      <div className="studio-body scrollbar-none" data-testid="discovery-body">
        {!selectedSetlistForDetail && (
          <>
            {showHomeFeed && (
              <DiscoveryHero feed={feed} forYou={forYou} genres={catalogGenres}
                onSelectArtist={handleArtistSelect} onOpenSetlist={handleOpenSetlist} />
            )}
            <div className="discovery-filters" data-testid="discovery-filters" role="group" aria-label="Discovery search and filters">
              <ArtistSearchInput
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
                loading={searchLoading}
                placeholder={selectedArtist && showArtistPage ? 'Search for a different artist…' : 'Search DropDex artists…'}
              />
              <GenreBrowser
                genres={catalogGenres}
                loading={genresLoading}
                error={genresError}
                onRetry={retryGenres}
                selectedGenreId={selectedGenreId}
                onSelectGenre={(genreId) => {
                  setSelectedGenreId(genreId);
                  if (genreId) setQuery('');
                }}
              />
            </div>
          </>
        )}
        {selectedSetlistForDetail ? (
          <div className="p-4">
            <TrackListPage
              setlist={selectedSetlistForDetail}
              accessToken={accessToken}
              onBack={handleBackFromTrackList}
            />
          </div>
        ) : showSearchResults ? (
          <>
            {searchError && (
              <p className="px-4 pt-3 text-xs text-red-300" role="alert">{searchError}</p>
            )}
            <ArtistSearchResults
              results={searchResults}
              onSelect={handleArtistSelect}
              query={query.trim()}
            />
          </>
        ) : selectedGenre ? (
          <GenreArtistGrid
            key={selectedGenre.id}
            genreId={selectedGenre.id}
            genreName={selectedGenre.name}
            onSelectArtist={handleArtistSelect}
          />
        ) : selectedArtist && showArtistPage ? (
          <motion.div
            className="p-4"
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
              onBack={handleBackFromArtist}
            />
          </motion.div>
        ) : showHomeFeed ? (
          <DiscoveryHomeFeed
            feed={feed}
            forYou={forYou}
            genres={catalogGenres}
            onSelectArtist={handleArtistSelect}
            onOpenSetlist={handleOpenSetlist}
            onSelectGenre={setSelectedGenreId}
            onEditTaste={onEditTaste}
          />
        ) : null}
      </div>
    </div>
  );
}
