import { sortRecordTracks } from '../ui/display/recordTrackSorting';
import { LibraryFilterRow, matchesLibrarySearch, recordOptions, SyncedFilterError } from './LibraryFilterRow';
import { useLibraryListingViewport } from './useLibraryListingViewport';
import { useAudioDockTracks } from '../../contexts/AudioDockWorkspaceContext';
import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useTrackPlaylistCounts } from '../../hooks/useTrackPlaylistCounts';
import { useSyncedTrackFilter } from '../../hooks/useSyncedTrackFilter';
import './library-studio.css';
import { useState, useMemo, useCallback, useEffect, type ElementType, type ReactNode } from 'react';
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
import { Activity, CheckCircle, Circle, Clock, ControlSlider, Dashboard, Folder, Group, Key, Label, MusicNote, NavArrowLeft, Playlist, Refresh, Reports, SineWave, Upload, User, WarningTriangle } from 'iconoir-react/regular';
import { PageSkeleton } from '../ui/feedback';
import { ProfileSocialLinks } from './ProfileSocialLinks';
import { LibraryGhostHero } from './LibraryGhostHero';
import { ControlButton, FilterDropdown, SearchControl } from '../ui/controls';


const TABS: { id: LibraryTab; label: string; icon: ElementType }[] = [
  { id: 'overview', label: 'Home', icon: Dashboard },
  { id: 'playlists', label: 'Playlists', icon: Playlist },
  { id: 'recently-added', label: 'Recently Added', icon: Clock },
  { id: 'tracks', label: 'Tracks', icon: MusicNote },
  { id: 'genres', label: 'Genres', icon: Label },
  { id: 'artists', label: 'Artists', icon: Group },
  { id: 'incomplete-analysis', label: 'Analysis Incomplete', icon: WarningTriangle },
];


export { TABS as LIBRARY_TABS };

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
              <User width={34} height={34} aria-hidden="true" className="text-primary/70" />
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
        Connect your Rekordbox USB drive, then import your library to get started.
      </p>
      <ControlButton variant="primary" onClick={onImport} className="w-auto">
        <Upload width={16} height={16} aria-hidden="true" />
        Import Rekordbox Library
      </ControlButton>
    </div>
  );
}

// ── Artist profile card (left column, desktop) ─────────────────────────────


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
              <User width={34} height={34} aria-hidden="true" className="text-primary/70" />
            )}
          </div>
        )}
        <span className="absolute right-0 bottom-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[var(--color-background)] shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
      </div>

      <h1 className="text-[22px] font-light uppercase leading-tight tracking-[0.04em]">{libraryName}</h1>

      <ProfileSocialLinks profile={profile} size={16} className="mt-3 justify-center" />

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
        <Reports width={11} height={11} aria-hidden="true" /> Library Health
      </p>

      <div className="lib-well px-3 py-3">
        <p className="lib-label mb-2">
          USB Import
        </p>
        <div className="flex items-center gap-2">
          <CheckCircle width={14} height={14} aria-hidden="true" className="text-emerald-500 shrink-0" />
          <span className="font-black text-sm leading-none text-emerald-500">Import Complete</span>
        </div>
        <ControlButton variant="primary" onClick={onImport} className="mt-3 w-full text-[10px]">
          <Upload width={11} height={11} aria-hidden="true" /> Import New Library
        </ControlButton>
      </div>

      {showAnalysis && (
        <div className="lib-well px-3 py-3">
          <p className="lib-label mb-2">
            Track Analysis
          </p>
          <div className="flex items-center gap-2">
            <WarningTriangle
              width={13} height={13} aria-hidden="true"
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
              <Refresh width={11} height={11} aria-hidden="true" /> Resume Analysis
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
            { icon: Circle, label: 'Status', value: statusLabel[latestImport.analysis_status ?? ''] ?? '—' },
            { icon: Activity, label: 'Analyzed', value: analyzed.toLocaleString() },
            { icon: MusicNote, label: 'Total Tracks', value: total.toLocaleString() },
            { icon: Reports, label: 'Progress', value: `${percent}%` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Icon width={13} height={13} aria-hidden="true" className="text-muted-foreground shrink-0" />
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

type LibrarySortCol = 'title' | 'bpm' | 'key' | 'genre' | 'format' | 'playlists' | 'date-added' | 'length';

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
  framed?: boolean;
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
  framed = true,
}: LibraryTrackTableProps) {
  const [sortCol, setSortCol] = useState<LibrarySortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function handleColClick(col: LibrarySortCol) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else setSortDir('asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const ids = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const playlistCounts = useTrackPlaylistCounts(ids);
  const sortedTracks = useMemo(() => sortRecordTracks(tracks,
    sortCol ? { column: sortCol, direction: sortDir } : null, playlistCounts.counts),
    [tracks, sortCol, sortDir, playlistCounts.counts]);

  useAudioDockTracks(sortedTracks);
  const { listingRef, maxHeight } = useLibraryListingViewport();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Refresh className="animate-spin text-control-primary" width={28} height={28} aria-hidden="true" />
      </div>
    );
  }
  if (sortedTracks.length === 0) {
    return <p className="text-center py-12 text-muted-foreground text-sm">{emptyText ?? 'No tracks.'}</p>;
  }

  return (
    <div className={framed ? 'lib-panel' : undefined} ref={framed ? undefined : listingRef}>
      <RecordTrackListing
        tracks={sortedTracks}
        scrollStyle={framed ? undefined : { maxHeight }}
        selectedId={activeTrack?.id ?? null}
        onSelect={onTrackClick}
        getWaveformState={getWaveformState}
        onRetryWaveform={(id) => retryWaveform([id])}
        playlistCounts={playlistCounts}
        followPlayback
        rowProps={(t) => ({ 'aria-label': `Open ${t.title}${t.artist ? ` by ${t.artist}` : ''}` })}
        sort={sortCol ? { column: sortCol, direction: sortDir } : null}
        onSort={(column) => handleColClick(column as LibrarySortCol)}
        ariaLabel="Track listing"
      />
      {footer}
    </div>
  );
}

/** The Recently Added tab: the newest tracks in a table. Shared by the Library and Artist Library pages. */
export function RecentlyAddedPanel({ tracks, loading, ...tableProps }: Omit<LibraryTrackTableProps, 'emptyText' | 'footer' | 'framed'>) {
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [key, setKey] = useState('');
  const [format, setFormat] = useState('');
  const synced = useSyncedTrackFilter();
  const visible = tracks.filter((track) => synced.matches(track) && matchesLibrarySearch(search, track.title, track.artist, track.genre)
    && (!genre || track.genre === genre) && (!key || track.musical_key === key) && (!format || track.file_format === format));
  return (
    <section className="pb-10" aria-label="Recently added tracks">
      <LibraryFilterRow search={search} onSearchChange={setSearch} label="Recently added tracks" placeholder="Search title, artist, or genre…"
        filters={[
          { label: 'Genre', value: genre, onChange: setGenre, options: recordOptions(tracks.map((track) => track.genre)) },
          { label: 'Key', value: key, onChange: setKey, options: recordOptions(tracks.map((track) => track.musical_key)) },
          { label: 'Format', value: format, onChange: setFormat, options: recordOptions(tracks.map((track) => track.file_format)) },
          synced.dropdown,
        ]} />
      {synced.error ? <SyncedFilterError error={synced.error} onRetry={synced.cloud.retry} /> : <LibraryTrackTable
        {...tableProps}
        tracks={visible}
        loading={loading || synced.loading}
        emptyText={tracks.length ? 'No tracks match your filters.' : 'No recently added tracks.'}
        framed={false}
      />}
    </section>
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
        <Icon width={11} height={11} aria-hidden="true" />
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
          {playlist.is_folder ? <Folder width={26} height={26} aria-hidden="true" /> : <MusicNote width={26} height={26} aria-hidden="true" />}
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
            { label: 'Total Tracks', value: latestImport.track_count.toLocaleString(), Icon: MusicNote },
            { label: 'Most Common BPM', value: mostCommonBpm != null ? `${mostCommonBpm} BPM` : '—', Icon: Activity },
            { label: 'Most Common Key', value: mostCommonKey ? formatKey(mostCommonKey) : '—', Icon: Label },
          ] as const).map(({ label, value, Icon }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon width={11} height={11} aria-hidden="true" className="text-muted-foreground shrink-0" />
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
  onTrackClick,
  onImport,
  onResumeAnalysis,
  activeTab,
  searchQuery,
  onActiveTabChange,
  onSearchQueryChange,
}: LibraryViewProps) {
  const showSearch = searchQuery.trim().length >= 2;
  const searchSynced = useSyncedTrackFilter(showSearch);
  const isIncompleteView = activeTab === 'incomplete-analysis';
  const incompleteSynced = useSyncedTrackFilter(isIncompleteView && !showSearch);

  const {
    results: searchResults,
    total: searchTotal,
    loading: searchLoading,
    loadingMore: searchLoadingMore,
    hasMore: searchHasMore,
    loadMore: loadMoreSearchResults,
    error: searchError,
  } = useRekordboxSearch(importId, searchQuery, searchSynced.filter, !searchSynced.blocked);
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

  useAudioDockTracks(searchResults, null, undefined, showSearch && !searchSynced.blocked);

  // ── Incomplete analysis list: opened from the Track Analysis card, with a way back to the overview ──
  const [incompleteTracks, setIncompleteTracks] = useState<RekordboxTrack[]>([]);
  const [incompleteFetching, setIncompleteFetching] = useState(false);
  const [incompleteError, setIncompleteError] = useState<string | null>(null);
  const visibleIncompleteTracks = useMemo(
    () => incompleteTracks.filter(incompleteSynced.matches),
    [incompleteTracks, incompleteSynced.matches],
  );

  useEffect(() => {
    if (!isIncompleteView || showSearch || !importId) return;
    const controller = new AbortController();
    const pageSize = 500;
    const readTracks = async () => {
      const tracks: RekordboxTrack[] = [];
      for (let offset = 0; ; offset += pageSize) {
        controller.signal.throwIfAborted();
        const { data, error } = await supabase
          .from('rekordbox_tracks')
          .select('*')
          .eq('import_id', importId)
          .or('analysis_parse_status.is.null,analysis_parse_status.not.in.(completed,reused)')
          .order('title')
          .order('id')
          .range(offset, offset + pageSize - 1)
          .abortSignal(controller.signal);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as RekordboxTrack[];
        tracks.push(...page);
        if (page.length < pageSize) return tracks;
      }
    };

    setIncompleteTracks([]);
    setIncompleteFetching(true);
    setIncompleteError(null);
    void readTracks().then((tracks) => {
      if (!controller.signal.aborted) setIncompleteTracks(tracks);
    }).catch(() => {
      if (!controller.signal.aborted) setIncompleteError('Could not load tracks with incomplete analysis.');
    }).finally(() => {
      if (!controller.signal.aborted) setIncompleteFetching(false);
    });
    return () => controller.abort();
  }, [isIncompleteView, showSearch, importId]);

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
    () => visibleIncompleteTracks.map((t) => t.id),
    [visibleIncompleteTracks],
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
              <div className="cue-studio flex flex-wrap items-end justify-end gap-3">
                <div className="w-full max-w-md">
                  <SearchControl autoFocus placeholder="Search library…" value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)} aria-label="Search library" />
                </div>
                <FilterDropdown {...searchSynced.dropdown} className="cue-browser__filter" />
              </div>
              {searchSynced.error ? <SyncedFilterError error={searchSynced.error} onRetry={searchSynced.cloud.retry} /> : <LibrarySearchResults
                query={searchQuery.trim()}
                results={searchResults}
                total={searchTotal}
                loading={searchLoading || searchSynced.loading}
                loadingMore={searchLoadingMore}
                error={searchError}
                hasMore={searchHasMore}
                importId={importId}
                onTrackClick={onTrackClick}
                onLoadMore={() => { void loadMoreSearchResults(); }}
                waveformStates={waveformStates}
                onRetryWaveform={(trackId) => retryWaveform([trackId])}
              />}
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
            {importLoading && <PageSkeleton variant="home" label="Loading your library" />}

            {!importLoading && importError && (
              <div className="text-center py-24 space-y-2">
                <p className="text-red-400 font-bold">Failed to load library</p>
                <p className="text-xs text-muted-foreground">{importError}</p>
              </div>
            )}

            {!importLoading && !importError && (
              <>
                {!latestImport && <EmptyLibrary onImport={onImport} profile={profile} />}

                {latestImport && (
                  <>
                    {/* ── Sticky header: top row + tabs ── */}
                    <div className="sticky top-0 z-20 space-y-4 pb-3">

                      {/* The hero: the Ghost Banner on desktop, the compact hero below it */}
                      <div className="hidden lg:block">
                        <LibraryGhostHero
                          latestImport={latestImport}
                          profile={profile}
                          hiddenWidgets={hiddenWidgets}
                          genreCount={libraryStats ? libraryStats.genreTotals.length : null}
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
                                <Reports width={13} height={13} aria-hidden="true" /> Insights
                              </h2>
                              <div className={cn('grid grid-cols-1 gap-3', INSIGHT_COLUMNS[insightCount])}>
                                {showTopGenres && (
                                  <div className="lib-card p-5 flex flex-col h-[280px] overflow-hidden">
                                    <p className="lib-label mb-1.5 flex items-center gap-1.5 shrink-0">
                                      <ControlSlider width={12} height={12} className="shrink-0" aria-hidden="true" />
                                      Top Genres
                                    </p>
                                    <InsightTopGenres genres={topGenres} />
                                  </div>
                                )}
                                {showBpmDistribution && (
                                  <div className="lib-card p-5 flex flex-col h-[280px] overflow-hidden">
                                    <p className="lib-label mb-1.5 flex items-center gap-1.5 shrink-0">
                                      <SineWave width={12} height={12} className="shrink-0" aria-hidden="true" />
                                      BPM Distribution
                                    </p>
                                    <InsightBpmDistribution bpmRangeStats={bpmRangeStats} />
                                  </div>
                                )}
                                {showKeyProfile && (
                                  <div className="lib-card p-5 flex flex-col h-[280px] overflow-hidden">
                                    <p className="lib-label mb-1.5 flex items-center gap-1.5 shrink-0">
                                      <Key width={12} height={12} className="shrink-0" aria-hidden="true" />
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
                            <NavArrowLeft width={14} height={14} aria-hidden="true" /> Back to home
                          </ControlButton>
                          <div className="cue-studio"><FilterDropdown {...incompleteSynced.dropdown} className="cue-browser__filter" /></div>
                          {!incompleteSynced.error && !incompleteError && <p className="text-xs text-muted-foreground font-mono">
                            {incompleteFetching || incompleteSynced.loading
                              ? 'Loading…'
                              : `${visibleIncompleteTracks.length.toLocaleString()} tracks with incomplete analysis`}
                          </p>}
                          {incompleteSynced.error ? <SyncedFilterError error={incompleteSynced.error} onRetry={incompleteSynced.cloud.retry} />
                            : incompleteError ? <p className="px-4 text-sm text-red-300" role="alert">{incompleteError}</p>
                            : <LibraryTrackTable
                            tracks={visibleIncompleteTracks}
                            loading={incompleteFetching || incompleteSynced.loading}
                            emptyText={incompleteTracks.length ? 'No tracks match your filters.' : 'No tracks with incomplete analysis.'}
                            getWaveformState={getWaveformState}
                            retryWaveform={retryWaveform}
                            activeTrack={activeTrack}
                            playerStatus={playerStatus}
                            playIntent={playIntent}
                            usbConnected={usbConnected}
                            onTrackClick={onTrackClick}
                            onPlay={handlePlay}
                          />}
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
