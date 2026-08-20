import { useState, useMemo, memo, useCallback, useRef, type ReactNode } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';

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
import type { LibraryTab } from '../../navigation/appRoutes';
import { ArrowUpRight, Calendar, ChartBar, CheckmarkFilled, ChevronRight, CircleDash, FolderOpen, Globe, LogoInstagram, LogoYoutube, Music, Pause, Play, RecordingFilled, Renew, Search, Tag, Undo, Upload, Usb, User, WarningAlt, Waveform } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';


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
  activeTab: LibraryTab;
  searchQuery: string;
  onActiveTabChange: (tab: LibraryTab) => void;
  onSearchQueryChange: (query: string) => void;
}

function EmptyLibrary({ onImport, profile }: { onImport: () => void; profile: UserProfile | null }) {
  const [imgError, setImgError] = useState(false);
  const libraryName = profile?.display_name?.toUpperCase() ?? 'MY LIBRARY';
  const avatarUrl = profile?.avatar_url ?? null;
  const initials = profile?.display_name
    ? profile.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : null;

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      {/* Profile */}
      <div className="relative inline-block">
        <div className="absolute inset-[-5px] rounded-full border-2 border-primary shadow-[0_0_24px_rgba(10,145,255,0.34)] pointer-events-none" />
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={profile?.display_name ?? 'Profile'}
            onError={() => setImgError(true)}
            className="w-24 h-24 rounded-full object-cover"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center shadow-lg">
            {initials ? (
              <span className="text-2xl font-black text-primary">{initials}</span>
            ) : (
              <User size={34} className="text-primary/70" />
            )}
          </div>
        )}
      </div>
      <h1 className="text-2xl font-black uppercase leading-tight tracking-tight">{libraryName}</h1>

      {/* Divider */}
      <div className="w-16 h-px bg-[var(--color-border-subtle)]" />

      {/* Empty state */}
      <h2 className="text-lg font-bold">No Rekordbox Library Imported Yet</h2>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
        Connect your rekordbox USB drive, then import your library to get started.
      </p>
      <ControlButton variant="primary" onClick={onImport} className="w-auto">
        <Upload size={16} />
        Import Rekordbox Library
      </ControlButton>
    </div>
  );
}

// ── Artist profile card (left column, desktop) ─────────────────────────────

function ArtistProfileCard({
  profile,
  latestImport,
}: {
  profile: UserProfile | null;
  latestImport: RekordboxImport | null;
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
    <div className="glass rounded-2xl border border-[var(--color-border-subtle)] px-5 py-6 text-center flex flex-col items-center justify-center min-h-[218px]">
      <div className="relative inline-block mb-4">
        <div className="absolute inset-[-5px] rounded-full border-2 border-primary shadow-[0_0_24px_rgba(10,145,255,0.34)] pointer-events-none" />
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={profile?.display_name ?? 'Profile'}
            onError={() => setImgError(true)}
            className="w-24 h-24 rounded-full object-cover"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center shadow-lg">
            {initials ? (
              <span className="text-2xl font-black text-primary">{initials}</span>
            ) : (
              <User size={34} className="text-primary/70" />
            )}
          </div>
        )}
        <span className="absolute right-0 bottom-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[var(--color-background)] shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
      </div>

      <h1 className="text-2xl font-black uppercase leading-tight tracking-tight">{libraryName}</h1>

      {(() => {
        const links = [
          profile?.spotify_url ? { href: profile.spotify_url, label: 'Spotify', icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.313a.748.748 0 0 1-1.031.25c-2.822-1.724-6.375-2.114-10.561-1.158a.749.749 0 1 1-.333-1.462c4.579-1.045 8.507-.596 11.675 1.339a.75.75 0 0 1 .25 1.031zm1.472-3.274a.937.937 0 0 1-1.288.308c-3.226-1.983-8.143-2.558-11.963-1.4a.937.937 0 1 1-.544-1.791c4.361-1.323 9.782-.682 13.487 1.596a.937.937 0 0 1 .308 1.287zm.126-3.409c-3.868-2.297-10.249-2.509-13.944-1.388a1.124 1.124 0 1 1-.652-2.15c4.243-1.288 11.298-1.039 15.749 1.607a1.125 1.125 0 0 1-1.153 1.931z"/></svg> } : null,
          profile?.soundcloud_url ? { href: profile.soundcloud_url, label: 'SoundCloud', icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1.175 12.225c-.015.132-.024.265-.024.4 0 .135.009.268.024.4l-.024-.4.024.4c.133 1.162 1.11 2.063 2.3 2.063 1.276 0 2.312-1.036 2.312-2.312V8.1a.387.387 0 0 0-.387-.387.387.387 0 0 0-.387.387v4.275a1.538 1.538 0 0 1-1.538 1.538 1.538 1.538 0 0 1-1.538-1.538 1.538 1.538 0 0 1 1.538-1.538c.283 0 .549.077.775.213V8.1A2.887 2.887 0 0 0 1.364 9.9c-.13.382-.189.78-.189 1.187v1.138zm5.1 2.463V7.762a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.926a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55.387V8.475a.387.387 0 0 1 .387-.388.387.387 0 0 1 .388.388v6.6a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55 0V8.1a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.975a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55.225V7.762a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v7.538a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55-.225V8.1a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.975a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm2.1-.3c0 .98.795 1.775 1.775 1.775a1.776 1.776 0 0 0 1.725-1.375 3.526 3.526 0 0 0 .3.013 3.525 3.525 0 0 0 3.525-3.525A3.525 3.525 0 0 0 18.375 8.1a3.51 3.51 0 0 0-1.85.525 5.026 5.026 0 0 0-4.6-3.05 5.025 5.025 0 0 0-4.3 2.437v6.763c0 .98.795 1.775 1.775 1.775s1.775-.795 1.775-1.775V8.1a.387.387 0 0 1 .775 0v6.675z"/></svg> } : null,
          profile?.instagram_url ? { href: profile.instagram_url, label: 'Instagram', icon: <LogoInstagram size={16} /> } : null,
          profile?.youtube_url ? { href: profile.youtube_url, label: 'YouTube', icon: <LogoYoutube size={16} /> } : null,
          profile?.website_url ? { href: profile.website_url, label: 'Website', icon: <Globe size={16} /> } : null,
        ].filter(Boolean) as { href: string; label: string; icon: ReactNode }[];
        return links.length > 0 ? (
          <div className="mt-3 flex items-center justify-center gap-3">
            {links.map(({ href, label, icon }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="text-muted-foreground hover:text-foreground transition-colors">
                {icon}
              </a>
            ))}
          </div>
        ) : null;
      })()}

    </div>
  );
}

// ── Library health card (left column, desktop) ─────────────────────────────

function DesktopLibraryInfoCard({
  latestImport,
  onImport,
  onResumeAnalysis,
}: {
  latestImport: RekordboxImport;
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
}) {
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

  const fullDate = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-4 space-y-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold flex items-center gap-1.5">
        <ChartBar size={11} /> Library Health
      </p>

      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 px-3 py-3">
        <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-2">
          USB Import
        </p>
        <div className="flex items-center gap-2">
          <CheckmarkFilled size={14} className="text-emerald-500 shrink-0" />
          <span className="font-black text-sm leading-none text-emerald-500">Import Complete</span>
        </div>
        <ControlButton variant="neutral" onClick={onImport} className="mt-3 w-full text-[10px]">
          <Upload size={11} /> Import New Library
        </ControlButton>
      </div>

      {showAnalysis && (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/60 px-3 py-3">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-2">
            Track Analysis
          </p>
          <div className="flex items-center gap-2">
            <WarningAlt
              size={13}
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
            <ControlButton variant="neutral" onClick={() => onResumeAnalysis(latestImport.id)} className="mt-3 w-full text-[10px]">
              <Renew size={11} /> Resume Analysis
            </ControlButton>
          )}
        </div>
      )}

      <div className="space-y-3 pt-1">
        {(() => {
          const total = latestImport.analysis_expected_track_count || latestImport.track_count;
          const parsed = latestImport.analysis_parsed_track_count ?? 0;
          const percent = latestImport.analysis_status === 'completed'
            ? 100
            : total > 0 ? Math.round((parsed / total) * 100) : 0;
          const statusLabel: Record<string, string> = {
            completed: 'Completed',
            partial: 'Partial',
            failed: 'Failed',
            in_progress: 'In Progress',
            awaiting_upload: 'Awaiting Upload',
            uploading: 'Uploading',
            not_requested: 'Not Started',
          };
          const analyzed = latestImport.analysis_status === 'completed' ? total : parsed;
          return [
            { icon: RecordingFilled, label: 'Status', value: statusLabel[latestImport.analysis_status ?? ''] ?? '—' },
            { icon: Waveform, label: 'Analyzed', value: analyzed.toLocaleString() },
            { icon: Music, label: 'Total Tracks', value: total.toLocaleString() },
            { icon: ChartBar, label: 'Progress', value: `${percent}%` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={13} className="text-muted-foreground shrink-0" />
                <span className="text-[11px] text-muted-foreground truncate">{label}</span>
              </div>
              <span className="text-[11px] font-bold font-mono shrink-0 max-w-[45%] truncate" title={value}>
                {value}
              </span>
            </div>
          ));
        })()}
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
  playIntent: boolean;
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
  playIntent,
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

  const isPlaying = isActiveTrack && playIntent;
  const isLoadingThis = isActiveTrack && (playerStatus === 'resolving' || playerStatus === 'loading');
  const isActiveRow = isActiveTrack && !['idle', 'resolving', 'loading', 'error'].includes(playerStatus);

  const progress = useWaveformProgress(t.id);
  const { seek, getAudioElement } = useAudioPlayer();

  const canSeek = isActiveTrack && !['idle', 'resolving', 'loading', 'error'].includes(playerStatus);
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
        'group w-full px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset',
        isActiveRow && 'border-l-2 border-l-primary bg-primary/5 hover:bg-primary/10',
      )}
    >
      {/* ── Desktop grid (6 columns: play | identity | BPM | Key | Genre | Date) ── */}
      <div className="hidden sm:grid grid-cols-[36px_1fr_56px_56px_88px_88px] items-center gap-x-2 gap-y-2">
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
              <CircleDash size={13} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={13} />
            ) : (
              <Play size={13} />
            )}
          </button>
        </div>

        {/* Identity */}
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

        {/* Full-record waveform */}
        <div className="col-span-full">
          <RekordboxPreviewWaveform
            state={waveformState}
            height={30}
            variant="compact"
            onRetry={onRetryWaveform}
            activeProgress={progress}
            onSeek={canSeek ? handleWaveformSeek : undefined}
            ariaLabel=""
            surface={false}
          />
        </div>
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
              <CircleDash size={11} className="animate-spin" />
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
            height={26}
            variant="compact"
            onRetry={onRetryWaveform}
            activeProgress={progress}
            onSeek={canSeek ? handleWaveformSeek : undefined}
            ariaLabel=""
            surface={false}
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

// ── Genre donut chart ─────────────────────────────────────────────────────────

const DONUT_COLORS = ['#5BB5E8', '#9B72E8', '#3DBF8A', '#F5A940', '#E55475', '#36C4D0', '#D464C8', '#F97316', '#A3E635', '#22D3EE', '#E879F9', '#34D399'];
const DONUT_OTHER_COLOR = '#4A5568';
const DONUT_PER_CHART = 6;

function SingleDonut({
  items,
  total,
  colorOffset = 0,
}: {
  items: readonly (readonly [string, number])[];
  total: number;
  colorOffset?: number;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const cx = 80, cy = 80, outerR = 72, innerR = 48, GAP = 0.022;

  const segments = (() => {
    let angle = -Math.PI / 2;
    return items.map(([name, count], i) => {
      const fraction = count / total;
      const sweep = Math.max(0, fraction * 2 * Math.PI - GAP);
      const start = angle + GAP / 2;
      const end = start + sweep;
      angle += fraction * 2 * Math.PI;
      const ci = colorOffset + i;
      const color = name === 'Other' ? DONUT_OTHER_COLOR : (DONUT_COLORS[ci % DONUT_COLORS.length]);
      const large = sweep > Math.PI ? 1 : 0;
      const d = [
        `M ${cx + outerR * Math.cos(start)} ${cy + outerR * Math.sin(start)}`,
        `A ${outerR} ${outerR} 0 ${large} 1 ${cx + outerR * Math.cos(end)} ${cy + outerR * Math.sin(end)}`,
        `L ${cx + innerR * Math.cos(end)} ${cy + innerR * Math.sin(end)}`,
        `A ${innerR} ${innerR} 0 ${large} 0 ${cx + innerR * Math.cos(start)} ${cy + innerR * Math.sin(start)}`,
        'Z',
      ].join(' ');
      return { d, color, name, count, fraction };
    });
  })();

  const hovered = hoveredIndex !== null ? segments[hoveredIndex] : null;
  const topItem = segments[0];

  return (
    <div className="flex gap-5 items-center w-full min-w-0">
      {/* Donut */}
      <div className="relative shrink-0">
        <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
          <defs>
            <filter id="seg-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {segments.map((seg, i) => (
            <path
              key={seg.name}
              d={seg.d}
              fill={seg.color}
              filter={hoveredIndex === i ? 'url(#seg-glow)' : undefined}
              style={{
                opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.25,
                transition: 'opacity 0.15s, filter 0.15s',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          ))}
          {/* Center: percentage or item count */}
          <text
            x={cx} y={cy - 6}
            textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 26, fontWeight: 900, fill: 'var(--color-foreground)', fontFamily: 'inherit' }}
          >
            {hovered ? `${Math.round(hovered.fraction * 100)}%` : `${items.length}`}
          </text>
          <text
            x={cx} y={cy + 16}
            textAnchor="middle"
            style={{ fontSize: 8, fontWeight: 700, fill: 'var(--color-muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'inherit' }}
          >
            {hovered ? hovered.name.slice(0, 10) : 'categories'}
          </text>
        </svg>
      </div>

      {/* Legend — bar rows */}
      <div className="flex-1 min-w-0 space-y-2">
        {segments.map((seg, i) => (
          <div
            key={seg.name}
            className="min-w-0 cursor-default"
            style={{ opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.3, transition: 'opacity 0.15s' }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-baseline justify-between mb-0.5 gap-1">
              <span className="text-[10px] font-semibold truncate" style={{ color: seg.color }}>{seg.name}</span>
              <span className="text-[10px] font-mono font-black tabular-nums text-foreground shrink-0">{Math.round(seg.fraction * 100)}%</span>
            </div>
            <div className="h-[3px] w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${seg.fraction * 100}%`, backgroundColor: seg.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenreDonutChart({ genres }: { genres: readonly (readonly [string, number])[] }) {
  if (genres.length === 0) return null;

  const grandTotal = genres.reduce((sum, [, n]) => sum + n, 0);
  const topSlice = genres.slice(0, DONUT_PER_CHART);
  const otherTotal = genres.slice(DONUT_PER_CHART).reduce((sum, [, n]) => sum + n, 0);
  const items: readonly (readonly [string, number])[] = otherTotal > 0
    ? [...topSlice, ['Other', otherTotal] as const]
    : topSlice;

  return <SingleDonut items={items} total={grandTotal} colorOffset={0} />;
}

// ── Compact playlist card for Overview reference grid ─────────────────────────

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
      className="w-full min-w-0 text-left rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:border-primary/30 hover:bg-[var(--color-surface-hover)] transition-all px-4 py-3 group"
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'w-16 h-16 rounded-xl flex items-center justify-center shrink-0 border border-primary/10 shadow-inner',
            playlist.is_folder ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary',
          )}
        >
          {playlist.is_folder ? <FolderOpen size={26} /> : <Music size={26} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-base leading-snug truncate group-hover:text-primary transition-colors">
            {label}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono mt-1">
            {playlist.track_count.toLocaleString()} tracks
          </p>
          {playlist.top_genres?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {playlist.top_genres.slice(0, 2).map((genre) => (
                <span key={genre} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black px-2 py-0.5 text-[9px] font-semibold text-foreground">
                  <span className="w-1 h-1 rounded-full shrink-0 bg-foreground/70" />
                  {genre}
                </span>
              ))}
              {playlist.top_genres.length > 2 && (
                <span className="text-[9px] text-muted-foreground font-semibold">
                  +{playlist.top_genres.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Reference-layout dashboard pieces ─────────────────────────────────────────

const RECENT_BARS = [18, 30, 24, 42, 34, 58, 48, 72, 54, 82, 66, 92, 76, 64, 88, 98];

function DesktopLibraryHero({
  latestImport,
  profile,
  topGenres,
  mostCommonBpm,
  mostCommonKey,
  largestPlaylistName,
  onImport,
  onResumeAnalysis,
}: {
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  topGenres: readonly (readonly [string, number])[];
  mostCommonBpm: number | null;
  mostCommonKey: string | null;
  largestPlaylistName: string | null;
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
}) {
  const { volumeName } = useUsbConnection();
  const [heroBg, setHeroBg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBgUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (heroBg) URL.revokeObjectURL(heroBg);
    setHeroBg(URL.createObjectURL(file));
    e.target.value = '';
  }, [heroBg]);

  const lastImport = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  const analysisStatus = latestImport.analysis_status;
  const analysisTotal = latestImport.analysis_expected_track_count || latestImport.track_count;
  const analysisParsed = latestImport.analysis_parsed_track_count ?? 0;
  const analysisPercent = analysisStatus === 'completed' ? 100
    : analysisTotal > 0 ? Math.round((analysisParsed / analysisTotal) * 100) : 0;
  const showAnalysisWarning = analysisStatus && analysisStatus !== 'not_requested' && analysisStatus !== 'completed';
  const isAmber = analysisStatus === 'partial' || analysisStatus === 'awaiting_upload' || analysisStatus === 'uploading';
  const isActionable = analysisStatus === 'partial' || analysisStatus === 'failed' || analysisStatus === 'awaiting_upload' || analysisStatus === 'uploading';
  const analyzedCount = analysisStatus === 'completed' ? analysisTotal : analysisParsed;

  return (
    <section
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] min-h-[218px]',
        !heroBg && 'bg-[linear-gradient(105deg,rgba(2,12,25,0.98)_0%,rgba(3,25,52,0.95)_50%,rgba(2,11,24,0.98)_100%)]',
      )}
      style={heroBg ? { backgroundImage: `url(${heroBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_58%_20%,rgba(16,103,220,0.42),transparent_34%),radial-gradient(circle_at_82%_38%,rgba(24,94,190,0.20),transparent_30%),linear-gradient(to_top,rgba(1,7,17,0.92),transparent_58%)]" />
      <div className="absolute -bottom-12 left-[35%] h-36 w-[52%] rounded-[50%] bg-black/30 blur-2xl pointer-events-none" />

      {/* Hover-reveal controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {heroBg && (
          <button
            onClick={() => { URL.revokeObjectURL(heroBg); setHeroBg(null); }}
            className="rounded-full bg-black/60 backdrop-blur-sm p-2 text-white hover:bg-black/80 transition-colors"
            aria-label="Remove background image"
          >
            <Undo size={16} />
          </button>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full bg-black/60 backdrop-blur-sm p-2 text-white hover:bg-black/80 transition-colors"
          aria-label="Change background image"
        >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 13H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M12 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M19 10H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M2 13.3636C2 10.2994 2 8.76721 2.74902 7.6666C3.07328 7.19014 3.48995 6.78104 3.97524 6.46268C4.69555 5.99013 5.59733 5.82123 6.978 5.76086C7.63685 5.76086 8.20412 5.27068 8.33333 4.63636C8.52715 3.68489 9.37805 3 10.3663 3H13.6337C14.6219 3 15.4728 3.68489 15.6667 4.63636C15.7959 5.27068 16.3631 5.76086 17.022 5.76086C18.4027 5.82123 19.3044 5.99013 20.0248 6.46268C20.51 6.78104 20.9267 7.19014 21.251 7.6666C22 8.76721 22 10.2994 22 13.3636C22 16.4279 22 17.9601 21.251 19.0607C20.9267 19.5371 20.51 19.9462 20.0248 20.2646C18.9038 21 17.3433 21 14.2222 21H9.77778C6.65675 21 5.09624 21 3.97524 20.2646C3.48995 19.9462 3.07328 19.5371 2.74902 19.0607C2.53746 18.7498 2.38566 18.4045 2.27673 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/avif"
        className="hidden"
        onChange={handleBgUpload}
      />

      <div className="relative z-10 flex items-center min-h-[218px] px-8 py-7 gap-6">

        {/* USB Import */}
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.04] px-4 py-3 min-w-[216px] shrink-0">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-2">USB Import</p>
          <div className="flex items-center gap-2">
            <CheckmarkFilled size={14} className="text-emerald-500 shrink-0" />
            <span className="font-black text-sm leading-none text-emerald-500">Import Complete</span>
          </div>
          <ControlButton variant="neutral" onClick={onImport} className="mt-3 w-full text-[10px]">
            <Upload size={11} /> Import Library
          </ControlButton>
          <div className="grid grid-cols-1 gap-y-2 mt-3">
            {latestImport.device_name && (
              <div className="flex items-center gap-1.5 min-w-0">
                <Usb size={11} className="text-muted-foreground shrink-0" />
                <span className="text-[10px] text-muted-foreground truncate">USB</span>
                <span className="text-[10px] font-bold font-mono ml-auto shrink-0">{latestImport.device_name}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              <Calendar size={11} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate">Last Import</span>
              <span className="text-[10px] font-bold font-mono ml-auto shrink-0">{lastImport}</span>
            </div>
          </div>
        </div>

        {/* Track Analysis */}
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.04] px-4 py-3 min-w-[216px] shrink-0">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-2">Track Analysis</p>
          {showAnalysisWarning ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <WarningAlt size={13} className={isAmber ? 'text-amber-400 shrink-0' : 'text-red-400 shrink-0'} />
                <span className={cn('font-black text-sm leading-none', isAmber ? 'text-amber-400' : 'text-red-400')}>
                  {ANALYSIS_TITLES[analysisStatus ?? ''] ?? 'Analysis Issue'}
                </span>
              </div>
              {isActionable && onResumeAnalysis && (
                <ControlButton variant="neutral" onClick={() => onResumeAnalysis(latestImport.id)} className="mt-1 w-full text-[10px]">
                  <Renew size={11} /> Resume Analysis
                </ControlButton>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <CheckmarkFilled size={14} className="text-emerald-500 shrink-0" />
              <span className="font-black text-sm leading-none text-emerald-500">Analysis Complete</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
            {[
              { icon: RecordingFilled, label: 'Status', value: { completed: 'Completed', partial: 'Partial', failed: 'Failed', in_progress: 'In Progress', awaiting_upload: 'Awaiting Upload', uploading: 'Uploading', not_requested: 'Not Started' }[analysisStatus ?? ''] ?? '—' },
              { icon: Waveform, label: 'Analyzed', value: analyzedCount.toLocaleString() },
              { icon: Music, label: 'Tracks', value: analysisTotal.toLocaleString() },
              { icon: ChartBar, label: 'Progress', value: `${analysisPercent}%` },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-1.5 min-w-0">
                <Icon size={11} className="text-muted-foreground shrink-0" />
                <span className="text-[10px] text-muted-foreground truncate">{label}</span>
                <span className="text-[10px] font-bold font-mono ml-auto shrink-0">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {[
          {
            label: 'Main BPM',
            value: mostCommonBpm != null ? `${mostCommonBpm}` : '—',
            icon: (
              <svg viewBox="0 0 256 256" className="w-5 h-5 mb-2 text-muted-foreground" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M64.458 228.867c-.428 2.167 1.007 3.91 3.226 3.893l121.557-.938c2.21-.017 3.68-1.794 3.284-3.97l-11.838-64.913c-.397-2.175-1.626-2.393-2.747-.487l-9.156 15.582c-1.12 1.907-1.71 5.207-1.313 7.388l4.915 27.03c.395 2.175-1.072 3.937-3.288 3.937H88.611c-2.211 0-3.659-1.755-3.233-3.92L114.85 62.533l28.44-.49 11.786 44.43c.567 2.139 2.01 2.386 3.236.535l8.392-12.67c1.22-1.843 1.73-5.058 1.139-7.185l-9.596-34.5c-1.184-4.257-5.735-7.677-10.138-7.638l-39.391.349c-4.415.039-8.688 3.584-9.544 7.912L64.458 228.867z"/>
                <path fillRule="evenodd" d="M118.116 198.935c-1.182 1.865-.347 3.377 1.867 3.377h12.392c2.214 0 4.968-1.524 6.143-3.39l64.55-102.463c1.18-1.871 3.906-3.697 6.076-4.074l9.581-1.667c2.177-.379 4.492-2.38 5.178-4.496l4.772-14.69c.683-2.104-.063-5.034-1.677-6.555L215.53 54.173c-1.609-1.517-4.482-1.862-6.4-.78l-11.799 6.655c-1.925 1.086-3.626 3.754-3.799 5.954l-.938 11.967c-.173 2.202-1.27 5.498-2.453 7.363l-72.026 113.603z"/>
              </svg>
            ),
          },
          {
            label: 'Main Key',
            value: mostCommonKey ? formatKey(mostCommonKey) : '—',
            icon: (
              <svg viewBox="0 0 47 47" className="w-5 h-5 mb-2 text-muted-foreground" fill="currentColor" aria-hidden="true">
                <path d="M40.975,1.968c-0.706-0.706-1.851-0.706-2.558,0c-0.706,0.706-0.706,1.85,0,2.557c5.81,5.813,5.81,15.27,0,21.081c-0.706,0.707-0.706,1.852,0,2.558c0.354,0.353,0.816,0.528,1.278,0.528s0.926-0.176,1.279-0.528C48.191,20.94,48.192,9.19,40.975,1.968z"/>
                <path d="M36.539,6.399c-0.707-0.707-1.85-0.707-2.556,0c-0.707,0.706-0.707,1.851,0,2.556c3.368,3.368,3.368,8.848-0.001,12.216c-0.706,0.706-0.706,1.851,0.001,2.558c0.353,0.352,0.814,0.528,1.278,0.528c0.463,0,0.926-0.177,1.278-0.53C41.316,18.95,41.316,11.176,36.539,6.399z"/>
                <path d="M8.583,4.524c0.706-0.707,0.706-1.851,0-2.557c-0.707-0.705-1.851-0.706-2.557,0c-7.218,7.223-7.217,18.973,0,26.193c0.353,0.354,0.816,0.529,1.279,0.529c0.463,0,0.925-0.176,1.278-0.529c0.706-0.706,0.706-1.852,0-2.557C2.772,19.793,2.772,10.336,8.583,4.524z"/>
                <path d="M13.016,8.955c0.707-0.706,0.707-1.851,0-2.556c-0.706-0.707-1.85-0.707-2.556,0c-4.777,4.777-4.777,12.551,0,17.33c0.353,0.353,0.816,0.529,1.279,0.529c0.463,0,0.925-0.177,1.278-0.529c0.707-0.707,0.707-1.851,0.001-2.557C9.647,17.803,9.647,12.323,13.016,8.955z"/>
                <path d="M29.525,0c-1.331,0-2.411,1.079-2.411,2.41v18.077c0,1.994-1.622,3.615-3.615,3.615c-1.993,0-3.615-1.622-3.615-3.615V2.41c0-1.331-1.08-2.41-2.411-2.41s-2.41,1.079-2.41,2.41v18.077c0,3.813,2.546,7.041,6.026,8.082V44.59c0,1.331,1.079,2.41,2.41,2.41c1.331,0,2.41-1.079,2.41-2.41V28.568c3.48-1.041,6.026-4.268,6.026-8.082V2.41C31.936,1.079,30.856,0,29.525,0z"/>
              </svg>
            ),
          },
          {
            label: 'Main Genre',
            value: topGenres[0]?.[0] ?? '—',
            icon: (
              <svg viewBox="0 0 398.508 398.508" className="w-5 h-5 mb-2 text-muted-foreground" fill="currentColor" aria-hidden="true">
                <path d="M314.38,157.492c-23.028,0-41.763,18.734-41.763,41.762c0,23.028,18.734,41.762,41.763,41.762c23.027,0,41.762-18.734,41.762-41.762C356.142,176.227,337.408,157.492,314.38,157.492z M314.38,222.016c-12.552,0-22.763-10.211-22.763-22.762s10.211-22.762,22.763-22.762c12.551,0,22.762,10.211,22.762,22.762S326.931,222.016,314.38,222.016z"/>
                <path d="M314.38,314.984c-23.028,0-41.763,18.734-41.763,41.762s18.734,41.762,41.763,41.762c23.027,0,41.762-18.734,41.762-41.762S337.408,314.984,314.38,314.984z M314.38,379.508c-12.552,0-22.763-10.211-22.763-22.762s10.211-22.762,22.763-22.762c12.551,0,22.762,10.211,22.762,22.762S326.931,379.508,314.38,379.508z"/>
                <path d="M314.38,83.524c23.027,0,41.762-18.734,41.762-41.762C356.142,18.734,337.408,0,314.38,0c-23.028,0-41.763,18.734-41.763,41.762C272.618,64.79,291.352,83.524,314.38,83.524z M314.38,19c12.551,0,22.762,10.211,22.762,22.762s-10.211,22.762-22.762,22.762c-12.552,0-22.763-10.211-22.763-22.762S301.829,19,314.38,19z"/>
                <path d="M255.517,51.262c5.247,0,9.5-4.253,9.5-9.5s-4.253-9.5-9.5-9.5h-35.998c-5.247,0-9.5,4.253-9.5,9.5v147.992h-24.999c-5.247,0-9.5,4.253-9.5,9.5s4.253,9.5,9.5,9.5h24.999v147.992c0,5.247,4.253,9.5,9.5,9.5h35.998c5.247,0,9.5-4.253,9.5-9.5s-4.253-9.5-9.5-9.5h-26.498V208.754h26.498c5.247,0,9.5-4.253,9.5-9.5s-4.253-9.5-9.5-9.5h-26.498V51.262H255.517z"/>
                <path d="M125.989,142.508c8.234-7.633,13.4-18.531,13.4-30.617c0-23.028-18.734-41.762-41.762-41.762S55.865,88.863,55.865,111.89c0,12.086,5.166,22.984,13.4,30.617c-16.1,9.669-26.899,27.297-26.899,47.406v41.971c0,9.296,5.544,17.322,13.5,20.944v56.76c0,10.361,8.43,18.791,18.791,18.791h45.942c10.361,0,18.791-8.43,18.791-18.791v-56.76c7.955-3.623,13.499-11.648,13.499-20.944v-41.971C152.889,169.805,142.089,152.176,125.989,142.508z M74.865,111.89c0-12.551,10.211-22.762,22.762-22.762s22.762,10.211,22.762,22.762s-10.211,22.762-22.762,22.762S74.865,124.441,74.865,111.89z M133.889,231.885c0,2.205-1.794,3.999-3.999,3.999c-5.247,0-9.5,4.253-9.5,9.5v63.997h-13.262v-54.932c0-5.247-4.253-9.5-9.5-9.5s-9.5,4.253-9.5,9.5v54.932H74.866l0-63.997c0-5.247-4.253-9.5-9.5-9.5c-2.205,0-3.999-1.794-3.999-3.999v-41.971c0-19.994,16.267-36.261,36.261-36.261s36.261,16.267,36.261,36.261V231.885z"/>
              </svg>
            ),
          },
        ].map(({ label, value, icon }) => (
          <div key={label} className="flex-1 flex flex-col items-center justify-center text-center border-l border-white/[0.07] self-stretch px-4">
            {icon}
            <p className="text-3xl font-black tabular-nums leading-none tracking-tight truncate">{value}</p>
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold mt-1.5">{label}</p>
          </div>
        ))}

      </div>
    </section>
  );
}

function OverviewSummaryCards({
  latestImport,
  playlists,
  recentTracks,
  mostCommonBpm,
  mostCommonKey,
}: {
  latestImport: RekordboxImport;
  playlists: PlaylistWithCount[];
  recentTracks: RekordboxTrack[];
  mostCommonBpm: number | null;
  mostCommonKey: string | null;
}) {
  const playlistCount = playlists.filter((p) => !p.is_folder).length;
  const playlistTrackCount = latestImport.playlist_track_count || playlists.reduce(
    (total, p) => total + (p.is_folder ? 0 : p.track_count), 0,
  );
  const analysisTotal = latestImport.analysis_expected_track_count || latestImport.track_count;
  const analysisParsed = latestImport.analysis_parsed_track_count || 0;
  const analysisPercent = latestImport.analysis_status === 'completed'
    ? 100
    : analysisTotal > 0
      ? Math.max(0, Math.min(100, Math.round((analysisParsed / analysisTotal) * 100)))
      : 0;
  const lastImport = new Date(latestImport.imported_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  const dailyBars = useMemo(() => {
    const counts = new Map<string, number>();
    recentTracks.forEach((t) => {
      const d = t.date_added?.slice(0, 10);
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    });
    const bars: { label: string; count: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const date = new Date(latestImport.imported_at);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      bars.push({
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: counts.get(key) ?? 0,
      });
    }
    return bars;
  }, [recentTracks, latestImport.imported_at]);

  const maxBarCount = Math.max(...dailyBars.map((b) => b.count), 1);
  const yMax = Math.ceil(maxBarCount / 5) * 5 || 10;
  const ringR = 38;
  const ringC = 2 * Math.PI * ringR;

  const DIVIDER = { background: 'rgba(255,255,255,0.08)' };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* ── Playlists ── */}
      <div className="glass rounded-2xl p-4 flex flex-col items-center text-center">
        <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M18,4H4A1,1,0,0,0,3,5V19a1,1,0,0,0,1,1H18a1,1,0,0,0,1-1V5A1,1,0,0,0,18,4ZM9,16a2,2,0,1,1,2-2A2,2,0,0,1,9,16Z" style={{fill: '#348dff', opacity: 0.35}} />
          <path d="M11,14V8a2.9,2.9,0,0,1,3,3" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
          <path d="M11,14a2,2,0,1,1-2-2A2,2,0,0,1,11,14Zm8,5V5a1,1,0,0,0-1-1H4A1,1,0,0,0,3,5V19a1,1,0,0,0,1,1H18A1,1,0,0,0,19,19Zm2-7a5,5,0,0,1-2,4V8A5,5,0,0,1,21,12Z" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
        </svg>
        <p className="mt-2 text-2xl font-black tabular-nums leading-none">{playlistCount}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Playlists</p>
        <div className="mt-3 w-full h-px" style={DIVIDER} />
        <p className="mt-3 text-2xl font-black tabular-nums leading-none">{playlistTrackCount.toLocaleString()}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Total Tracks</p>
      </div>

      {/* ── Library Stats ── */}
      <div className="glass rounded-2xl p-4 flex flex-col items-center text-center">
        <div className="relative w-[68px] h-[68px] shrink-0">
          <svg viewBox="0 0 100 100" width={68} height={68}>
            <circle cx="50" cy="50" r={ringR} fill="none" stroke="#27272a" strokeWidth="9" />
            <circle
              cx="50" cy="50" r={ringR}
              fill="none"
              stroke="#22c55e"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${ringC * analysisPercent / 100} ${ringC}`}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-black leading-none tabular-nums">{analysisPercent}%</span>
            <span className="text-[8px] text-muted-foreground mt-0.5">Analyzed</span>
          </div>
        </div>
        <div className="mt-3 w-full h-px" style={DIVIDER} />
        <div className="mt-3 w-full space-y-2">
          {([
            { label: 'Total Tracks', value: latestImport.track_count.toLocaleString(), Icon: Music },
            { label: 'Most Common BPM', value: mostCommonBpm != null ? `${mostCommonBpm} BPM` : '—', Icon: Waveform },
            { label: 'Most Common Key', value: mostCommonKey ? formatKey(mostCommonKey) : '—', Icon: Tag },
          ] as const).map(({ label, value, Icon }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon size={11} className="text-muted-foreground shrink-0" />
                <p className="text-[10px] text-muted-foreground truncate">{label}</p>
              </div>
              <p className="text-[11px] font-black leading-none shrink-0">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Recently Added ── */}
      <div className="glass rounded-2xl p-4 flex flex-col items-center text-center">
        <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M7,19a2,2,0,1,1-2-2A2,2,0,0,1,7,19ZM9,7l2,2h8V4a1,1,0,0,0-1-1H6A1,1,0,0,0,5,4V7Z" style={{fill: '#348dff', opacity: 0.35}} />
          <path d="M10,16a2.9,2.9,0,0,0-3-3v6" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
          <path d="M3,13V8A1,1,0,0,1,4,7H9l2,2h9a1,1,0,0,1,1,1V20a1,1,0,0,1-1,1H11" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
          <path d="M7,19a2,2,0,1,1-2-2A2,2,0,0,1,7,19ZM9,7l2,2h8V4a1,1,0,0,0-1-1H6A1,1,0,0,0,5,4V7Z" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
        </svg>
        <p className="mt-2 text-2xl font-black tabular-nums leading-none">{recentTracks.length}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Tracks Added</p>
        <div className="mt-3 w-full h-px" style={DIVIDER} />
        <div className="mt-3 w-full relative flex gap-1 h-[56px]">
          {dailyBars.map((bar, i) => {
            const pct = bar.count / yMax;
            const t = i / Math.max(dailyBars.length - 1, 1);
            const r = Math.round(99 + (236 - 99) * t);
            const g = Math.round(102 + (72 - 102) * t);
            const b = Math.round(241 + (153 - 241) * t);
            return (
              <div key={i} className="flex-1 flex items-end">
                <div className="w-full rounded-t-sm" style={{ height: `${Math.max(4, pct * 100)}%`, background: `rgb(${r},${g},${b})` }} />
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">{lastImport}</p>
      </div>

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
  activeTab,
  searchQuery,
  onActiveTabChange,
  onSearchQueryChange,
}: LibraryViewProps) {

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
  const { activeTrack, status: playerStatus, playIntent, toggleTrack } = useAudioPlayer();
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

  const bpmRangeStats = useMemo((): readonly (readonly [string, number])[] => {
    const raw = libraryStats?.bpmTotals ?? [];
    const buckets = new Map<number, number>();
    for (const { bpm, count } of raw) {
      const bucket = Math.floor(bpm / 20) * 20;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + count);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([bucket, count]) => [`${bucket}–${bucket + 19}`, count] as const);
  }, [libraryStats?.bpmTotals]);

  const keyStats = useMemo((): readonly (readonly [string, number])[] =>
    (libraryStats?.keyTotals ?? [])
      .map(({ name, count }) => [formatKey(name), count] as const)
      .sort(([, a], [, b]) => b - a),
  [libraryStats?.keyTotals]);

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
    <div className="md:max-w-7xl md:mx-auto">
      <AnimatePresence mode="wait">
        {showSearch ? (
          <motion.div
            key="search-results"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="space-y-4">
              <div className="relative max-w-md ml-auto">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  size={15}
                />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search library…"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  className="w-full h-10 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] pl-9 pr-3 text-xs font-medium text-foreground outline-none transition-colors focus:border-primary/50 focus:bg-[var(--color-surface-hover)]"
                />
              </div>
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
            </div>
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
                <CircleDash className="animate-spin text-primary" size={32} />
              </div>
            )}

            {!importLoading && importError && (
              <div className="text-center py-24 space-y-2">
                <p className="text-red-400 font-bold">Failed to load library</p>
                <p className="text-xs text-muted-foreground">{importError}</p>
              </div>
            )}

            {!importLoading && !importError && (
              <>
                {!latestImport && (
                  <EmptyLibrary onImport={onImport} profile={profile} />
                )}

                {latestImport && (
                  <>
                    {/* ── Sticky header: top row + tabs ── */}
                    <div className="sticky top-0 z-20 bg-background -mx-4 md:-mx-8 px-4 md:px-8 space-y-4 pb-0">

                      {/* Top row: artist card + hero */}
                      <div className="flex gap-5 items-start pt-6">
                        <div className="hidden lg:flex flex-col gap-4 w-[250px] xl:w-[268px] shrink-0">
                          <ArtistProfileCard profile={profile} latestImport={latestImport} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="hidden lg:block">
                            <DesktopLibraryHero
                              latestImport={latestImport}
                              profile={profile}
                              topGenres={topGenres}
                              mostCommonBpm={mostCommonBpm}
                              mostCommonKey={mostCommonKey}
                              largestPlaylistName={largestPlaylist?.name ?? null}
                              onImport={onImport}
                              onResumeAnalysis={onResumeAnalysis}
                            />
                          </div>
                          <div className="lg:hidden">
                            <LibraryHero
                              latestImport={latestImport}
                              profile={profile}
                              onImport={onImport}
                              onResumeAnalysis={onResumeAnalysis}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Tab bar */}
                      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-[var(--color-border-subtle)]">
                        {TABS.map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => onActiveTabChange(tab.id)}
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
                    </div>

                    {/* ── Scrollable tab content ── */}
                    <div className="mt-4">
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
                        <div className="space-y-5">

                          {/* Insights */}
                          {(topGenres.length > 0 || bpmRangeStats.length > 0 || keyStats.length > 0) && (
                            <section className="space-y-3">
                              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <ChartBar size={13} /> Insights
                              </h2>
                              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                                {topGenres.length > 0 && (
                                  <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-5">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-4">Top Genres</p>
                                    <GenreDonutChart genres={topGenres} />
                                  </div>
                                )}
                                {bpmRangeStats.length > 0 && (
                                  <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-5">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-4">BPM Ranges</p>
                                    <GenreDonutChart genres={bpmRangeStats} />
                                  </div>
                                )}
                                {keyStats.length > 0 && (
                                  <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-5">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-4">Tracks by Key</p>
                                    <GenreDonutChart genres={keyStats} />
                                  </div>
                                )}
                              </div>
                            </section>
                          )}

                          {/* Playlists */}
                          <section className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Music size={13} /> Playlists
                              </h2>
                              <ControlButton variant="ghost" onClick={() => onActiveTabChange('playlists')} className="text-[10px]" style={{ fontSize: '10px' }}>
                                View all <ChevronRight size={12} />
                              </ControlButton>
                            </div>
                            {playlistsLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <CircleDash className="animate-spin text-muted-foreground" size={20} />
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-3">
                                {playlists
                                  .filter((p) => !p.is_folder)
                                  .slice(0, 2)
                                  .map((playlist) => (
                                    <div key={playlist.id} className="w-[304px]">
                                      <OverviewPlaylistCard
                                        playlist={playlist}
                                        profile={playlistProfilesByRbId.get(playlist.rekordbox_playlist_id)}
                                        onClick={() => onPlaylistClick(playlist)}
                                      />
                                    </div>
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
                              <ControlButton variant="ghost" onClick={() => onActiveTabChange('recently-added')} className="text-[10px]" style={{ fontSize: '10px' }}>
                                View all <ChevronRight size={12} />
                              </ControlButton>
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
                              <CircleDash className="animate-spin text-muted-foreground" size={20} />
                            </div>
                          ) : playlists.length === 0 ? (
                            <div className="text-center py-10 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
                              <p className="text-muted-foreground text-sm">No playlists in this import.</p>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-3">
                              {playlists.map((playlist) => {
                                const prof = playlistProfilesByRbId.get(playlist.rekordbox_playlist_id);
                                return (
                                  <div key={playlist.id} className="w-[304px]">
                                    <PlaylistOverviewCard
                                      playlist={playlist}
                                      artworkUrl={prof?.artwork_url}
                                      displayName={prof?.display_name}
                                      onClick={() => onPlaylistClick(playlist)}
                                      onEdit={() => onEditPlaylist(playlist)}
                                    />
                                  </div>
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
                              <CircleDash className="animate-spin text-primary" size={28} />
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
                                    playIntent={playIntent}
                                    usbConnected={usbConnected}
                                    onOpen={onTrackClick}
                                    onPlay={handlePlay}
                                  />
                                ))}
                              </div>
                              {tracksHaveMore && (
                                <div className="border-t border-[var(--color-border-faint)] pt-2 flex justify-center">
                                  <ControlButton
                                    variant="neutral"
                                    onClick={() => { void loadMoreLibraryTracks(); }}
                                    disabled={tracksLoadingMore}
                                  >
                                    {tracksLoadingMore ? (
                                      <><CircleDash size={13} className="animate-spin" /> Loading more…</>
                                    ) : (
                                      `Load ${Math.min(200, libraryTrackTotal - visibleTracks.length).toLocaleString()} more…`
                                    )}
                                  </ControlButton>
                                </div>
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
                              <CircleDash className="animate-spin text-primary" size={28} />
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
                              <CircleDash className="animate-spin text-primary" size={28} />
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
                  </>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
