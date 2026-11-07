import './library-studio.css';
import { SpotifyTabIcon } from './SpotifyTabIcon';
import { useState, useMemo, useCallback, useRef, useEffect, type ElementType, type ReactNode } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';

const ANALYSIS_TITLES: Record<string, string> = {
  partial: 'Analysis Incomplete',
  failed: 'Analysis Failed',
  awaiting_upload: 'Analysis Pending',
  uploading: 'Analysis Stalled',
  parsing: 'Analysis Processing…',
};

import { motion, AnimatePresence } from 'motion/react';
import { cn, formatKey } from '../../lib/utils';
import { bpmRangeStatsFrom, keyStatsFrom } from './libraryInsights';
import { InsightBpmDistribution, InsightKeyProfile, InsightTopGenres } from './InsightCharts';
import {
  useLibraryStats,
  useRekordboxSearch,
} from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { LibraryHero } from './LibraryHero';
import type { LibraryOverviewWidgetId } from '../../lib/dashboard/libraryOverviewWidgets';
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
import { supabase } from '../../lib/supabase';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { LibraryTab } from '../../navigation/appRoutes';
import { ArrowUpRight, Calendar, ChartBar, CheckmarkFilled, ChevronLeft, ChevronRight, CircleDash, FolderOpen, Globe, LogoInstagram, LogoYoutube, Music, RecordingFilled, Renew, Tag, Undo, Upload, Usb, User, WarningAlt, Waveform } from '@carbon/icons-react';
import { Dashboard, Playlist, Time, UserMultiple } from '@carbon/icons-react';
import { TrackListing, type TrackListingColumn } from '../ui/display';
import { TrackRowPlayButton } from '../player/TrackRowPlayButton';
import { TrackRowWaveform } from '../player/TrackRowWaveform';
import { cueAnalysisReady } from '../../lib/cues/cueReadiness';
import { ControlButton, SearchControl } from '../ui/controls';
import { HeroActionButton } from './HeroActionButton';
import { SpotifyLibraryTab } from './SpotifyLibraryTab';
import { useSpotifyAvailability } from '../../hooks/useSpotifyAvailability';


const TABS: { id: LibraryTab; label: string; icon: ElementType }[] = [
  { id: 'overview', label: 'Home', icon: Dashboard },
  { id: 'playlists', label: 'Playlists', icon: Playlist },
  { id: 'recently-added', label: 'Recently Added', icon: Time },
  { id: 'tracks', label: 'Tracks', icon: Music },
  { id: 'genres', label: 'Genres', icon: Tag },
  { id: 'artists', label: 'Artists', icon: UserMultiple },
  { id: 'incomplete-analysis', label: 'Analysis Incomplete', icon: WarningAlt },
];

const SPOTIFY_TAB: { id: LibraryTab; label: string; icon: ElementType } = { id: 'spotify', label: 'Spotify', icon: SpotifyTabIcon };

export { TABS as LIBRARY_TABS, SPOTIFY_TAB };

/** Columns for the insight cards, by how many are showing, so the cards share the row evenly. */
const INSIGHT_COLUMNS: Record<number, string> = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3' };

interface LibraryViewProps {
  latestImport: RekordboxImport | null;
  importLoading: boolean;
  importError: string | null;
  /** Groups on the overview that the user has turned off in Personalization. */
  hiddenWidgets: ReadonlySet<LibraryOverviewWidgetId>;
  importId: string | null;
  profile: UserProfile | null;
  genres: UserGenrePreference[];
  spotifyAccessToken: string | null;
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
        <div className="lib-avatar-ring" />
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={profile?.display_name ?? 'Profile'}
            onError={() => setImgError(true)}
            className="w-24 h-24 rounded-full object-cover"
          />
        ) : (
          <div className="w-24 h-24 lib-avatar-fallback">
            {initials ? (
              <span className="text-[28px] font-light tracking-[-0.04em]">{initials}</span>
            ) : (
              <User size={34} className="text-primary/70" />
            )}
          </div>
        )}
      </div>
      <h1 className="text-[22px] font-light uppercase leading-tight tracking-[0.04em]">{libraryName}</h1>

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

function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.2 3.5v10.1a4.7 4.7 0 1 1-4-4.65v2.8a2 2 0 1 0 1.2 1.85V3.5h2.8Z" fill="currentColor" />
      <path d="M14.2 3.5c.45 2.35 1.8 3.75 4.3 4.1v2.75c-1.75-.05-3.15-.55-4.3-1.5V3.5Z" fill="currentColor" />
    </svg>
  );
}

export function ArtistProfileCard({
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
    <div className="lib-card px-5 py-6 text-center flex flex-col items-center justify-center min-h-[218px]">
      <div className="relative inline-block mb-4">
        <div className="lib-avatar-ring" />
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={profile?.display_name ?? 'Profile'}
            onError={() => setImgError(true)}
            className="w-24 h-24 rounded-full object-cover"
          />
        ) : (
          <div className="w-24 h-24 lib-avatar-fallback">
            {initials ? (
              <span className="text-[28px] font-light tracking-[-0.04em]">{initials}</span>
            ) : (
              <User size={34} className="text-primary/70" />
            )}
          </div>
        )}
        <span className="absolute right-0 bottom-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[var(--color-background)] shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
      </div>

      <h1 className="text-[22px] font-light uppercase leading-tight tracking-[0.04em]">{libraryName}</h1>

      {(() => {
        const links = [
          profile?.spotify_url ? { href: profile.spotify_url, label: 'Spotify', icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.313a.748.748 0 0 1-1.031.25c-2.822-1.724-6.375-2.114-10.561-1.158a.749.749 0 1 1-.333-1.462c4.579-1.045 8.507-.596 11.675 1.339a.75.75 0 0 1 .25 1.031zm1.472-3.274a.937.937 0 0 1-1.288.308c-3.226-1.983-8.143-2.558-11.963-1.4a.937.937 0 1 1-.544-1.791c4.361-1.323 9.782-.682 13.487 1.596a.937.937 0 0 1 .308 1.287zm.126-3.409c-3.868-2.297-10.249-2.509-13.944-1.388a1.124 1.124 0 1 1-.652-2.15c4.243-1.288 11.298-1.039 15.749 1.607a1.125 1.125 0 0 1-1.153 1.931z"/></svg> } : null,
          profile?.soundcloud_url ? { href: profile.soundcloud_url, label: 'SoundCloud', icon: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1.175 12.225c-.015.132-.024.265-.024.4 0 .135.009.268.024.4l-.024-.4.024.4c.133 1.162 1.11 2.063 2.3 2.063 1.276 0 2.312-1.036 2.312-2.312V8.1a.387.387 0 0 0-.387-.387.387.387 0 0 0-.387.387v4.275a1.538 1.538 0 0 1-1.538 1.538 1.538 1.538 0 0 1-1.538-1.538 1.538 1.538 0 0 1 1.538-1.538c.283 0 .549.077.775.213V8.1A2.887 2.887 0 0 0 1.364 9.9c-.13.382-.189.78-.189 1.187v1.138zm5.1 2.463V7.762a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.926a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55.387V8.475a.387.387 0 0 1 .387-.388.387.387 0 0 1 .388.388v6.6a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55 0V8.1a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.975a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55.225V7.762a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v7.538a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm1.55-.225V8.1a.387.387 0 0 1 .387-.387.387.387 0 0 1 .388.387v6.975a.387.387 0 0 1-.388.387.387.387 0 0 1-.387-.387zm2.1-.3c0 .98.795 1.775 1.775 1.775a1.776 1.776 0 0 0 1.725-1.375 3.526 3.526 0 0 0 .3.013 3.525 3.525 0 0 0 3.525-3.525A3.525 3.525 0 0 0 18.375 8.1a3.51 3.51 0 0 0-1.85.525 5.026 5.026 0 0 0-4.6-3.05 5.025 5.025 0 0 0-4.3 2.437v6.763c0 .98.795 1.775 1.775 1.775s1.775-.795 1.775-1.775V8.1a.387.387 0 0 1 .775 0v6.675z"/></svg> } : null,
          profile?.instagram_url ? { href: profile.instagram_url, label: 'Instagram', icon: <LogoInstagram size={16} /> } : null,
          profile?.tiktok_url ? { href: profile.tiktok_url, label: 'TikTok', icon: <TikTokIcon /> } : null,
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
    <div className="lib-card p-4 space-y-4">
      <p className="lib-label flex items-center gap-1.5">
        <ChartBar size={11} /> Library Health
      </p>

      <div className="lib-well px-3 py-3">
        <p className="lib-label mb-2">
          USB Import
        </p>
        <div className="flex items-center gap-2">
          <CheckmarkFilled size={14} className="text-emerald-500 shrink-0" />
          <span className="font-black text-sm leading-none text-emerald-500">Import Complete</span>
        </div>
        <ControlButton variant="primary" onClick={onImport} className="mt-3 w-full text-[10px]">
          <Upload size={11} /> Import New Library
        </ControlButton>
      </div>

      {showAnalysis && (
        <div className="lib-well px-3 py-3">
          <p className="lib-label mb-2">
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
            <ControlButton variant="primary" onClick={() => onResumeAnalysis(latestImport.id)} className="mt-3 w-full text-[10px]">
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

// ── Library track table (shared by Tracks, Recently Added, Analysis Incomplete tabs) ──

type LibrarySortCol = 'title' | 'bpm' | 'key' | 'genre' | 'duration';

export interface LibraryTrackTableProps {
  tracks: RekordboxTrack[];
  loading: boolean;
  emptyText?: string;
  getWaveformState: (id: string) => WaveformLoadState;
  retryWaveform: (ids: string[]) => void;
  activeTrack: RekordboxTrack | null | undefined;
  playerStatus: string;
  playIntent: boolean;
  usbConnected: boolean;
  onTrackClick: (t: RekordboxTrack) => void;
  onPlay: (t: RekordboxTrack, e: React.MouseEvent | React.KeyboardEvent) => void;
  footer?: React.ReactNode;
}

export function LibraryTrackTable({
  tracks,
  loading,
  emptyText,
  getWaveformState,
  retryWaveform,
  activeTrack,
  onTrackClick,
  footer,
}: LibraryTrackTableProps) {
  const [sortCol, setSortCol] = useState<LibrarySortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function handleColClick(col: LibrarySortCol) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const sortedTracks = useMemo(() => {
    if (!sortCol) return tracks;
    return [...tracks].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortCol === 'title') { av = a.title ?? ''; bv = b.title ?? ''; }
      else if (sortCol === 'bpm') { av = a.bpm ?? -1; bv = b.bpm ?? -1; }
      else if (sortCol === 'key') { av = formatCamelotKey(a.musical_key); bv = formatCamelotKey(b.musical_key); }
      else if (sortCol === 'genre') { av = a.genre ?? ''; bv = b.genre ?? ''; }
      else if (sortCol === 'duration') {
        av = a.duration_ms ?? (a.duration_seconds != null ? a.duration_seconds * 1000 : -1);
        bv = b.duration_ms ?? (b.duration_seconds != null ? b.duration_seconds * 1000 : -1);
      }
      if (av === null || av === bv) return 0;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [tracks, sortCol, sortDir]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <CircleDash className="animate-spin text-primary" size={28} />
      </div>
    );
  }
  if (sortedTracks.length === 0) {
    return <p className="text-center py-12 text-muted-foreground text-sm">{emptyText ?? 'No tracks.'}</p>;
  }

  const columns: TrackListingColumn<RekordboxTrack>[] = [
    { id: 'bpm', label: 'BPM', sort: 'bpm', cellClassName: 'font-mono text-[13px] font-bold tabular-nums', render: (t) => (t.bpm != null ? t.bpm.toFixed(1) : '—') },
    { id: 'key', label: 'Key', sort: 'key', render: (t) => formatCamelotKey(t.musical_key) || '—' },
    { id: 'genre', label: 'Genre', sort: 'genre', headClassName: 'w-[178px]', cellClassName: 'w-[178px] text-xs text-muted-foreground', render: (t) => <span className="block truncate max-w-[160px]">{t.genre ?? '—'}</span> },
    { id: 'duration', label: 'Duration', sort: 'duration', headClassName: 'w-[80px] text-left', cellClassName: 'w-[80px] text-left font-mono text-[13px] text-muted-foreground', render: (t) => formatLibraryTime(t.duration_ms ?? (t.duration_seconds != null ? t.duration_seconds * 1000 : null)) },
  ];

  return (
    <div className="lib-panel">
      <TrackListing<RekordboxTrack>
        tracks={sortedTracks}
        columns={columns}
        selectedId={activeTrack?.id ?? null}
        onSelect={onTrackClick}
        getTitle={(t) => t.title}
        getArtist={(t) => t.artist}
        getStatus={(t) => (cueAnalysisReady(t) ? 'ready' : t.analysis_parse_status === 'failed' || t.analysis_parse_status === 'missing_required' ? 'error' : t.analysis_parse_status == null ? 'none' : 'warning')}
        renderLeading={(t) => <TrackRowPlayButton track={t} />}
        renderWaveform={(t) => <TrackRowWaveform track={t} waveformState={getWaveformState(t.id)} onRetry={() => retryWaveform([t.id])} />}
        rowProps={(t) => ({ 'aria-label': `Open ${t.title}${t.artist ? ` by ${t.artist}` : ''}` })}
        trackSort="title"
        sort={sortCol ? { column: sortCol, direction: sortDir } : null}
        onSort={(column) => handleColClick(column as LibrarySortCol)}
        ariaLabel="Track listing"
      />
      {footer}
    </div>
  );
}

/** The Recently Added tab: the newest tracks in a table. Shared by the Library and Artist Library pages. */
export function RecentlyAddedPanel({ tracks, loading, ...tableProps }: Omit<LibraryTrackTableProps, 'emptyText' | 'footer'>) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-mono">
        {loading ? 'Loading…' : `${tracks.length.toLocaleString()} recently added tracks`}
      </p>
      <LibraryTrackTable tracks={tracks} loading={loading} emptyText="No recently added tracks." {...tableProps} />
    </div>
  );
}

// ── Sidebar section wrapper ───────────────────────────────────────────────────

function SidebarSection({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lib-card p-4">
      <p className="flex items-center gap-1.5 lib-label mb-3">
        <Icon size={11} />
        {title}
      </p>
      {children}
    </div>
  );
}

// ── Genre donut chart ─────────────────────────────────────────────────────────

function formatCamelotKey(key: string | null | undefined): string {
  const raw = formatKey(key);
  if (!raw || raw === '—') return '';
  return raw.replace(/^(\d)([AB])$/i, (_, n, l) => `0${n}${l.toUpperCase()}`);
}

function formatLibraryTime(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
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

/** One insight column in the hero: a small heading and its chart, with a divider on the left. */
function HeroInsight({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-white/[0.07] px-3', first && 'border-l-0')}>
      <p className="mb-1.5 shrink-0 truncate text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function DesktopLibraryHero({
  latestImport,
  profile,
  topGenres,
  bpmRangeStats,
  keyStats,
  onImport,
  onResumeAnalysis,
  onShowIncompleteAnalysis,
  hiddenWidgets,
}: {
  /** Groups the user has turned off in Personalization. */
  hiddenWidgets: ReadonlySet<LibraryOverviewWidgetId>;
  latestImport: RekordboxImport;
  profile: UserProfile | null;
  topGenres: readonly (readonly [string, number])[];
  bpmRangeStats: readonly (readonly [string, number])[];
  keyStats: readonly (readonly [string, number])[];
  onImport: () => void;
  onResumeAnalysis?: (importId: string) => void;
  onShowIncompleteAnalysis?: () => void;
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
  const heroInsights: Array<{ id: string; title: string; content: ReactNode }> = [];
  if (!hiddenWidgets.has('topGenres') && topGenres.length > 0) heroInsights.push({ id: 'topGenres', title: 'Top Genres', content: <InsightTopGenres genres={topGenres} compact /> });
  if (!hiddenWidgets.has('bpmDistribution') && bpmRangeStats.length > 0) heroInsights.push({ id: 'bpmDistribution', title: 'BPM Distribution', content: <InsightBpmDistribution bpmRangeStats={bpmRangeStats} compact /> });
  if (!hiddenWidgets.has('keyProfile') && keyStats.length > 0) heroInsights.push({ id: 'keyProfile', title: 'Camelot Wheel', content: <InsightKeyProfile keyStats={keyStats} compact /> });

  return (
    <section
      className={cn(
        'group lib-hero min-h-[218px]',
      )}
      style={heroBg ? { backgroundImage: `url(${heroBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {heroBg && <div className="lib-hero-wash" />}

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

      <div className="relative z-10 flex h-[218px] items-stretch px-5 py-4 gap-4">

        {/* USB Import */}
        {!hiddenWidgets.has('usbImport') && (
        <div className="lib-well px-3 py-3 w-[200px] shrink-0">
          <p className="lib-label mb-1.5">USB Import</p>
          <div className="flex items-center gap-2">
            <CheckmarkFilled size={14} className="text-emerald-500 shrink-0" />
            <span className="font-black text-sm leading-none text-emerald-500">Import Complete</span>
          </div>
          <HeroActionButton variant="import" onClick={onImport} className="mt-2">
            <Upload size={11} /> Import Library
          </HeroActionButton>
          <div className="grid grid-cols-1 gap-y-1.5 mt-2">
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
        )}

        {/* Track Analysis */}
        {!hiddenWidgets.has('trackAnalysis') && (
        <div
          className={cn(
            'rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.04] px-3 py-3 w-[200px] shrink-0',
            showAnalysisWarning && onShowIncompleteAnalysis && 'cursor-pointer hover:bg-white/[0.07] transition-colors',
          )}
          onClick={showAnalysisWarning && onShowIncompleteAnalysis ? onShowIncompleteAnalysis : undefined}
          role={showAnalysisWarning && onShowIncompleteAnalysis ? 'button' : undefined}
        >
          <p className="lib-label mb-1.5">Track Analysis</p>
          {showAnalysisWarning ? (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <WarningAlt size={13} className={isAmber ? 'text-amber-400 shrink-0' : 'text-red-400 shrink-0'} />
                <span className={cn('font-black text-sm leading-none', isAmber ? 'text-amber-400' : 'text-red-400')}>
                  {ANALYSIS_TITLES[analysisStatus ?? ''] ?? 'Analysis Issue'}
                </span>
              </div>
              {isActionable && onResumeAnalysis && (
                <HeroActionButton variant="resume" onClick={(e) => { e.stopPropagation(); onResumeAnalysis(latestImport.id); }} className="mt-1">
                  <Renew size={11} /> Resume Analysis
                </HeroActionButton>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <CheckmarkFilled size={14} className="text-emerald-500 shrink-0" />
                <span className="font-black text-sm leading-none text-emerald-500">Analysis Complete</span>
              </div>
              <div className="mt-2 h-7" aria-hidden="true" />
            </>
          )}
          <div className="grid grid-cols-1 gap-y-1 mt-2">
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
        )}

        {/* Insights: main genre, BPM distribution, Camelot wheel. Each follows its own switch in Personalization. */}
        {heroInsights.length > 0 && (
          <div className="grid min-w-0 flex-1 self-stretch" style={{ gridTemplateColumns: `repeat(${heroInsights.length}, minmax(0, 1fr))` }} data-testid="hero-insights">
            {heroInsights.map(({ id, title, content }, index) => (
              <HeroInsight key={id} title={title} first={index === 0}>{content}</HeroInsight>
            ))}
          </div>
        )}

      </div>
    </section>
  );
}

function OverviewSummaryCards({
  latestImport,
  mostCommonBpm,
  mostCommonKey,
}: {
  latestImport: RekordboxImport;
  mostCommonBpm: number | null;
  mostCommonKey: string | null;
}) {
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

  const ringR = 38;
  const ringC = 2 * Math.PI * ringR;

  const DIVIDER = { background: 'rgba(255,255,255,0.08)' };

  return (
    <div>

      {/* ── Library Stats ── */}
      <div className="lib-card p-4 flex flex-col items-center text-center">
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

    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LibraryView({
  latestImport,
  importLoading,
  importError,
  hiddenWidgets,
  importId,
  profile,
  spotifyAccessToken,
  onTrackClick,
  onImport,
  onResumeAnalysis,
  activeTab,
  searchQuery,
  onActiveTabChange,
  onSearchQueryChange,
}: LibraryViewProps) {

  const spotifyAvailable = useSpotifyAvailability(spotifyAccessToken);

  useEffect(() => {
    if (spotifyAvailable === false && activeTab === 'spotify') {
      onActiveTabChange('overview');
    }
  }, [activeTab, onActiveTabChange, spotifyAvailable]);

  const {
    results: searchResults,
    total: searchTotal,
    loading: searchLoading,
    loadingMore: searchLoadingMore,
    hasMore: searchHasMore,
    loadMore: loadMoreSearchResults,
  } = useRekordboxSearch(importId, searchQuery);
  const { stats: libraryStats } = useLibraryStats(importId);

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

  // ── Incomplete analysis list: opened from the Track Analysis card, with a way back to the overview ──
  const isIncompleteView = activeTab === 'incomplete-analysis';
  const [incompleteTracks, setIncompleteTracks] = useState<RekordboxTrack[]>([]);
  const [incompleteFetching, setIncompleteFetching] = useState(false);

  useEffect(() => {
    if (!isIncompleteView || !importId) return;
    setIncompleteFetching(true);
    supabase
      .from('rekordbox_tracks')
      .select('*')
      .eq('import_id', importId)
      .or('analysis_parse_status.is.null,analysis_parse_status.not.in.(completed,reused)')
      .order('title')
      .then(({ data }) => {
        setIncompleteTracks((data as RekordboxTrack[]) ?? []);
        setIncompleteFetching(false);
      });
  }, [isIncompleteView, importId]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const genreStats = useMemo(
    () => (libraryStats?.genreTotals ?? []).map(({ name, count }) => [name, count] as const),
    [libraryStats?.genreTotals],
  );

  const bpmRangeStats = useMemo(() => bpmRangeStatsFrom(libraryStats?.bpmTotals), [libraryStats?.bpmTotals]);

  const keyStats = useMemo(() => keyStatsFrom(libraryStats?.keyTotals), [libraryStats?.keyTotals]);

  const topGenres = genreStats.slice(0, 8);
  // Each insight shows when the user has not hidden it and there is data for it.
  const showTopGenres = !hiddenWidgets.has('topGenres') && topGenres.length > 0;
  const showBpmDistribution = !hiddenWidgets.has('bpmDistribution') && bpmRangeStats.length > 0;
  const showKeyProfile = !hiddenWidgets.has('keyProfile') && keyStats.length > 0;
  const insightCount = [showTopGenres, showBpmDistribution, showKeyProfile].filter(Boolean).length;

  const searchResultIds = useMemo(
    () => (showSearch ? searchResults.map((t) => t.id) : []),
    [showSearch, searchResults],
  );

  const incompleteTrackIds = useMemo(
    () => incompleteTracks.map((t) => t.id),
    [incompleteTracks],
  );

  const waveformIds = useMemo(() => {
    if (showSearch) return searchResultIds;
    if (isIncompleteView) return incompleteTrackIds;
    return [];
  }, [showSearch, searchResultIds, isIncompleteView, incompleteTrackIds]);

  const {
    states: waveformStates,
    retry: retryWaveform,
    getState: getWaveformState,
  } = useTrackPreviewWaveforms(importId, waveformIds);

  return (
    <div className="lib-scope min-w-0" data-testid="library-overview">
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
              <div className="max-w-md ml-auto">
                <SearchControl
                  autoFocus
                  placeholder="Search library…"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  aria-label="Search library"
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
                {!latestImport && !spotifyAvailable && (
                  <EmptyLibrary onImport={onImport} profile={profile} />
                )}

                {!latestImport && spotifyAvailable && spotifyAccessToken && (
                  <div className="space-y-4">
                    <div className="lib-tabs lib-sticky sticky top-0 z-20 -mx-4 px-4 md:-mx-8 md:px-8">
                      {[TABS[0], SPOTIFY_TAB].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => onActiveTabChange(tab.id)}
                          role="tab"
                          aria-selected={activeTab === tab.id}
                          className="lib-tab"
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    {activeTab === 'spotify'
                      ? <SpotifyLibraryTab accessToken={spotifyAccessToken} />
                      : <EmptyLibrary onImport={onImport} profile={profile} />}
                  </div>
                )}

                {latestImport && (
                  <>
                    {/* ── Sticky header: top row + tabs ── */}
                    <div className="sticky top-0 z-20 lib-sticky -mx-4 md:-mx-8 px-4 md:px-8 space-y-4 pb-3">

                      {/* Top row: artist card + hero */}
                      <div className="flex gap-5 items-start">
                        <div className="hidden lg:flex flex-col gap-4 w-[250px] xl:w-[268px] shrink-0">
                          <ArtistProfileCard profile={profile} latestImport={latestImport} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="hidden lg:block">
                            <DesktopLibraryHero
                              latestImport={latestImport}
                              profile={profile}
                              topGenres={topGenres}
                              bpmRangeStats={bpmRangeStats}
                              keyStats={keyStats}
                              hiddenWidgets={hiddenWidgets}
                              onImport={onImport}
                              onResumeAnalysis={onResumeAnalysis}
                              onShowIncompleteAnalysis={() => onActiveTabChange('incomplete-analysis')}
                            />
                          </div>
                          <div className="lg:hidden">
                            <LibraryHero
                              latestImport={latestImport}
                              profile={profile}
                              hiddenWidgets={hiddenWidgets}
                              onImport={onImport}
                              onResumeAnalysis={onResumeAnalysis}
                            />
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* ── Scrollable tab content ── */}
                    <div className="mt-4">
                    <AnimatePresence mode="wait">
                    <motion.div
                      key={isIncompleteView ? 'incomplete-analysis' : 'overview'}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >

                      {/* ── OVERVIEW ── */}
                      {!isIncompleteView && (
                        <div className="space-y-5">

                          {/* Insights */}
                          {insightCount > 0 && (
                            <section className="space-y-3" data-testid="library-insights">
                              <h2 className="lib-heading">
                                <ChartBar size={13} /> Insights
                              </h2>
                              <div className={cn('grid grid-cols-1 gap-3', INSIGHT_COLUMNS[insightCount])}>
                                {showTopGenres && (
                                  <div className="lib-card p-5 flex flex-col h-[280px] overflow-hidden">
                                    <p className="lib-label mb-1.5 flex items-center gap-1.5 shrink-0">
                                      <svg viewBox="0 0 398.508 398.508" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden="true">
                                        <path d="M314.38,157.492c-23.028,0-41.763,18.734-41.763,41.762c0,23.028,18.734,41.762,41.763,41.762c23.027,0,41.762-18.734,41.762-41.762C356.142,176.227,337.408,157.492,314.38,157.492z M314.38,222.016c-12.552,0-22.763-10.211-22.763-22.762s10.211-22.762,22.763-22.762c12.551,0,22.762,10.211,22.762,22.762S326.931,222.016,314.38,222.016z"/><path d="M314.38,314.984c-23.028,0-41.763,18.734-41.763,41.762s18.734,41.762,41.763,41.762c23.027,0,41.762-18.734,41.762-41.762S337.408,314.984,314.38,314.984z M314.38,379.508c-12.552,0-22.763-10.211-22.763-22.762s10.211-22.762,22.763-22.762c12.551,0,22.762,10.211,22.762,22.762S326.931,379.508,314.38,379.508z"/><path d="M314.38,83.524c23.027,0,41.762-18.734,41.762-41.762C356.142,18.734,337.408,0,314.38,0c-23.028,0-41.763,18.734-41.763,41.762C272.618,64.79,291.352,83.524,314.38,83.524z M314.38,19c12.551,0,22.762,10.211,22.762,22.762s-10.211,22.762-22.762,22.762c-12.552,0-22.763-10.211-22.763-22.762S301.829,19,314.38,19z"/><path d="M255.517,51.262c5.247,0,9.5-4.253,9.5-9.5s-4.253-9.5-9.5-9.5h-35.998c-5.247,0-9.5,4.253-9.5,9.5v147.992h-24.999c-5.247,0-9.5,4.253-9.5,9.5s4.253,9.5,9.5,9.5h24.999v147.992c0,5.247,4.253,9.5,9.5,9.5h35.998c5.247,0,9.5-4.253,9.5-9.5s-4.253-9.5-9.5-9.5h-26.498V208.754h26.498c5.247,0,9.5-4.253,9.5-9.5s-4.253-9.5-9.5-9.5h-26.498V51.262H255.517z"/><path d="M125.989,142.508c8.234-7.633,13.4-18.531,13.4-30.617c0-23.028-18.734-41.762-41.762-41.762S55.865,88.863,55.865,111.89c0,12.086,5.166,22.984,13.4,30.617c-16.1,9.669-26.899,27.297-26.899,47.406v41.971c0,9.296,5.544,17.322,13.5,20.944v56.76c0,10.361,8.43,18.791,18.791,18.791h45.942c10.361,0,18.791-8.43,18.791-18.791v-56.76c7.955-3.623,13.499-11.648,13.499-20.944v-41.971C152.889,169.805,142.089,152.176,125.989,142.508z M74.865,111.89c0-12.551,10.211-22.762,22.762-22.762s22.762,10.211,22.762,22.762s-10.211,22.762-22.762,22.762S74.865,124.441,74.865,111.89z M133.889,231.885c0,2.205-1.794,3.999-3.999,3.999c-5.247,0-9.5,4.253-9.5,9.5v63.997h-13.262v-54.932c0-5.247-4.253-9.5-9.5-9.5s-9.5,4.253-9.5,9.5v54.932H74.866l0-63.997c0-5.247-4.253-9.5-9.5-9.5c-2.205,0-3.999-1.794-3.999-3.999v-41.971c0-19.994,16.267-36.261,36.261-36.261s36.261,16.267,36.261,36.261V231.885z"/>
                                      </svg>
                                      Top Genres
                                    </p>
                                    <InsightTopGenres genres={topGenres} />
                                  </div>
                                )}
                                {showBpmDistribution && (
                                  <div className="lib-card p-5 flex flex-col h-[280px] overflow-hidden">
                                    <p className="lib-label mb-1.5 flex items-center gap-1.5 shrink-0">
                                      <svg viewBox="0 0 256 256" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden="true">
                                        <path fillRule="evenodd" d="M64.458 228.867c-.428 2.167 1.007 3.91 3.226 3.893l121.557-.938c2.21-.017 3.68-1.794 3.284-3.97l-11.838-64.913c-.397-2.175-1.626-2.393-2.747-.487l-9.156 15.582c-1.12 1.907-1.71 5.207-1.313 7.388l4.915 27.03c.395 2.175-1.072 3.937-3.288 3.937H88.611c-2.211 0-3.659-1.755-3.233-3.92L114.85 62.533l28.44-.49 11.786 44.43c.567 2.139 2.01 2.386 3.236.535l8.392-12.67c1.22-1.843 1.73-5.058 1.139-7.185l-9.596-34.5c-1.184-4.257-5.735-7.677-10.138-7.638l-39.391.349c-4.415.039-8.688 3.584-9.544 7.912L64.458 228.867z"/><path fillRule="evenodd" d="M118.116 198.935c-1.182 1.865-.347 3.377 1.867 3.377h12.392c2.214 0 4.968-1.524 6.143-3.39l64.55-102.463c1.18-1.871 3.906-3.697 6.076-4.074l9.581-1.667c2.177-.379 4.492-2.38 5.178-4.496l4.772-14.69c.683-2.104-.063-5.034-1.677-6.555L215.53 54.173c-1.609-1.517-4.482-1.862-6.4-.78l-11.799 6.655c-1.925 1.086-3.626 3.754-3.799 5.954l-.938 11.967c-.173 2.202-1.27 5.498-2.453 7.363l-72.026 113.603z"/>
                                      </svg>
                                      BPM Distribution
                                    </p>
                                    <InsightBpmDistribution bpmRangeStats={bpmRangeStats} />
                                  </div>
                                )}
                                {showKeyProfile && (
                                  <div className="lib-card p-5 flex flex-col h-[280px] overflow-hidden">
                                    <p className="lib-label mb-1.5 flex items-center gap-1.5 shrink-0">
                                      <svg viewBox="0 0 47 47" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden="true">
                                        <path d="M40.975,1.968c-0.706-0.706-1.851-0.706-2.558,0c-0.706,0.706-0.706,1.85,0,2.557c5.81,5.813,5.81,15.27,0,21.081c-0.706,0.707-0.706,1.852,0,2.558c0.354,0.353,0.816,0.528,1.278,0.528s0.926-0.176,1.279-0.528C48.191,20.94,48.192,9.19,40.975,1.968z"/><path d="M36.539,6.399c-0.707-0.707-1.85-0.707-2.556,0c-0.707,0.706-0.707,1.851,0,2.556c3.368,3.368,3.368,8.848-0.001,12.216c-0.706,0.706-0.706,1.851,0.001,2.558c0.353,0.352,0.814,0.528,1.278,0.528c0.463,0,0.926-0.177,1.278-0.53C41.316,18.95,41.316,11.176,36.539,6.399z"/><path d="M8.583,4.524c0.706-0.707,0.706-1.851,0-2.557c-0.707-0.705-1.851-0.706-2.557,0c-7.218,7.223-7.217,18.973,0,26.193c0.353,0.354,0.816,0.529,1.279,0.529c0.463,0,0.925-0.176,1.278-0.529c0.706-0.706,0.706-1.852,0-2.557C2.772,19.793,2.772,10.336,8.583,4.524z"/><path d="M13.016,8.955c0.707-0.706,0.707-1.851,0-2.556c-0.706-0.707-1.85-0.707-2.556,0c-4.777,4.777-4.777,12.551,0,17.33c0.353,0.353,0.816,0.529,1.279,0.529c0.463,0,0.925-0.177,1.278-0.529c0.707-0.707,0.707-1.851,0.001-2.557C9.647,17.803,9.647,12.323,13.016,8.955z"/><path d="M29.525,0c-1.331,0-2.411,1.079-2.411,2.41v18.077c0,1.994-1.622,3.615-3.615,3.615c-1.993,0-3.615-1.622-3.615-3.615V2.41c0-1.331-1.08-2.41-2.411-2.41s-2.41,1.079-2.41,2.41v18.077c0,3.813,2.546,7.041,6.026,8.082V44.59c0,1.331,1.079,2.41,2.41,2.41c1.331,0,2.41-1.079,2.41-2.41V28.568c3.48-1.041,6.026-4.268,6.026-8.082V2.41C31.936,1.079,30.856,0,29.525,0z"/>
                                      </svg>
                                      Key Profile (Camelot Wheel)
                                    </p>
                                    <InsightKeyProfile keyStats={keyStats} />
                                  </div>
                                )}
                              </div>
                            </section>
                          )}

                        </div>
                      )}

                      {/* ── ANALYSIS INCOMPLETE ── */}
                      {isIncompleteView && (
                        <div className="space-y-3">
                          <ControlButton variant="ghost" onClick={() => onActiveTabChange('overview')} data-testid="incomplete-back">
                            <ChevronLeft size={14} /> Back to home
                          </ControlButton>
                          <p className="text-xs text-muted-foreground font-mono">
                            {incompleteFetching
                              ? 'Loading…'
                              : `${incompleteTracks.length.toLocaleString()} tracks with incomplete analysis`}
                          </p>
                          <LibraryTrackTable
                            tracks={incompleteTracks}
                            loading={incompleteFetching}
                            emptyText="No tracks with incomplete analysis."
                            getWaveformState={getWaveformState}
                            retryWaveform={retryWaveform}
                            activeTrack={activeTrack}
                            playerStatus={playerStatus}
                            playIntent={playIntent}
                            usbConnected={usbConnected}
                            onTrackClick={onTrackClick}
                            onPlay={handlePlay}
                          />
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
