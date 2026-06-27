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
  Play,
  Pause,
  User,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  RefreshCw,
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

const ANALYSIS_TITLES: Record<string, string> = {
  partial: 'Analysis Incomplete',
  failed: 'Analysis Failed',
  awaiting_upload: 'Analysis Pending',
  uploading: 'Analysis Stalled',
  parsing: 'Analysis Processing…',
};

import { motion, AnimatePresence } from 'motion/react';
import { cn, formatKey } from '../../lib/utils';
import {
  useLibraryStats,
  useLibraryTracks,
  useRekordboxSearch,
} from '../../hooks/useRekordboxTracks';
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
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';

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

// ── Artist profile card (left column, desktop) ─────────────────────────────

function ArtistProfileCard({
  profile,
  latestImport,
}: {
  profile: UserProfile | null;
  latestImport: RekordboxImport;
}) {
  const [imgError, setImgError] = useState(false);
  const libraryName = profile?.display_name?.toUpperCase() ?? 'MY LIBRARY';
  const avatarUrl = profile?.avatar_url ?? null;
  const initials = profile?.display_name
    ? profile.display_name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : null;

  return (
    <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-5 text-center">
      <div className="relative inline-block mb-3">
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={profile?.display_name ?? 'Profile'}
            onError={() => setImgError(true)}
            className="w-20 h-20 rounded-full object-cover ring-4 ring-primary/25 shadow-xl"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border-2 border-primary/20 flex items-center justify-center shadow-lg">
            {initials ? (
              <span className="text-2xl font-black text-primary">{initials}</span>
            ) : (
              <User size={32} className="text-primary/70" />
            )}
          </div>
        )}
        <div className="absolute inset-[-6px] rounded-full border border-primary/10 pointer-events-none" />
        <div className="absolute inset-[-13px] rounded-full border border-primary/5 pointer-events-none" />
      </div>
      <h1 className="text-2xl font-black uppercase leading-tight tracking-tight">{libraryName}</h1>
      <p className="text-xs text-muted-foreground mt-1.5 font-semibold">
        {latestImport.track_count.toLocaleString()} tracks
      </p>
      <p className="text-xs text-muted-foreground font-semibold">
        {latestImport.playlist_count} playlists
      </p>
    </div>
  );
}

// ── Library info card (left column, desktop) ────────────────────────────────

function DesktopLibraryInfoCard({
  latestImport,
  mostCommonBpm,
  mostCommonKey,
  largestPlaylistName,
  statsLoading,
  onImport,
  onResumeAnalysis,
}: {
  latestImport: RekordboxImport;
  mostCommonBpm: number | null;
  mostCommonKey: string | null;
  largestPlaylistName: string | null;
  statsLoading: boolean;
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
}) {
  const { volumeName } = useUsbConnection();
  const analysisStatus = latestImport.analysis_status;
  const showAnalysis =
    analysisStatus && analysisStatus !== 'not_requested' && analysisStatus !== 'completed';
  const isAmber =
    analysisStatus === 'partial' ||
    analysisStatus === 'awaiting_upload' ||
    analysisStatus === 'uploading';
  const isActionable =
    analysisStatus === 'partial' ||
    analysisStatus === 'failed' ||
    analysisStatus === 'awaiting_upload' ||
    analysisStatus === 'uploading';

  const shortDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-4 space-y-3">
      <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
        Library Info
      </p>

      {/* USB Import */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 px-3 py-2.5">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-1">
            USB Import
          </p>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-green-500 shrink-0" />
            <span className="font-black text-sm leading-none text-green-500">Import Complete</span>
          </div>
          <button
            onClick={onImport}
            className="mt-2 w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors text-[10px] font-semibold"
          >
            <FileUp size={10} className="shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left">Import New Library</span>
            <ChevronRight size={10} className="text-muted-foreground shrink-0" />
          </button>
        </div>

        {/* Track Analysis */}
        {showAnalysis && (
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-1">
              Track Analysis
            </p>
            <div className="flex items-center gap-1.5">
              <AlertTriangle
                size={12}
                className={isAmber ? 'text-amber-400 shrink-0' : 'text-red-400 shrink-0'}
              />
              <span
                className={cn(
                  'font-black text-sm leading-none',
                  isAmber ? 'text-amber-400' : 'text-red-400',
                )}
              >
                {ANALYSIS_TITLES[analysisStatus] ?? 'Analysis Issue'}
              </span>
            </div>
            {isActionable && onResumeAnalysis && (
              <button
                onClick={() => onResumeAnalysis(latestImport.id)}
                className="mt-2 w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors text-[10px] font-semibold"
              >
                <RefreshCw size={10} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">Resume Analysis</span>
                <ChevronRight size={10} className="text-muted-foreground shrink-0" />
              </button>
            )}
          </div>
        )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--color-border-faint)]">
        {[
          {
            icon: Music,
            value:
              latestImport.track_count >= 1000
                ? `${(latestImport.track_count / 1000).toFixed(1)}k`
                : String(latestImport.track_count),
            label: 'Tracks',
          },
          { icon: ListMusic, value: String(latestImport.playlist_count), label: 'Playlists' },
          { icon: Calendar, value: shortDate, label: 'Last Import' },
        ].map(({ icon: Icon, value, label }) => (
          <div key={label} className="text-center">
            <Icon size={11} className="text-muted-foreground mx-auto mb-0.5" />
            <p className="text-sm font-black tabular-nums leading-tight">{value}</p>
            <p className="text-[8px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
              {label}
            </p>
          </div>
        ))}
        <p className="col-span-3 text-[10px] text-muted-foreground font-mono mt-1">
          Imported from {latestImport.device_name ?? volumeName ?? latestImport.source_filename}
        </p>
      </div>

      {/* Library Snapshot */}
      <div className="pt-2 border-t border-[var(--color-border-faint)]">
        {statsLoading ? (
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-2">
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
                value: largestPlaylistName ?? '—',
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon size={11} className="text-muted-foreground shrink-0" />
                  <span className="text-[11px] text-muted-foreground truncate">{label}</span>
                </div>
                <span className="text-[11px] font-bold font-mono shrink-0">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Memoized track row ────────────────────────────────────────────────────────

interface TrackRowProps {
  track: RekordboxTrack;
  waveformState: WaveformLoadState;
  onRetryWaveform: () => void;
  isActiveTrack: boolean;
  playerStatus: string;
  usbConnected: boolean;
  onOpen: (t: RekordboxTrack) => void;
  onPlay: (t: RekordboxTrack, e: React.MouseEvent | React.KeyboardEvent) => void;
}

const TrackRow = memo(function TrackRow({
  track: t,
  waveformState,
  onRetryWaveform,
  isActiveTrack,
  playerStatus,
  usbConnected,
  onOpen,
  onPlay,
}: TrackRowProps) {
  const handleRowClick = useCallback(() => onOpen(t), [onOpen, t]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(t);
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

  const progress = useWaveformProgress(t.id);
  const { seek, getAudioElement } = useAudioPlayer();

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
            title={!usbConnected ? 'Connect a USB drive to play' : undefined}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              isActiveRow && 'opacity-100',
              isLoadingThis && 'opacity-100 cursor-wait',
              isPlaying
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-[var(--color-surface)] text-foreground hover:bg-primary hover:text-white',
            )}
          >
            {isLoadingThis ? (
              <Loader2 size={13} className="animate-spin" />
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
              state={waveformState}
              height={22}
              onRetry={onRetryWaveform}
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
            className={cn(
              'mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all',
              isPlaying
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
            state={waveformState}
            height={20}
            onRetry={onRetryWaveform}
            activeProgress={progress}
            onSeek={canSeek ? handleWaveformSeek : undefined}
            ariaLabel=""
          />
        </div>
      </div>
    </div>
  );
});

// ── Sidebar section wrapper ───────────────────────────────────────────────────

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

  const {
    results: searchResults,
    total: searchTotal,
    loading: searchLoading,
    loadingMore: searchLoadingMore,
    hasMore: searchHasMore,
    loadMore: loadMoreSearchResults,
  } = useRekordboxSearch(importId, searchQuery);
  const {
    tracks: libraryTracks,
    total: libraryTrackTotal,
    loading: tracksLoading,
    loadingMore: tracksLoadingMore,
    hasMore: tracksHaveMore,
    loadMore: loadMoreLibraryTracks,
  } = useLibraryTracks(importId);
  const { stats: libraryStats, loading: statsLoading } = useLibraryStats(importId);

  // ── Audio player ───────────────────────────────────────────────────────────
  const { activeTrack, status: playerStatus, toggleTrack } = useAudioPlayer();
  const { status: usbStatus } = useUsbConnection();
  const usbConnected = usbStatus === 'connected';

  const handlePlay = useCallback(
    (t: RekordboxTrack, _e: React.MouseEvent | React.KeyboardEvent) => {
      void toggleTrack(t);
    },
    [toggleTrack],
  );

  const showSearch = searchQuery.trim().length >= 2;

  // ── Derived stats ──────────────────────────────────────────────────────────

  const genreStats = useMemo(
    () => (libraryStats?.genreTotals ?? []).map(({ name, count }) => [name, count] as const),
    [libraryStats?.genreTotals],
  );

  const artistStats = useMemo(
    () => (libraryStats?.artistTotals ?? []).map(({ name, count }) => [name, count] as const),
    [libraryStats?.artistTotals],
  );

  const mostCommonBpm = libraryStats?.mostCommonBpm ?? null;
  const mostCommonKey = libraryStats?.mostCommonKey ?? null;

  const largestPlaylist = useMemo(() => {
    const real = playlists.filter((p) => !p.is_folder);
    if (!real.length) return null;
    return real.reduce((a, b) => (b.track_count > a.track_count ? b : a));
  }, [playlists]);

  const topGenres = genreStats.slice(0, 8);
  const visibleTracks = libraryTracks;

  const visibleTrackIds = useMemo(
    () => visibleTracks.map((t) => t.id),
    [visibleTracks],
  );

  const recentTrackIds = useMemo(
    () => recentTracks.map((t) => t.id),
    [recentTracks],
  );

  const searchResultIds = useMemo(
    () => (showSearch ? searchResults.map((t) => t.id) : []),
    [showSearch, searchResults],
  );

  const waveformIds = useMemo(() => {
    if (showSearch) return searchResultIds;
    if (activeTab === 'tracks') return visibleTrackIds;
    return recentTrackIds;
  }, [showSearch, searchResultIds, activeTab, visibleTrackIds, recentTrackIds]);

  const {
    states: waveformStates,
    retry: retryWaveform,
    getState: getWaveformState,
  } = useTrackPreviewWaveforms(importId, waveformIds);

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
              total={searchTotal}
              loading={searchLoading}
              loadingMore={searchLoadingMore}
              hasMore={searchHasMore}
              importId={importId}
              onTrackClick={onTrackClick}
              onLoadMore={() => { void loadMoreSearchResults(); }}
              waveformStates={waveformStates}
              onRetryWaveform={(trackId) => retryWaveform([trackId])}
            />
          </motion.div>
        ) : (
          <motion.div
            key="library-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
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
              <div className="flex gap-5 items-start">

                {/* ── Left column (desktop only) ── */}
                <div className="hidden lg:flex flex-col gap-4 w-64 xl:w-72 shrink-0">
                  <ArtistProfileCard profile={profile} latestImport={latestImport} />

                  <DesktopLibraryInfoCard
                    latestImport={latestImport}
                    mostCommonBpm={mostCommonBpm}
                    mostCommonKey={mostCommonKey}
                    largestPlaylistName={largestPlaylist?.name ?? null}
                    statsLoading={statsLoading}
                    onImport={onImport}
                    onResumeAnalysis={onResumeAnalysis}
                  />

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
                </div>

                {/* ── Right column ── */}
                <div className="flex-1 min-w-0 space-y-4">

                  {/* Mobile: full hero (hidden on desktop) */}
                  <div className="lg:hidden">
                    <LibraryHero
                      latestImport={latestImport}
                      profile={profile}
                      onImport={onImport}
                      onResumeAnalysis={onResumeAnalysis}
                    />
                  </div>

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
                        <div className="space-y-6">

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
                              waveformStates={waveformStates}
                              onRetryWaveform={(trackId) => retryWaveform([trackId])}
                              showHeader={false}
                            />
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
                          waveformStates={waveformStates}
                          onRetryWaveform={(trackId) => retryWaveform([trackId])}
                        />
                      )}

                      {/* ── TRACKS ── */}
                      {activeTab === 'tracks' && (
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground font-mono">
                            {tracksLoading
                              ? 'Loading…'
                              : `${libraryTrackTotal.toLocaleString()} tracks · showing ${visibleTracks.length.toLocaleString()}`}
                          </p>
                          {tracksLoading ? (
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
                                    waveformState={getWaveformState(t.id)}
                                    onRetryWaveform={() => retryWaveform([t.id])}
                                    isActiveTrack={activeTrack?.id === t.id}
                                    playerStatus={playerStatus}
                                    usbConnected={usbConnected}
                                    onOpen={onTrackClick}
                                    onPlay={handlePlay}
                                  />
                                ))}
                              </div>
                              {tracksHaveMore && (
                                <button
                                  onClick={() => { void loadMoreLibraryTracks(); }}
                                  disabled={tracksLoadingMore}
                                  className="w-full py-3 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] border-t border-[var(--color-border-faint)] transition-colors disabled:opacity-60"
                                >
                                  {tracksLoadingMore ? (
                                    <span className="inline-flex items-center gap-2">
                                      <Loader2 size={13} className="animate-spin" /> Loading more…
                                    </span>
                                  ) : (
                                    `Load ${Math.min(200, libraryTrackTotal - visibleTracks.length).toLocaleString()} more…`
                                  )}
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
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
