import { useState, useMemo, memo, useCallback } from 'react';
import {
  Search,
  Loader2,
  Disc3,
  FileUp,
  ListMusic,
  Tag,
  BarChart2,
  ChevronRight,
  Music,
  FolderOpen,
  ArrowUpRight,
  AlertTriangle,
  RefreshCw,
  Play,
  Pause,
  Usb,
} from 'lucide-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';

const GENRE_BADGE_STYLES = [
  'bg-foreground text-primary border-foreground',
  'bg-foreground text-secondary border-foreground',
  'bg-foreground text-emerald-400 border-foreground',
  'bg-foreground text-amber-400 border-foreground',
  'bg-foreground text-sky-400 border-foreground',
  'bg-foreground text-violet-400 border-foreground',
  'bg-foreground text-rose-400 border-foreground',
  'bg-foreground text-teal-400 border-foreground',
];
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatKey } from '../../lib/utils';
import { useRekordboxSearch, useTrackStats } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import { LibraryHero } from './LibraryHero';
import { PlaylistOverviewCard } from './PlaylistOverviewCard';
import { RecentlyAddedTracksTable } from './RecentlyAddedTracksTable';
import { LibrarySearchResults } from './LibrarySearchResults';
import type {
  RekordboxImport,
  RekordboxTrack,
  UserPlaylistProfile,
  UserProfile,
  UserGenrePreference,
} from '../../types';
import type { TrackPreviewWaveform } from '../../lib/queries/waveformValidation';
import { trackStatRowToTrack } from '../../lib/queries/rekordbox';
import type { PlaylistWithCount, TrackStatRow } from '../../lib/queries/rekordbox';

type LibraryTab = 'overview' | 'playlists' | 'recently-added' | 'tracks' | 'genres' | 'artists';

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'recently-added', label: 'Recently Added' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'genres', label: 'Genres' },
  { id: 'artists', label: 'Artists' },
];

interface LibraryViewProps {
  latestImport: RekordboxImport | null;
  importLoading: boolean;
  importError: string | null;
  playlists: PlaylistWithCount[];
  playlistsLoading: boolean;
  playlistProfilesByRbId: Map<string, UserPlaylistProfile>;
  recentTracks: RekordboxTrack[];
  recentTracksLoading: boolean;
  importId: string | null;
  profile: UserProfile | null;
  genres: UserGenrePreference[];
  onPlaylistClick: (p: PlaylistWithCount) => void;
  onEditPlaylist: (p: PlaylistWithCount) => void;
  onTrackClick: (t: RekordboxTrack) => void;
  onImport: () => void;
  onEditProfile: () => void;
  onResumeAnalysis?: (importId: string) => void;
}

function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center">
        <Disc3 size={40} className="text-primary/50" />
      </div>
      <h2 className="text-xl font-black">No Library Imported Yet</h2>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        Connect your rekordbox USB drive, then import your library to get started.
      </p>
      <button
        onClick={onImport}
        className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 hover:bg-primary/90"
      >
        <FileUp size={16} />
        Import Library
      </button>
      <p className="text-[10px] text-muted-foreground max-w-xs leading-relaxed">
        Select <code className="font-mono">exportLibrary.db</code> from{' '}
        <code className="font-mono">PIONEER/rekordbox</code> on your USB drive.
      </p>
    </div>
  );
}

// ── Memoized track row ────────────────────────────────────────────────────────

interface TrackRowProps {
  track: TrackStatRow;
  waveform: TrackPreviewWaveform | null;
  waveformUnavailable: boolean;
  waveformLoading: boolean;
  isActiveTrack: boolean;
  playerStatus: string;
  usbConnected: boolean;
  onOpen: (t: RekordboxTrack) => void;
  onPlay: (t: TrackStatRow, e: React.MouseEvent | React.KeyboardEvent) => void;
}

const TrackRow = memo(function TrackRow({
  track: t,
  waveform,
  waveformUnavailable,
  waveformLoading,
  isActiveTrack,
  playerStatus,
  usbConnected,
  onOpen,
  onPlay,
}: TrackRowProps) {
  const handleRowClick = useCallback(() => onOpen(trackStatRowToTrack(t)), [onOpen, t]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(trackStatRowToTrack(t));
      }
    },
    [onOpen, t],
  );
  const handlePlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onPlay(t, e);
    },
    [onPlay, t],
  );
  const handlePlayKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.stopPropagation();
        e.preventDefault();
        onPlay(t, e);
      }
    },
    [onPlay, t],
  );

  const isPlaying = isActiveTrack && playerStatus === 'playing';
  const isLoadingThis = isActiveTrack && (playerStatus === 'resolving' || playerStatus === 'loading');
  const isActiveRow = isActiveTrack && (playerStatus === 'playing' || playerStatus === 'paused' || playerStatus === 'ended');

  // Live progress for this track — undefined for all inactive rows (no RAF started).
  const progress = useWaveformProgress(t.id);
  const { seek, getAudioElement } = useAudioPlayer();

  // Seek is only available when this track is playing or paused with valid duration.
  const canSeek = isActiveTrack && (playerStatus === 'playing' || playerStatus === 'paused');
  const handleWaveformSeek = useCallback(
    (fraction: number) => {
      const audio = getAudioElement();
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
      seek(fraction * audio.duration);
    },
    [seek, getAudioElement],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${t.title}${t.artist ? ` by ${t.artist}` : ''}`}
      className={cn(
        'group w-full px-4 py-2.5 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset',
        isActiveRow && 'border-l-2 border-l-primary bg-primary/5 hover:bg-primary/10',
      )}
    >
      {/* ── Desktop grid (6 columns: play | identity | BPM | Key | Genre | Date) ── */}
      <div className="hidden sm:grid grid-cols-[36px_1fr_56px_56px_88px_88px] items-center gap-x-2">
        {/* Play button */}
        <div className="flex items-center justify-center">
          <button
            onClick={handlePlayClick}
            onKeyDown={handlePlayKeyDown}
            aria-label={isPlaying ? `Pause ${t.title}` : `Play ${t.title}`}
            disabled={!usbConnected && !isActiveTrack}
            title={!usbConnected && !isActiveTrack ? 'Connect a USB drive to play' : undefined}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              isActiveRow && 'opacity-100',
              isLoadingThis && 'opacity-100 cursor-wait',
              !usbConnected && !isActiveTrack
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : isPlaying
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-[var(--color-surface)] text-foreground hover:bg-primary hover:text-white',
            )}
          >
            {isLoadingThis ? (
              <Loader2 size={13} className="animate-spin" />
            ) : !usbConnected && !isActiveTrack ? (
              <Usb size={12} />
            ) : isPlaying ? (
              <Pause size={13} />
            ) : (
              <Play size={13} />
            )}
          </button>
        </div>

        {/* Identity: title + artist + waveform */}
        <div className="min-w-0 pr-2">
          <p className={cn(
            'text-sm font-semibold truncate transition-colors leading-tight',
            isActiveRow ? 'text-primary' : 'group-hover:text-primary',
          )}>
            {t.title}
          </p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5 leading-tight">
            {t.artist ?? '—'}
          </p>
          <div className="mt-1.5">
            <RekordboxPreviewWaveform
              waveform={waveform}
              height={22}
              loading={waveformLoading}
              unavailable={waveformUnavailable}
              activeProgress={progress}
              onSeek={canSeek ? handleWaveformSeek : undefined}
              ariaLabel=""
            />
          </div>
        </div>
        {/* BPM */}
        <p className="text-xs font-mono text-primary text-center tabular-nums">
          {t.bpm != null ? t.bpm.toFixed(1) : '—'}
        </p>
        {/* Key */}
        <p className="text-xs font-mono text-secondary text-center">
          {formatKey(t.musical_key)}
        </p>
        {/* Genre */}
        <p className="text-[10px] text-muted-foreground truncate">{t.genre ?? '—'}</p>
        {/* Date */}
        <p className="text-[10px] text-muted-foreground text-right tabular-nums">
          {t.date_added?.slice(0, 10) ?? '—'}
        </p>
      </div>

      {/* ── Mobile layout ── */}
      <div className="sm:hidden">
        <div className="flex items-start gap-2">
          {/* Mobile play button */}
          <button
            onClick={handlePlayClick}
            onKeyDown={handlePlayKeyDown}
            aria-label={isPlaying ? `Pause ${t.title}` : `Play ${t.title}`}
            disabled={!usbConnected && !isActiveTrack}
            className={cn(
              'mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all',
              !usbConnected && !isActiveTrack
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : isPlaying
                ? 'bg-primary text-white'
                : 'bg-[var(--color-surface)] text-foreground hover:bg-primary hover:text-white',
            )}
          >
            {isLoadingThis ? (
              <Loader2 size={11} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={11} />
            ) : (
              <Play size={11} />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-semibold truncate transition-colors leading-tight',
              isActiveRow ? 'text-primary' : 'group-hover:text-primary',
            )}>
              {t.title}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-[11px] text-muted-foreground truncate flex-1 leading-tight">
                {t.artist ?? '—'}
              </p>
              {t.bpm != null && (
                <p className="text-[10px] font-mono text-primary shrink-0 tabular-nums">
                  {t.bpm.toFixed(1)}
                </p>
              )}
              <p className="text-[10px] font-mono text-secondary shrink-0">
                {formatKey(t.musical_key)}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-1.5">
          <RekordboxPreviewWaveform
            waveform={waveform}
            height={20}
            loading={waveformLoading}
            unavailable={waveformUnavailable}
            activeProgress={progress}
            onSeek={canSeek ? handleWaveformSeek : undefined}
            ariaLabel=""
          />
        </div>
      </div>
    </div>
  );
});

// ── Sidebar sections ──────────────────────────────────────────────────────────

function SidebarSection({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-2xl p-4 border border-[var(--color-border-subtle)]">
      <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-3">
        <Icon size={11} />
        {title}
      </p>
      {children}
    </div>
  );
}

// ── Compact playlist card for Overview horizontal scroll ──────────────────────

function OverviewPlaylistCard({
  playlist,
  profile,
  onClick,
}: {
  playlist: PlaylistWithCount;
  profile: UserPlaylistProfile | undefined;
  onClick: () => void;
}) {
  const label = profile?.display_name || playlist.name;
  return (
    <button
      onClick={onClick}
      className="shrink-0 w-52 text-left rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:border-primary/30 hover:bg-[var(--color-surface-hover)] transition-all p-4 group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
          playlist.is_folder ? 'bg-primary/15 text-primary' : 'bg-secondary/15 text-secondary',
        )}>
          {playlist.is_folder ? <FolderOpen size={16} /> : <ListMusic size={16} />}
        </div>
        <ArrowUpRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0" />
      </div>
      <p className="font-bold text-sm leading-snug line-clamp-2 mb-1 group-hover:text-primary transition-colors">
        {label}
      </p>
      <p className="text-[10px] text-muted-foreground font-mono">
        {playlist.track_count} tracks
      </p>
    </button>
  );
}

// ── Analysis status banner ────────────────────────────────────────────────────

function AnalysisBanner({
  latestImport,
  onResumeAnalysis,
}: {
  latestImport: RekordboxImport | null;
  onResumeAnalysis?: (importId: string) => void;
}) {
  if (!latestImport) return null;
  const status = latestImport.analysis_status;
  if (!status || status === 'not_requested' || status === 'completed') return null;

  const isActionable = status === 'partial' || status === 'failed' || status === 'awaiting_upload' || status === 'uploading';
  const isAmber = status === 'partial' || status === 'awaiting_upload' || status === 'uploading';

  const titles: Record<string, string> = {
    partial: 'Analysis Incomplete',
    failed: 'Analysis Failed',
    awaiting_upload: 'Analysis Pending',
    uploading: 'Analysis Stalled',
    parsing: 'Analysis Processing…',
  };
  const subtitles: Record<string, string> = {
    partial: 'Some tracks are missing waveform, cue, or beat data.',
    failed: 'No analysis data could be parsed — required files may be missing.',
    awaiting_upload: 'ANLZ analysis files have not been uploaded yet.',
    uploading: 'Upload appears to have stalled — resume to retry.',
    parsing: 'Tracks are being processed in the background.',
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
      isAmber
        ? 'bg-amber-500/8 border-amber-500/20'
        : 'bg-red-500/8 border-red-500/20'
    }`}>
      <AlertTriangle size={15} className={isAmber ? 'text-amber-400 shrink-0' : 'text-red-400 shrink-0'} />
      <div className="flex-1 min-w-0">
        <span className={`font-bold ${isAmber ? 'text-amber-400' : 'text-red-400'}`}>
          {titles[status] ?? 'Analysis Issue'}
        </span>
        <span className="text-muted-foreground ml-2 text-xs">{subtitles[status]}</span>
      </div>
      {isActionable && onResumeAnalysis && (
        <button
          onClick={() => onResumeAnalysis(latestImport.id)}
          className="flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 text-xs font-bold transition-all active:scale-95"
        >
          <RefreshCw size={11} />
          Resume Analysis
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LibraryView({
  latestImport,
  importLoading,
  importError,
  playlists,
  playlistsLoading,
  playlistProfilesByRbId,
  recentTracks,
  recentTracksLoading,
  importId,
  profile,
  onPlaylistClick,
  onEditPlaylist,
  onTrackClick,
  onImport,
  onResumeAnalysis,
}: LibraryViewProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [tracksVisible, setTracksVisible] = useState(200);

  const { results: searchResults, loading: searchLoading } = useRekordboxSearch(importId, searchQuery);
  const { stats: trackStats, loading: statsLoading } = useTrackStats(importId);

  // ── Audio player ───────────────────────────────────────────────────────────
  const { activeTrack, status: playerStatus, toggleTrack } = useAudioPlayer();
  const { status: usbStatus } = useUsbConnection();
  const usbConnected = usbStatus === 'connected';

  const handlePlay = useCallback(
    (t: TrackStatRow, _e: React.MouseEvent | React.KeyboardEvent) => {
      void toggleTrack(trackStatRowToTrack(t));
    },
    [toggleTrack],
  );

  const showSearch = searchQuery.trim().length >= 2;

  // ── Derived stats ──────────────────────────────────────────────────────────

  const genreStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of trackStats) {
      if (t.genre) counts[t.genre] = (counts[t.genre] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [trackStats]);

  const artistStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of trackStats) {
      if (t.artist) counts[t.artist] = (counts[t.artist] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [trackStats]);

  const mostCommonBpm = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const t of trackStats) {
      if (t.bpm != null) {
        const r = Math.round(t.bpm);
        counts[r] = (counts[r] ?? 0) + 1;
      }
    }
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return parseInt(entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
  }, [trackStats]);

  const mostCommonKey = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of trackStats) {
      if (t.musical_key) counts[t.musical_key] = (counts[t.musical_key] ?? 0) + 1;
    }
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }, [trackStats]);

  const largestPlaylist = useMemo(() => {
    const real = playlists.filter((p) => !p.is_folder);
    if (!real.length) return null;
    return real.reduce((a, b) => (b.track_count > a.track_count ? b : a));
  }, [playlists]);

  const topGenres = genreStats.slice(0, 8);
  const visibleTracks = trackStats.slice(0, tracksVisible);

  // Stable ID list for waveform fetching — only changes when the visible set changes.
  const visibleTrackIds = useMemo(
    () => visibleTracks.map((t) => t.id),
    [visibleTracks],
  );

  const { waveforms: trackWaveforms, unavailableIds: waveformUnavailable, loadingBatchCount: waveformsLoading } = useTrackPreviewWaveforms(
    importId,
    activeTab === 'tracks' ? visibleTrackIds : [],
  );

  const importedDate = latestImport
    ? new Date(latestImport.imported_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const isToday = latestImport
    ? new Date(latestImport.imported_at).toDateString() === new Date().toDateString()
    : false;

  return (
    <div className="space-y-5 md:max-w-7xl md:mx-auto">
      {/* Search */}
      <div className="lib-search-wrapper">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10"
          size={16}
        />
        <input
          type="text"
          placeholder="Search tracks, artists, genres…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="lib-search-input"
        />
      </div>

      <AnimatePresence mode="wait">
        {showSearch ? (
          <motion.div
            key="search-results"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <LibrarySearchResults
              query={searchQuery.trim()}
              results={searchResults}
              loading={searchLoading}
              importId={importId}
              onTrackClick={onTrackClick}
            />
          </motion.div>
        ) : (
          <motion.div
            key="library-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-5"
          >
            {importLoading && (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            )}

            {!importLoading && importError && (
              <div className="text-center py-24 space-y-2">
                <p className="text-red-400 font-bold">Failed to load library</p>
                <p className="text-xs text-muted-foreground">{importError}</p>
              </div>
            )}

            {!importLoading && !importError && !latestImport && (
              <EmptyLibrary onImport={onImport} />
            )}

            {!importLoading && !importError && latestImport && (
              <>
                {/* Hero */}
                <LibraryHero
                  latestImport={latestImport}
                  profile={profile}
                  onImport={onImport}
                />

                {/* Analysis status banner */}
                <AnalysisBanner
                  latestImport={latestImport}
                  onResumeAnalysis={onResumeAnalysis}
                />

                {/* Tab bar */}
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none border-b border-[var(--color-border-subtle)]">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'shrink-0 px-4 py-2.5 text-sm font-bold transition-all border-b-2 -mb-px',
                        activeTab === tab.id
                          ? 'text-primary border-primary'
                          : 'text-muted-foreground border-transparent hover:text-foreground',
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >

                    {/* ── OVERVIEW ── */}
                    {activeTab === 'overview' && (
                      <div className="flex gap-5">
                        {/* Left sidebar */}
                        <div className="hidden lg:flex flex-col gap-4 w-56 xl:w-64 shrink-0">

                          {/* Top Genres */}
                          <SidebarSection icon={Tag} title="Top Genres">
                            {statsLoading ? (
                              <Loader2 size={14} className="animate-spin text-muted-foreground" />
                            ) : topGenres.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">No genre data</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {topGenres.map(([genre], i) => (
                                  <span
                                    key={genre}
                                    className={cn(
                                      'px-2.5 py-1 rounded-full text-[10px] font-bold border',
                                      GENRE_BADGE_STYLES[i % GENRE_BADGE_STYLES.length],
                                    )}
                                  >
                                    {genre}
                                  </span>
                                ))}
                              </div>
                            )}
                          </SidebarSection>

                          {/* Library Snapshot */}
                          <SidebarSection icon={BarChart2} title="Library Snapshot">
                            {statsLoading ? (
                              <Loader2 size={14} className="animate-spin text-muted-foreground" />
                            ) : (
                              <div className="space-y-2.5">
                                {[
                                  {
                                    icon: BarChart2,
                                    label: 'Most common BPM',
                                    value: mostCommonBpm != null ? String(mostCommonBpm) : '—',
                                  },
                                  {
                                    icon: Music,
                                    label: 'Most common key',
                                    value: mostCommonKey ? formatKey(mostCommonKey) : '—',
                                  },
                                  {
                                    icon: FolderOpen,
                                    label: 'Largest playlist',
                                    value: largestPlaylist?.name ?? '—',
                                  },
                                ].map(({ icon: Icon, label, value }) => (
                                  <div key={label} className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <Icon size={12} className="text-muted-foreground shrink-0" />
                                      <span className="text-[11px] text-muted-foreground truncate">{label}</span>
                                    </div>
                                    <span className="text-[11px] font-bold font-mono shrink-0">{value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </SidebarSection>
                        </div>

                        {/* Main content */}
                        <div className="flex-1 min-w-0 space-y-6">
                          {/* Playlists horizontal scroll */}
                          <section className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <ListMusic size={13} /> Playlists
                              </h2>
                              <button
                                onClick={() => setActiveTab('playlists')}
                                className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                              >
                                View all <ChevronRight size={12} />
                              </button>
                            </div>
                            {playlistsLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="animate-spin text-muted-foreground" size={20} />
                              </div>
                            ) : (
                              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                                {playlists
                                  .filter((p) => !p.is_folder)
                                  .slice(0, 10)
                                  .map((playlist) => (
                                    <OverviewPlaylistCard
                                      key={playlist.id}
                                      playlist={playlist}
                                      profile={playlistProfilesByRbId.get(playlist.rekordbox_playlist_id)}
                                      onClick={() => onPlaylistClick(playlist)}
                                    />
                                  ))}
                              </div>
                            )}
                          </section>

                          {/* Recently added tracks */}
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Music size={13} /> Recently Added Tracks
                              </h2>
                              <button
                                onClick={() => setActiveTab('recently-added')}
                                className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                              >
                                View all <ChevronRight size={12} />
                              </button>
                            </div>
                            <RecentlyAddedTracksTable
                              tracks={recentTracks}
                              loading={recentTracksLoading}
                              onTrackClick={onTrackClick}
                              showHeader={false}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── PLAYLISTS ── */}
                    {activeTab === 'playlists' && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground font-mono">
                            {playlistsLoading ? '…' : `${playlists.length} items`}
                          </p>
                        </div>
                        {playlistsLoading ? (
                          <div className="flex items-center justify-center py-10">
                            <Loader2 className="animate-spin text-muted-foreground" size={20} />
                          </div>
                        ) : playlists.length === 0 ? (
                          <div className="text-center py-10 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
                            <p className="text-muted-foreground text-sm">No playlists in this import.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                            {playlists.map((playlist) => {
                              const prof = playlistProfilesByRbId.get(playlist.rekordbox_playlist_id);
                              return (
                                <PlaylistOverviewCard
                                  key={playlist.id}
                                  playlist={playlist}
                                  artworkUrl={prof?.artwork_url}
                                  displayName={prof?.display_name}
                                  onClick={() => onPlaylistClick(playlist)}
                                  onEdit={() => onEditPlaylist(playlist)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </section>
                    )}

                    {/* ── RECENTLY ADDED ── */}
                    {activeTab === 'recently-added' && (
                      <RecentlyAddedTracksTable
                        tracks={recentTracks}
                        loading={recentTracksLoading}
                        onTrackClick={onTrackClick}
                      />
                    )}

                    {/* ── TRACKS ── */}
                    {activeTab === 'tracks' && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground font-mono">
                          {statsLoading
                            ? 'Loading…'
                            : `${trackStats.length.toLocaleString()} tracks · showing ${Math.min(tracksVisible, trackStats.length).toLocaleString()}`}
                        </p>
                        {statsLoading ? (
                          <div className="flex items-center justify-center py-16">
                            <Loader2 className="animate-spin text-primary" size={28} />
                          </div>
                        ) : (
                          <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
                            <div className="hidden sm:grid grid-cols-[36px_1fr_56px_56px_88px_88px] px-4 py-2.5 border-b border-[var(--color-border-faint)] gap-x-2">
                              {['', 'Track', 'BPM', 'Key', 'Genre', 'Added'].map((col, i) => (
                                <p
                                  key={col || `col-${i}`}
                                  className={cn(
                                    'text-[9px] uppercase tracking-widest text-muted-foreground font-bold',
                                    i === 2 || i === 3 ? 'text-center' : '',
                                    i === 5 ? 'text-right' : '',
                                  )}
                                >
                                  {col}
                                </p>
                              ))}
                            </div>
                            <div className="divide-y divide-[var(--color-border-faint)]">
                              {visibleTracks.map((t) => (
                                <TrackRow
                                  key={t.id}
                                  track={t}
                                  waveform={trackWaveforms.get(t.id) ?? null}
                                  waveformUnavailable={waveformUnavailable.has(t.id)}
                                  waveformLoading={
                                    !trackWaveforms.has(t.id) &&
                                    !waveformUnavailable.has(t.id) &&
                                    waveformsLoading > 0
                                  }
                                  isActiveTrack={activeTrack?.id === t.id}
                                  playerStatus={playerStatus}
                                  usbConnected={usbConnected}
                                  onOpen={onTrackClick}
                                  onPlay={handlePlay}
                                />
                              ))}
                            </div>
                            {trackStats.length > tracksVisible && (
                              <button
                                onClick={() => setTracksVisible((n) => n + 200)}
                                className="w-full py-3 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] border-t border-[var(--color-border-faint)] transition-colors"
                              >
                                Load {Math.min(200, trackStats.length - tracksVisible).toLocaleString()} more…
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── GENRES ── */}
                    {activeTab === 'genres' && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground font-mono">
                          {statsLoading ? 'Loading…' : `${genreStats.length} genres`}
                        </p>
                        {statsLoading ? (
                          <div className="flex items-center justify-center py-16">
                            <Loader2 className="animate-spin text-primary" size={28} />
                          </div>
                        ) : genreStats.length === 0 ? (
                          <p className="text-center py-12 text-muted-foreground italic text-sm">No genre data in this library.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                            {genreStats.map(([genre, count]) => (
                              <div
                                key={genre}
                                className="glass rounded-2xl p-4 border border-[var(--color-border-subtle)] hover:border-primary/25 transition-all"
                              >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <p className="font-bold text-sm leading-snug">{genre}</p>
                                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">
                                    {count.toLocaleString()}
                                  </span>
                                </div>
                                <div className="h-1 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${(count / genreStats[0][1]) * 100}%` }}
                                  />
                                </div>
                                <p className="text-[9px] text-muted-foreground mt-1.5 font-mono">tracks</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── ARTISTS ── */}
                    {activeTab === 'artists' && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground font-mono">
                          {statsLoading ? 'Loading…' : `${artistStats.length.toLocaleString()} artists`}
                        </p>
                        {statsLoading ? (
                          <div className="flex items-center justify-center py-16">
                            <Loader2 className="animate-spin text-primary" size={28} />
                          </div>
                        ) : artistStats.length === 0 ? (
                          <p className="text-center py-12 text-muted-foreground italic text-sm">No artist data in this library.</p>
                        ) : (
                          <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
                            <div className="hidden sm:grid grid-cols-[auto_1fr_80px] px-4 py-2.5 border-b border-[var(--color-border-faint)]">
                              {['', 'Artist', 'Tracks'].map((col, i) => (
                                <p key={i} className={cn('text-[9px] uppercase tracking-widest text-muted-foreground font-bold', i === 2 && 'text-right')}>
                                  {col}
                                </p>
                              ))}
                            </div>
                            <div className="divide-y divide-[var(--color-border-faint)]">
                              {artistStats.map(([artist, count]) => (
                                <div
                                  key={artist}
                                  className="grid grid-cols-[auto_1fr_80px] items-center px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
                                >
                                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3 shrink-0">
                                    <span className="text-xs font-black text-primary">
                                      {artist[0]?.toUpperCase() ?? '?'}
                                    </span>
                                  </div>
                                  <span className="text-sm font-semibold truncate">{artist}</span>
                                  <span className="text-[10px] font-mono text-muted-foreground text-right">
                                    {count.toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  </motion.div>
                </AnimatePresence>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
