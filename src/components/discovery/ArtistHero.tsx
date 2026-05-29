import { useState } from 'react';
import { User, RefreshCw, Loader2, Activity, Search, ExternalLink } from 'lucide-react';
import { MusicNote01Icon } from 'hugeicons-react';
import { cn } from '../../lib/utils';
import { formatRelativeTime } from '../../lib/utils';
import type { DiscoveryArtist, DiscoveryArtistDetail, DiscoveryScrapeJob } from '../../types';

interface ArtistHeroProps {
  artist: DiscoveryArtist;
  artistDetail: DiscoveryArtistDetail | null;
  detailLoading: boolean;
  scrapeJob: DiscoveryScrapeJob | null;
  scrapeStarting: boolean;
  onRefresh: () => void;
  onViewProgress: () => void;
  hasSetlists: boolean;
}

export function ArtistHero({
  artist,
  artistDetail,
  detailLoading,
  scrapeJob,
  scrapeStarting,
  onRefresh,
  onViewProgress,
  hasSetlists,
}: ArtistHeroProps) {
  const [imgError, setImgError] = useState(false);
  const isJobActive = scrapeJob?.status === 'queued' || scrapeJob?.status === 'running';
  const initials = artist.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const imageUrl = artistDetail?.profile_image_url ?? artist.profile_image_url;
  const genres = artistDetail?.genres ?? [];
  const setlistCount = artistDetail?.stored_setlist_count ?? null;
  const trackCount = artistDetail?.stored_track_count ?? null;
  const sourceUrl = artistDetail?.source_artist_url ?? null;
  const updatedAt = artistDetail?.updated_at ?? null;

  return (
    <div className="glass rounded-3xl p-6 md:p-8 border border-[var(--color-border-subtle)] relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

      {/* Refresh / Find button — top right */}
      <div className="absolute top-4 right-4 sm:top-5 sm:right-5 z-10">
        <button
          onClick={isJobActive ? onViewProgress : onRefresh}
          disabled={scrapeStarting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 shadow-sm',
            scrapeStarting
              ? 'bg-[var(--color-surface)] text-muted-foreground cursor-not-allowed'
              : isJobActive
              ? 'bg-secondary/10 text-secondary border border-secondary/25 hover:bg-secondary/20'
              : hasSetlists
              ? 'bg-[var(--color-surface)] text-foreground border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]'
              : 'bg-primary text-white hover:bg-primary/90',
          )}
        >
          {scrapeStarting ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              Starting…
            </>
          ) : isJobActive ? (
            <>
              <Activity size={11} className="animate-pulse" />
              View Progress
            </>
          ) : hasSetlists ? (
            <>
              <RefreshCw size={11} />
              Refresh Results
            </>
          ) : (
            <>
              <Search size={11} />
              Retry Search
            </>
          )}
        </button>
      </div>

      <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-6">
        {/* Artist image */}
        <div className="shrink-0">
          {imageUrl && !imgError ? (
            <img
              src={imageUrl}
              alt={artist.name}
              className="w-24 h-24 md:w-32 md:h-32 rounded-full object-cover ring-4 ring-primary/25 shadow-xl"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-primary/10 ring-4 ring-primary/25 shadow-xl flex items-center justify-center">
              {initials ? (
                <span className="text-2xl md:text-3xl font-black text-primary">{initials}</span>
              ) : (
                <User size={40} className="text-primary/60" />
              )}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 text-center sm:text-left pr-24 sm:pr-28">
          <p className="text-[8px] uppercase tracking-[0.25em] text-muted-foreground mb-0.5">Artist</p>
          <h1 className="text-3xl md:text-4xl font-black leading-tight">{artist.name}</h1>

          {/* Genre badges — canonical from artist_genres, skeleton while loading */}
          <div className="flex flex-wrap gap-1.5 mt-3 justify-center sm:justify-start min-h-[26px]">
            {detailLoading ? (
              <>
                {[48, 56, 44].map((w) => (
                  <span
                    key={w}
                    className="h-[26px] rounded-full bg-primary/10 animate-pulse"
                    style={{ width: w }}
                  />
                ))}
              </>
            ) : genres.length > 0 ? (
              genres.map((g) => (
                <span
                  key={g.id}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest bg-primary/10 text-primary border border-primary/15"
                >
                  <MusicNote01Icon size={9} className="shrink-0" />
                  {g.name}
                </span>
              ))
            ) : null}
          </div>

          {/* Stats row */}
          {!detailLoading && artistDetail && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 justify-center sm:justify-start text-[10px] text-muted-foreground">
              {setlistCount !== null && (
                <span className="font-semibold">
                  <span className="text-foreground">{setlistCount.toLocaleString()}</span>{' '}
                  {setlistCount === 1 ? 'Setlist' : 'Setlists'}
                </span>
              )}
              {trackCount !== null && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="font-semibold">
                    <span className="text-foreground">{trackCount.toLocaleString()}</span> Tracks
                  </span>
                </>
              )}
              {sourceUrl && (
                <>
                  <span className="opacity-30">·</span>
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-primary hover:underline font-semibold"
                  >
                    1001Tracklists
                    <ExternalLink size={9} className="ml-0.5" />
                  </a>
                </>
              )}
              {updatedAt && (
                <>
                  <span className="opacity-30">·</span>
                  <span>Updated {formatRelativeTime(updatedAt)}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
