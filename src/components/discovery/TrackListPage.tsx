import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  RefreshCw,
  Loader2,
  Music2,
  Clock,
  Calendar,
  ListMusic,
  Timer,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { cn, formatPlaylistDuration } from '../../lib/utils';
import { useSetlistTracks } from '../../hooks/useSetlistTracks';
import { SetTrackRow } from './SetTrackRow';
import type { DiscoverySetlistResult } from '../../types';

interface TrackListPageProps {
  setlist: DiscoverySetlistResult;
  accessToken: string | null;
  onBack: () => void;
}

function ArtworkImage({ url, title }: { url: string; title: string }) {
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      <img
        src={url}
        alt={title}
        className="w-full h-full object-cover"
        onError={() => setErr(true)}
      />
    );
  }
  return <Music2 size={28} className="text-primary/20" />;
}

function SkeletonRow({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="w-14 shrink-0 flex justify-end">
        <div className="h-2.5 w-10 rounded bg-[var(--color-avatar-bg)] animate-pulse" />
      </div>
      <div className="flex-1 space-y-1.5">
        <div
          className={cn(
            'h-3 rounded bg-[var(--color-avatar-bg)] animate-pulse',
            wide ? 'w-3/4' : 'w-1/2',
          )}
        />
        <div className="h-2 w-1/3 rounded bg-[var(--color-avatar-bg)] animate-pulse opacity-60" />
      </div>
      <div className="w-10 h-2.5 rounded bg-[var(--color-avatar-bg)] animate-pulse opacity-40" />
      <div className="w-5 shrink-0" />
    </div>
  );
}

export function TrackListPage({ setlist, accessToken, onBack }: TrackListPageProps) {
  const { detail, loading, scraping, error, refresh, retry } = useSetlistTracks(
    setlist.id,
    accessToken,
  );

  // Header values — use detail when available, fall back to card data
  const headerTitle = detail?.setlist.title ?? setlist.title ?? 'Untitled Set';
  const headerArtwork = detail?.setlist.artwork_url ?? setlist.artwork_url;
  const headerDate = detail?.setlist.set_date ?? setlist.set_date;
  const headerDuration =
    setlist.duration_text ??
    (detail?.setlist.duration_seconds
      ? formatPlaylistDuration(detail.setlist.duration_seconds)
      : null);
  const isTimed = detail?.setlist.has_timed_cues === true;
  const status = detail?.setlist.detail_scrape_status;
  const scrapedAt = detail?.setlist.detail_scraped_at;
  const tracks = detail?.tracks ?? [];
  const hasTracks = tracks.length > 0;

  // Precompute display numbers for untimed mode (count only primary rows)
  let primaryCount = 0;
  const displayNumbers = tracks.map((t) => {
    if (!t.played_with_previous) {
      primaryCount++;
      return primaryCount;
    }
    return null;
  });

  // Column headers text
  const leftColLabel = isTimed ? 'Cue' : '#';

  const showSkeleton = loading || (scraping && !hasTracks);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4 md:max-w-5xl md:mx-auto"
    >
      {/* ── Page header card ──────────────────────────────────────────────── */}
      <div className="glass rounded-3xl border border-[var(--color-border-subtle)] overflow-hidden">
        {/* Back nav */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border-faint)]">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={15} />
            Back to Artist
          </button>
        </div>

        {/* Set identity */}
        <div className="px-5 py-5 flex gap-4">
          {/* Artwork */}
          <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-[var(--color-avatar-bg)] flex items-center justify-center">
            {headerArtwork ? (
              <ArtworkImage url={headerArtwork} title={headerTitle} />
            ) : (
              <Music2 size={28} className="text-primary/20" />
            )}
          </div>

          {/* Metadata */}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-black leading-snug line-clamp-2">{headerTitle}</h1>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
              {headerDate && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar size={9} />
                  {headerDate}
                </span>
              )}
              {headerDuration && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock size={9} />
                  {headerDuration}
                </span>
              )}
              {hasTracks && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ListMusic size={9} />
                  {tracks.length} tracks
                </span>
              )}
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {detail && (
                <span
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border',
                    isTimed
                      ? 'bg-primary/10 text-primary border-primary/20'
                      : 'bg-[var(--color-surface)] text-muted-foreground border-[var(--color-border-subtle)]',
                  )}
                >
                  <Timer size={8} />
                  {isTimed ? 'Timed Tracklist' : 'Track Order Only'}
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-[var(--color-surface)] text-muted-foreground border border-[var(--color-border-subtle)]">
                1001Tracklists
              </span>
            </div>

            {/* Last scraped time */}
            {scrapedAt && (
              <p className="text-[9px] text-muted-foreground mt-2 font-mono">
                Updated {new Date(scrapedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Refresh action */}
        <div className="px-5 pb-4 flex justify-end">
          <button
            onClick={refresh}
            disabled={scraping || loading}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95',
              scraping || loading
                ? 'bg-[var(--color-surface)] text-muted-foreground cursor-not-allowed opacity-50'
                : 'bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-foreground hover:bg-[var(--color-surface-hover)]',
            )}
          >
            {scraping && hasTracks ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Refreshing…
              </>
            ) : (
              <>
                <RefreshCw size={12} />
                Refresh Tracklist
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Scraping / loading skeleton ──────────────────────────────────── */}
      {showSkeleton && (
        <div className="glass rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border-faint)] flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              {loading ? 'Loading tracks…' : 'Extracting tracks from this set…'}
            </span>
          </div>
          <div className="divide-y divide-[var(--color-border-faint)]">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} wide={i % 3 !== 2} />
            ))}
          </div>
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {error && !loading && !showSkeleton && (
        <div className="glass rounded-2xl border border-red-500/20 p-6 space-y-3">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <p className="text-sm font-bold">Scrape Failed</p>
          </div>
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">{error}</p>
          {hasTracks && (
            <p className="text-xs text-muted-foreground">
              Previously saved tracks are shown below.
            </p>
          )}
          <button
            onClick={retry}
            disabled={scraping}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw size={12} />
            Retry Scrape
          </button>
        </div>
      )}

      {/* ── Track list ────────────────────────────────────────────────────── */}
      {hasTracks && !showSkeleton && (
        <div className="glass rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-faint)]">
            <div className="w-14 shrink-0 text-right">
              <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {leftColLabel}
              </span>
            </div>
            <div className="flex-1">
              <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Track
              </span>
            </div>
            <span className="shrink-0 w-10 text-right text-[8px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Dur
            </span>
            <div className="w-5 shrink-0" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-[var(--color-border-faint)] py-1">
            {tracks.map((track, i) => (
              <SetTrackRow
                key={track.id}
                track={track}
                isTimedSet={isTimed}
                displayNumber={displayNumbers[i]}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state (scrape completed, zero tracks returned) ──────────── */}
      {!loading && !scraping && !error && !hasTracks && status === 'completed' && (
        <div className="glass rounded-2xl border-2 border-dashed border-[var(--color-border-subtle)] p-12 text-center space-y-3">
          <ListMusic size={32} className="mx-auto text-muted-foreground opacity-25" />
          <div>
            <p className="text-sm font-bold text-muted-foreground">No tracks extracted</p>
            <p className="text-xs text-muted-foreground mt-1 opacity-70">
              No individual track rows could be parsed from this setlist page.
              The source page may not list individual tracks.
            </p>
          </div>
          <button
            onClick={retry}
            className="mx-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-[var(--color-surface)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-all"
          >
            <RefreshCw size={12} />
            Try Again
          </button>
        </div>
      )}

      {/* ── Failed state without tracks ───────────────────────────────────── */}
      {!loading && !scraping && !error && !hasTracks && status === 'failed' && (
        <div className="glass rounded-2xl border border-red-500/20 p-8 text-center space-y-3">
          <AlertTriangle size={28} className="mx-auto text-red-400 opacity-60" />
          <div>
            <p className="text-sm font-bold text-red-400">Previous scrape failed</p>
            <p className="text-xs text-muted-foreground mt-1">
              {detail?.setlist.detail_scrape_error ?? 'An error occurred during scraping.'}
            </p>
          </div>
          <button
            onClick={retry}
            disabled={scraping}
            className="mx-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
          >
            <RotateCcw size={12} />
            Retry Scrape
          </button>
        </div>
      )}
    </motion.div>
  );
}
