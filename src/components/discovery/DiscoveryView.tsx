import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { User, Loader2, RefreshCw, Search, Layers, Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useArtistDiscoverySearch } from '../../hooks/useArtistDiscoverySearch';
import { useArtistSetlists } from '../../hooks/useArtistSetlists';
import { useDiscoveryScrapeJob } from '../../hooks/useDiscoveryScrapeJob';
import { startArtistSetlistScrape } from '../../lib/api/discovery';
import { ArtistSearchInput } from './ArtistSearchInput';
import { ArtistSearchResults } from './ArtistSearchResults';
import { DiscoveryScrapeProgressModal } from './DiscoveryScrapeProgressModal';
import { ArtistSetlistResults } from './ArtistSetlistResults';
import type { DiscoveryArtist, DiscoverySetlistResult } from '../../types';

interface DiscoveryViewProps {
  accessToken: string | null;
}

function SelectedArtistThumb({ artist }: { artist: DiscoveryArtist }) {
  const [imgError, setImgError] = useState(false);
  if (artist.profile_image_url && !imgError) {
    return (
      <img
        src={artist.profile_image_url}
        alt={artist.name}
        className="w-10 h-10 rounded-xl object-cover bg-primary/10 shrink-0"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
      <User size={18} className="text-primary" />
    </div>
  );
}

export function DiscoveryView({ accessToken }: DiscoveryViewProps) {
  const [query, setQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<DiscoveryArtist | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showScrapeModal, setShowScrapeModal] = useState(false);
  const [selectedSetlist, setSelectedSetlist] = useState<DiscoverySetlistResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeStarting, setScrapeStarting] = useState(false);

  const { results: searchResults, loading: searchLoading } = useArtistDiscoverySearch(
    query,
    accessToken,
  );
  const {
    setlists,
    total,
    loading: setlistsLoading,
    error: setlistsError,
    refetch: refetchSetlists,
  } = useArtistSetlists(selectedArtist?.id ?? null, accessToken);
  const { job: scrapeJob } = useDiscoveryScrapeJob(activeJobId, accessToken);

  // Refresh setlists once when scrape status transitions to completed
  const prevJobStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevJobStatusRef.current;
    const curr = scrapeJob?.status;
    prevJobStatusRef.current = curr;
    if (prev !== 'completed' && curr === 'completed') {
      refetchSetlists();
    }
  }, [scrapeJob?.status, refetchSetlists]);

  const handleArtistSelect = (artist: DiscoveryArtist) => {
    setSelectedArtist(artist);
    setQuery('');
    setActiveJobId(null);
    setShowScrapeModal(false);
    setScrapeError(null);
    setSelectedSetlist(null);
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
  const isJobActive = scrapeJob?.status === 'queued' || scrapeJob?.status === 'running';
  const hasSetlists = setlists.length > 0;

  return (
    <div className="space-y-8 md:max-w-5xl md:mx-auto">
      {/* Scrape progress modal */}
      <DiscoveryScrapeProgressModal
        isOpen={showScrapeModal}
        onClose={() => setShowScrapeModal(false)}
        job={scrapeJob}
      />

      {/* Artist search input */}
      <div className="space-y-4">
        <ArtistSearchInput
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          loading={searchLoading}
        />
        {showSearchResults && (
          <ArtistSearchResults
            results={searchResults}
            onSelect={handleArtistSelect}
            query={query.trim()}
          />
        )}
      </div>

      {/* Selected artist card */}
      {selectedArtist && !showSearchResults && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-5 rounded-2xl border-l-4 border-l-primary"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <SelectedArtistThumb artist={selectedArtist} />
              <div className="min-w-0">
                <p className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
                  Selected Artist
                </p>
                <h3 className="font-black text-lg leading-tight truncate">{selectedArtist.name}</h3>
              </div>
            </div>

            <button
              onClick={isJobActive ? () => setShowScrapeModal(true) : handleStartScrape}
              disabled={scrapeStarting}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 shrink-0',
                scrapeStarting
                  ? 'bg-[var(--color-surface)] text-muted-foreground cursor-not-allowed'
                  : isJobActive
                  ? 'bg-secondary/10 text-secondary hover:bg-secondary/20'
                  : hasSetlists
                  ? 'bg-secondary/10 text-secondary hover:bg-secondary/20'
                  : 'bg-primary text-white hover:bg-primary/90',
              )}
            >
              {scrapeStarting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Starting…
                </>
              ) : isJobActive ? (
                <>
                  <Activity size={14} className="animate-pulse" />
                  View Progress
                </>
              ) : hasSetlists ? (
                <>
                  <RefreshCw size={14} />
                  Refresh Results
                </>
              ) : (
                <>
                  <Search size={14} />
                  Find Setlists
                </>
              )}
            </button>
          </div>

          {scrapeError && (
            <p className="text-xs text-red-400 mt-3 font-mono">{scrapeError}</p>
          )}
        </motion.div>
      )}

      {/* Setlists grid */}
      {selectedArtist && !showSearchResults && (
        <ArtistSetlistResults
          setlists={setlists}
          total={total}
          loading={setlistsLoading}
          error={setlistsError}
          selectedSetlist={selectedSetlist}
          onSelectSetlist={(s) =>
            setSelectedSetlist((prev) => (prev?.id === s.id ? null : s))
          }
        />
      )}

      {/* Selected setlist preview */}
      {selectedSetlist && !showSearchResults && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-5 rounded-2xl border-l-4 border-l-secondary space-y-3"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[8px] uppercase tracking-[0.2em] text-secondary mb-0.5">
                Selected Set
              </p>
              <h3 className="font-bold text-base leading-snug line-clamp-2">
                {selectedSetlist.title ?? 'Untitled Set'}
              </h3>
              {selectedSetlist.set_date && (
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {selectedSetlist.set_date}
                </p>
              )}
            </div>
            <button
              onClick={() => setSelectedSetlist(null)}
              className="text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
            >
              Deselect
            </button>
          </div>

          <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-avatar-bg)] rounded-xl border border-dashed border-[var(--color-border-subtle)]">
            <Layers size={16} className="text-secondary shrink-0" />
            <div>
              <p className="text-xs font-bold text-secondary">Track Extraction — Coming Next</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                Individual track scraping from this setlist will be available in the next phase.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
