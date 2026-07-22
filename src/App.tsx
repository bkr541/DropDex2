/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, Suspense, type ReactNode } from 'react';
import {
  Search,
  Music,
  ChevronLeft,
  Settings,
  TrendingUp,
  FileUp,
  Moon,
  Sun,
  Database,
  LogOut,
  User,
  Loader2,
  Radio,
  Pencil,
  Usb,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatKey, formatPosition, formatPlaylistDuration } from './lib/utils';
import { supabase } from './lib/supabase';
import { useAuthSession } from './hooks/useAuthSession';
import { useLatestRekordboxImport } from './hooks/useLatestRekordboxImport';
import { useRekordboxPlaylists } from './hooks/useRekordboxPlaylists';
import { useUserPlaylistProfiles } from './hooks/useUserPlaylistProfiles';
import { useUserProfile } from './hooks/useUserProfile';
import { useUserPreferences } from './hooks/useUserPreferences';
import { usePlaylistStats, useRekordboxPlaylistTracks } from './hooks/useRekordboxPlaylistTracks';
import { useRecentTracks } from './hooks/useRekordboxTracks';
import { useTrackPlaylists } from './hooks/useTrackPlaylists';
import { useImportList } from './hooks/useImportList';
import { useTrackPreviewWaveforms } from './hooks/useTrackPreviewWaveforms';
import { fetchReviewTracks, setActiveImport, deleteImport } from './lib/queries/rekordbox';
import { ImportLibraryModal } from './components/ImportLibraryModal';
import { getImportHistoryPresentation } from './lib/rekordbox/importHistoryPresentation';
import { ResumeAnalysisModal } from './components/ResumeAnalysisModal';
import { ApplicationErrorBoundary } from './components/errors/ApplicationErrorBoundary';
import { RouteLoadingState, RouteLoadErrorState, RouteNotFoundState } from './components/RouteStates';
import { lazyWithRecovery } from './navigation/lazyWithRecovery';
import { routeKey, type AppRoute, type LibraryTab } from './navigation/appRoutes';
import { useAppRouter } from './navigation/useAppRouter';
import { useRouteImport, useRoutePlaylist, useRouteTracks } from './hooks/useRouteEntities';

const DiscoveryView = lazyWithRecovery('discovery', () => import('./components/discovery/DiscoveryView').then(m => ({ default: m.DiscoveryView })));
const SearchView = lazyWithRecovery('search', () => import('./components/search/SearchView').then(m => ({ default: m.SearchView })));
const ReviewView = lazyWithRecovery('review', () => import('./components/library/ReviewView').then(m => ({ default: m.ReviewView })));
const ReviewEmptyState = lazyWithRecovery('review-empty', () => import('./components/library/ReviewView').then(m => ({ default: m.ReviewEmptyState })));
const DropLabView = lazyWithRecovery('drop-lab', () => import('./components/drop-lab/DropLabView').then(m => ({ default: m.DropLabView })));

import { LibraryView } from './components/library/LibraryView';
import { PlaylistEditView } from './components/library/PlaylistEditView';
import { TrackDetailView } from './components/library/TrackDetailView';
import { EditProfileView } from './components/profile/EditProfileView';
import { UsbConnectionProvider, useUsbConnection } from './contexts/UsbConnectionContext';
import { UsbConnectionButton } from './components/usb/UsbConnectionButton';
import { AudioPlayerProvider, useAudioPlayer } from './contexts/AudioPlayerContext';
import { NowPlayingBar } from './components/player/NowPlayingBar';
import { buildPlaylistIdentityKey } from './lib/queries/userPlaylists';
import type { PlaylistWithCount } from './lib/queries/rekordbox';
import type { RekordboxTrack, RekordboxImport, UserPlaylistProfile } from './types';

type Theme = 'dark' | 'light';
type View = 'home' | 'playlist' | 'playlist-edit' | 'track' | 'review' | 'settings' | 'discovery' | 'search' | 'edit-profile' | 'drop-lab' | 'import' | 'not-found';

function viewForRoute(route: AppRoute): View {
  switch (route.name) {
    case 'library': return 'home';
    case 'playlist': return 'playlist';
    case 'playlist-edit': return 'playlist-edit';
    case 'track': return 'track';
    case 'drop-lab': return 'drop-lab';
    case 'import': return 'import';
    case 'review': return 'review';
    case 'discovery': return 'discovery';
    case 'search': return 'search';
    case 'profile': return 'edit-profile';
    case 'settings': return 'settings';
    case 'not-found': return 'not-found';
  }
}


// ── Player-aware mobile bottom nav ────────────────────────────────────────────

interface MobileNavProps {
  currentView: View;
  setCurrentView: (v: View) => void;
  libraryLabel: string;
}

function MobileNavBar({ currentView, setCurrentView, libraryLabel }: MobileNavProps) {
  const { status: playerStatus } = useAudioPlayer();
  const { status: usbStatus, volumeName, connect: connectUsb, reconnect: reconnectUsb, selectNewUsb, ensurePermission } = useUsbConnection();
  const hasPlayer = playerStatus !== 'idle';

  function handleUsbPress() {
    if (usbStatus === 'connected') return;
    if (usbStatus === 'permission-required') void ensurePermission();
    else if (usbStatus === 'unavailable' || usbStatus === 'error') void reconnectUsb();
    else if (usbStatus === 'wrong_root') void selectNewUsb();
    else void connectUsb();
  }

  const usbConnected = usbStatus === 'connected';
  const usbProblem = usbStatus === 'unavailable' || usbStatus === 'permission-required' || usbStatus === 'wrong_root' || usbStatus === 'error';
  const usbLabel = usbStatus === 'connecting' ? 'Connecting' : usbConnected ? (volumeName ?? 'USB') : 'Connect';

  return (
    <nav className={cn(
      'md:hidden fixed left-0 right-0 glass border-t border-[var(--color-border-subtle)] px-2 pt-4 pb-8 flex justify-between items-center z-40 transition-all duration-200',
      hasPlayer ? 'bottom-16' : 'bottom-0',
    )}>
      <button
        onClick={() => setCurrentView('home')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'home' ? 'text-primary neon-text-blue' : 'text-muted-foreground')}
      >
        <Music size={20} />
        <span className="text-[8px] font-bold uppercase tracking-widest truncate max-w-[48px]">{libraryLabel}</span>
      </button>
      <button
        onClick={() => setCurrentView('review')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'review' ? 'text-secondary neon-text-purple' : 'text-muted-foreground')}
      >
        <TrendingUp size={20} />
        <span className="text-[8px] font-bold uppercase tracking-widest">Review</span>
      </button>

      {/* USB connection — center of mobile nav */}
      <button
        onClick={handleUsbPress}
        disabled={usbStatus === 'unsupported' || usbStatus === 'connecting'}
        aria-label={usbConnected ? `USB connected: ${volumeName ?? 'USB'}` : 'Connect USB drive'}
        className={cn(
          'flex flex-col items-center gap-1 transition-all px-2 relative',
          usbConnected ? 'text-green-400' : usbProblem ? 'text-amber-400' : 'text-muted-foreground',
          (usbStatus === 'unsupported' || usbStatus === 'connecting') && 'opacity-50 cursor-not-allowed',
        )}
      >
        <div className="relative">
          <Usb size={20} />
          {usbConnected && (
            <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-green-500" />
          )}
          {usbProblem && (
            <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
          {usbStatus === 'connecting' && (
            <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          )}
        </div>
        <span className="text-[8px] font-bold uppercase tracking-widest truncate max-w-[48px]">{usbLabel}</span>
      </button>

      <button
        onClick={() => setCurrentView('search')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'search' ? 'text-primary neon-text-blue' : 'text-muted-foreground')}
      >
        <Search size={20} />
        <span className="text-[8px] font-bold uppercase tracking-widest">Search</span>
      </button>
      <button
        onClick={() => setCurrentView('settings')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'settings' ? 'text-primary neon-text-blue' : 'text-muted-foreground')}
      >
        <Settings size={20} />
        <span className="text-[8px] font-bold uppercase tracking-widest">Setup</span>
      </button>
    </nav>
  );
}

// --- Components ---

interface TrackCardProps {
  track: RekordboxTrack;
  onClick: () => void;
  isActive?: boolean;
  position?: number;
}

const TrackCard = ({ track, onClick, isActive, position }: TrackCardProps) => {
  const initial1 = (track.artist?.[0] ?? track.title?.[0] ?? '?').toUpperCase();
  const initial2 = (track.title?.[0] ?? '?').toUpperCase();
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(1) : '—';
  const keyDisplay = formatKey(track.musical_key);
  const artistDisplay = track.artist ?? 'Artist Not Stored';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'grid grid-cols-[56px_1fr_60px_60px] gap-3 items-center p-3 rounded-xl transition-all cursor-pointer mb-2',
        isActive
          ? 'bg-[var(--color-surface-hover)] border border-primary/40 shadow-[0_4px_20px_rgba(207,107,101,0.15)]'
          : 'bg-[var(--color-surface)] border border-[var(--color-border-faint)] hover:bg-[var(--color-surface-hover)]'
      )}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shadow-md',
          isActive ? 'brand-gradient text-white' : 'bg-[var(--color-avatar-bg)] text-slate-500'
        )}
      >
        {position != null ? (
          <span className="text-[10px] font-mono leading-none">{formatPosition(position)}</span>
        ) : (
          <>{initial1}{initial2}</>
        )}
      </div>
      <div className="min-w-0 pr-2">
        <h4 className="text-sm font-bold truncate text-foreground">{track.title}</h4>
        <p className="text-[10px] text-muted-foreground uppercase tracking-tighter truncate">{artistDisplay}</p>
      </div>
      <div className="text-center">
        <p className={cn('text-xs font-mono font-bold', isActive ? 'text-primary neon-text-blue' : 'text-[var(--color-text-subdued)]')}>
          {bpmDisplay}
        </p>
        {isActive && <p className="text-[8px] text-slate-500 uppercase">BPM</p>}
      </div>
      <div className="text-right">
        <p className={cn('text-xs font-mono font-bold', isActive ? 'text-secondary neon-text-purple' : 'text-[var(--color-text-subdued)]')}>
          {keyDisplay}
        </p>
        {isActive && <p className="text-[8px] text-slate-500 uppercase">Key</p>}
      </div>
    </motion.div>
  );
};

function LazyFeature({
  children,
  label,
  boundaryKey,
  onReturnToLibrary,
}: {
  children: ReactNode;
  label: string;
  boundaryKey: string;
  onReturnToLibrary: () => void;
}) {
  return (
    <ApplicationErrorBoundary
      level="feature"
      resetKey={boundaryKey}
      onReturnToLibrary={onReturnToLibrary}
    >
      <Suspense fallback={<RouteLoadingState label={label} />}>
        {children}
      </Suspense>
    </ApplicationErrorBoundary>
  );
}

function RouteFailureProbe() {
  if (import.meta.env.MODE === 'e2e' && new URLSearchParams(window.location.search).get('__testRouteError') === '1') {
    throw new Error('E2E route boundary probe');
  }
  return null;
}

function RootFailureProbe() {
  if (import.meta.env.MODE === 'e2e' && new URLSearchParams(window.location.search).get('__testRootError') === '1') {
    throw new Error('E2E root boundary probe');
  }
  return null;
}

function ImportStatusView({
  item,
  isActive,
  onResume,
  onMakeActive,
}: {
  item: RekordboxImport;
  isActive: boolean;
  onResume: () => void;
  onMakeActive: () => void;
}) {
  const presentation = getImportHistoryPresentation(item.status, Boolean(item.retryable));
  return (
    <section className="mx-auto max-w-2xl space-y-5 pt-4" data-testid="import-status-screen">
      <div className="glass rounded-3xl border border-[var(--color-border-subtle)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Library Import</p>
            <h2 className="mt-1 truncate text-2xl font-black">{item.source_filename}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{item.id}</p>
          </div>
          <span className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
            {presentation.label}
          </span>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt className="text-[9px] uppercase text-muted-foreground">Tracks</dt><dd className="font-mono font-bold">{item.track_count.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Playlists</dt><dd className="font-mono font-bold">{item.playlist_count.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Imported</dt><dd className="font-mono text-xs font-bold">{new Date(item.imported_at).toLocaleDateString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Library</dt><dd className="font-mono text-xs font-bold">{isActive ? 'Active' : 'Snapshot'}</dd></div>
        </dl>
        {item.error_message && (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{item.error_message}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {!isActive && presentation.canActivate && (
            <button type="button" onClick={onMakeActive} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">Make Active</button>
          )}
          {(presentation.canRetry || item.analysis_status !== 'completed') && (
            <button type="button" onClick={onResume} className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-bold">Resume Analysis</button>
          )}
        </div>
      </div>
    </section>
  );
}

// --- App Root ---

export default function App() {
  const { route, navigate, goBack: navigateBack } = useAppRouter();
  const currentView = viewForRoute(route);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('dropdex-theme') as Theme) || 'dark'
  );
  const [reviewTracks, setReviewTracks] = useState<RekordboxTrack[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('dropdex-sidebar-collapsed') === 'true'
  );

  const { session } = useAuthSession();
  const userId = session?.user?.id ?? null;

  // ── Supabase data ──────────────────────────────────────────────────────────
  const { data: latestImport, loading: importLoading, error: importError, refetch: refetchImport } =
    useLatestRekordboxImport(userId);
  const importId = latestImport?.id ?? null;
  const { playlists, loading: playlistsLoading } = useRekordboxPlaylists(importId);
  const { profiles: playlistProfiles, refetch: refetchProfiles, upsertLocal: upsertLocalProfile } = useUserPlaylistProfiles(userId);
  const { profile: userProfile, refetch: refetchUserProfile } = useUserProfile(userId);
  const { genres: userGenres, refetch: refetchUserGenres } = useUserPreferences(userId);
  const {
    imports: allImports, loading: importsListLoading, error: importsListError,
    refetch: refetchImportList,
  } = useImportList(userId);

  const routeTrackId = route.name === 'track' ? route.trackId : null;
  const routeSourceTrackId = route.name === 'drop-lab' ? route.sourceTrackId : null;
  const routeCandidateTrackId = route.name === 'drop-lab' ? route.candidateTrackId : null;
  const routeTrackIds = useMemo(() => {
    if (routeTrackId) return [routeTrackId];
    if (routeSourceTrackId) return routeCandidateTrackId
      ? [routeSourceTrackId, routeCandidateTrackId]
      : [routeSourceTrackId];
    return [];
  }, [routeCandidateTrackId, routeSourceTrackId, routeTrackId]);
  const routeTracks = useRouteTracks(routeTrackIds);
  const routePlaylistId = route.name === 'playlist' || route.name === 'playlist-edit' ? route.playlistId : null;
  const routePlaylist = useRoutePlaylist(routePlaylistId);
  const routeImportId = route.name === 'import' ? route.importId : null;
  const routeImport = useRouteImport(routeImportId);

  const selectedTrack = route.name === 'track' ? routeTracks.tracksById.get(route.trackId) ?? null : null;
  const dropLabSourceTrack = route.name === 'drop-lab'
    ? routeTracks.tracksById.get(route.sourceTrackId) ?? null
    : null;
  const dropLabActiveCandidateId = route.name === 'drop-lab' ? route.candidateTrackId : null;
  const dropLabActiveCandidate = route.name === 'drop-lab' && route.candidateTrackId
    ? routeTracks.tracksById.get(route.candidateTrackId) ?? null
    : null;
  const selectedPlaylist = route.name === 'playlist'
    ? playlists.find((playlist) => playlist.id === route.playlistId) ?? routePlaylist.data
    : null;
  const editingPlaylist = route.name === 'playlist-edit'
    ? playlists.find((playlist) => playlist.id === route.playlistId) ?? routePlaylist.data
    : null;
  const selectedImport = route.name === 'import'
    ? allImports.find((item) => item.id === route.importId) ?? routeImport.data
    : null;
  const resumeImportId = route.name === 'import' && route.resume ? route.importId : null;
  const selectedTrackImportId = selectedTrack?.import_id ?? importId;

  const selectedWaveformTrackIds = useMemo(
    () => (selectedTrack ? [selectedTrack.id] : []),
    [selectedTrack],
  );
  const {
    getState: getSelectedTrackWaveformState,
    retry: retrySelectedTrackWaveform,
  } = useTrackPreviewWaveforms(selectedTrackImportId, selectedWaveformTrackIds);
  const selectedTrackWaveformState = getSelectedTrackWaveformState(selectedTrack?.id);

  const {
    tracks: playlistTracks,
    total: playlistTrackTotal,
    stats: selectedPlaylistStats,
    loading: playlistTracksLoading,
    loadingMore: playlistTracksLoadingMore,
    hasMore: playlistTracksHaveMore,
    loadMore: loadMorePlaylistTracks,
  } = useRekordboxPlaylistTracks(selectedPlaylist?.id ?? null);
  const { stats: editingPlaylistStats } = usePlaylistStats(editingPlaylist?.id ?? null);
  const { tracks: recentTracks, loading: recentTracksLoading } = useRecentTracks(importId);
  const { memberships: trackPlaylists, loading: trackPlaylistsLoading } =
    useTrackPlaylists(selectedTrackImportId, selectedTrack?.id ?? null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dropdex-theme', theme);
  }, [theme]);

  // Load review tracks when entering review mode
  useEffect(() => {
    if (currentView !== 'review' || !importId) return;
    fetchReviewTracks(importId)
      .then(setReviewTracks)
      .catch(console.error);
  }, [currentView, importId]);


  const avgBpm = selectedPlaylistStats?.averageBpm != null
    ? selectedPlaylistStats.averageBpm.toFixed(1)
    : null;
  const totalDuration = selectedPlaylistStats?.totalDurationSeconds || null;
  const topKey = selectedPlaylistStats?.mostCommonKey ?? null;

  // Map rekordbox_playlist_id → profile for the current device
  const playlistProfilesByRbId = useMemo(() => {
    // Treat null device_name as '' — consistent with how PlaylistEditView builds the key
    const deviceName = latestImport?.device_name ?? '';
    const prefix = `${deviceName}::`;
    const map = new Map<string, UserPlaylistProfile>();
    for (const [key, profile] of playlistProfiles) {
      if (key.startsWith(prefix)) map.set(key.slice(prefix.length), profile);
    }
    return map;
  }, [playlistProfiles, latestImport?.device_name]);

  // Profile for the currently selected playlist (used in detail header + edit)
  const currentPlaylistProfile = useMemo(() => {
    if (!selectedPlaylist) return null;
    return playlistProfilesByRbId.get(selectedPlaylist.rekordbox_playlist_id) ?? null;
  }, [selectedPlaylist, playlistProfilesByRbId]);

  // Profile for the playlist being edited
  const existingProfileForEditing = useMemo(() => {
    if (!editingPlaylist) return null;
    const key = buildPlaylistIdentityKey(
      latestImport?.device_name ?? '',
      editingPlaylist.rekordbox_playlist_id,
    );
    return playlistProfiles.get(key) ?? null;
  }, [editingPlaylist, latestImport?.device_name, playlistProfiles]);

  const needsPlaylistResolution = route.name === 'playlist' || route.name === 'playlist-edit';
  const needsTrackResolution = route.name === 'track' || route.name === 'drop-lab';
  const needsImportResolution = route.name === 'import';
  const routeEntityLoading =
    (needsTrackResolution && routeTracks.loading)
    || (needsPlaylistResolution && !selectedPlaylist && !editingPlaylist && routePlaylist.loading)
    || (needsImportResolution && !selectedImport && routeImport.loading);
  const routeEntityError =
    (needsTrackResolution ? routeTracks.error : null)
    ?? (needsPlaylistResolution && !selectedPlaylist && !editingPlaylist ? routePlaylist.error : null)
    ?? (needsImportResolution && !selectedImport ? routeImport.error : null);
  const candidateTrackMissing = route.name === 'drop-lab'
    && Boolean(route.candidateTrackId)
    && !routeTracks.loading
    && !routeTracks.tracksById.has(route.candidateTrackId!);
  const candidateImportMismatch = route.name === 'drop-lab'
    && Boolean(route.candidateTrackId)
    && Boolean(dropLabSourceTrack)
    && Boolean(routeTracks.tracksById.get(route.candidateTrackId!))
    && routeTracks.tracksById.get(route.candidateTrackId!)?.import_id !== dropLabSourceTrack?.import_id;
  const routeEntityMissing = !routeEntityLoading && !routeEntityError && (
    route.name === 'not-found'
    || (route.name === 'track' && !selectedTrack)
    || (route.name === 'drop-lab' && (!dropLabSourceTrack || candidateTrackMissing || candidateImportMismatch))
    || (route.name === 'playlist' && !selectedPlaylist)
    || (route.name === 'playlist-edit' && !editingPlaylist)
    || (route.name === 'import' && !selectedImport)
  );
  const routeBlocked = routeEntityLoading || Boolean(routeEntityError) || routeEntityMissing;

  const retryRouteEntity = () => {
    if (needsTrackResolution) routeTracks.retry();
    if (needsPlaylistResolution) routePlaylist.retry();
    if (needsImportResolution) routeImport.retry();
  };

  const libraryRoute = (tab: LibraryTab = 'overview', search = ''): AppRoute => ({
    name: 'library',
    tab,
    search,
  });

  const setCurrentView = (view: View) => {
    switch (view) {
      case 'home': navigate(libraryRoute()); break;
      case 'review': navigate({ name: 'review' }); break;
      case 'settings': navigate({ name: 'settings' }); break;
      case 'discovery': navigate({ name: 'discovery' }); break;
      case 'search': navigate({ name: 'search' }); break;
      case 'edit-profile': navigate({ name: 'profile' }); break;
      default: break;
    }
  };

  const returnToLibrary = () => navigate(libraryRoute());

  const handleImportSuccess = () => {
    navigate(libraryRoute(), { replace: true });
    refetchImport();
    refetchImportList();
    void refetchProfiles();
  };

  const handleSetActiveImport = async (nextImportId: string) => {
    try {
      await setActiveImport(nextImportId);
      refetchImport();
    } catch (err) {
      console.error('Failed to set active import:', err);
    }
  };

  const handleDeleteImport = async (imp: RekordboxImport) => {
    const isActive = imp.id === latestImport?.id;
    const isOnly = allImports.length === 1;

    if (isActive && isOnly) {
      alert('Cannot delete your only library snapshot. Import a new library first.');
      return;
    }

    const confirmMsg = isActive
      ? 'This is your active library. Deleting it will automatically switch to your next most recent import. Continue?'
      : 'Delete this library snapshot? This cannot be undone.';

    if (!confirm(confirmMsg)) return;

    try {
      await deleteImport(imp.id);
      if (route.name === 'import' && route.importId === imp.id) {
        navigate({ name: 'settings' }, { replace: true });
      }
      if (isActive) refetchImport();
      refetchImportList();
    } catch (err) {
      console.error('Failed to delete import:', err);
    }
  };

  const handlePlaylistClick = (playlist: PlaylistWithCount) => {
    navigate({ name: 'playlist', playlistId: playlist.id });
  };

  const handleTrackClick = (track: RekordboxTrack) => {
    navigate({ name: 'track', trackId: track.id });
  };

  const handleOpenDropLab = (track: RekordboxTrack) => {
    navigate({
      name: 'drop-lab',
      sourceTrackId: track.id,
      candidateTrackId: null,
      sourceDropId: null,
      candidateDropId: null,
    });
  };

  const handleDropLabBack = () => {
    navigateBack(route.name === 'drop-lab'
      ? { name: 'track', trackId: route.sourceTrackId }
      : libraryRoute());
  };

  const handleDropLabCandidateDetails = (track: RekordboxTrack) => {
    navigate({ name: 'track', trackId: track.id });
  };

  const handleDropLabCandidateChange = (trackId: string | null) => {
    if (route.name !== 'drop-lab' || route.candidateTrackId === trackId) return;
    navigate({ ...route, candidateTrackId: trackId, candidateDropId: null }, { replace: true });
  };

  const handleDropLabDropSelectionChange = (sourceDropId: string | null, candidateDropId: string | null) => {
    if (route.name !== 'drop-lab') return;
    if (route.sourceDropId === sourceDropId && route.candidateDropId === candidateDropId) return;
    navigate({ ...route, sourceDropId, candidateDropId }, { replace: true });
  };

  const handleAppearsInPlaylistClick = (playlistId: string) => {
    navigate({ name: 'playlist', playlistId });
  };

  const goBack = () => navigateBack();

  const handleEditProfile = () => {
    navigate({ name: 'profile' });
  };

  const handleEditPlaylist = (playlist: PlaylistWithCount) => {
    navigate({ name: 'playlist-edit', playlistId: playlist.id });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('dropdex-sidebar-collapsed', String(next));
      return next;
    });
  };

  const libraryLabel = userProfile?.display_name ?? 'My Library';

  const sidebarNavItems: { view: View; icon: React.ElementType; label: string; activeColor: string; activeBg: string }[] = [
    { view: 'home', icon: Music, label: libraryLabel, activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'review', icon: TrendingUp, label: 'Review', activeColor: 'text-secondary neon-text-purple', activeBg: 'bg-secondary/10 border-secondary/20' },
    { view: 'discovery', icon: Radio, label: 'Discover', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'search', icon: Search, label: 'Search', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
  ];

  return (
    <UsbConnectionProvider>
    <AudioPlayerProvider imports={allImports}>
    <RootFailureProbe />
    <div className="flex h-screen overflow-hidden font-sans relative">
      {/* Background ambience */}
      <div className="fixed inset-0 -z-10 bg-background overflow-hidden">
        <div className="ambience-blob absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full" />
        <div className="ambience-blob absolute bottom-[10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[100px] rounded-full" />
      </div>

      {/* ── Desktop sidebar ── */}
      <aside className={cn(
        'hidden md:flex flex-col shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-panel)] z-40 transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}>
        <div className={cn(
          'h-16 flex items-center shrink-0 border-b border-[var(--color-border-subtle)]',
          sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-6'
        )}>
          <img
            src="/logos/dropdexlogo.png"
            alt="DropDex"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-8 h-8 object-contain shrink-0 cursor-pointer"
          />
          {!sidebarCollapsed && (
            <span className="text-xl font-black tracking-tighter uppercase leading-none">
              Drop<span className="text-primary">Dex</span>
            </span>
          )}
        </div>

        <nav className="flex flex-col gap-1 p-3 flex-1">
          {sidebarNavItems.map(({ view, icon: Icon, label, activeColor, activeBg }) => (
            <button
              key={label}
              onClick={() => setCurrentView(view)}
              title={sidebarCollapsed ? label : undefined}
              className={cn(
                'flex items-center rounded-xl font-bold text-sm transition-all border w-full',
                sidebarCollapsed ? 'justify-center py-3 px-0' : 'gap-3 px-4 py-3 text-left',
                currentView === view
                  ? `${activeColor} ${activeBg}`
                  : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent'
              )}
            >
              <Icon size={18} />
              {!sidebarCollapsed && label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex flex-col gap-2">
          <UsbConnectionButton collapsed={sidebarCollapsed} />
          <button
            onClick={() => setCurrentView('settings')}
            title={sidebarCollapsed ? 'Settings' : undefined}
            className={cn(
              'w-full flex items-center rounded-xl font-bold text-sm transition-all border',
              sidebarCollapsed ? 'justify-center py-2.5 px-0' : 'gap-3 px-4 py-2.5',
              currentView === 'settings'
                ? 'text-foreground bg-[var(--color-surface)] border-[var(--color-border-subtle)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent'
            )}
          >
            <Settings size={18} />
            {!sidebarCollapsed && 'Settings'}
          </button>
        </div>
      </aside>

      {/* ── Main content column ── */}
      <div className="flex flex-col flex-1 min-w-0 h-screen">

        {/* View subheader */}
        {currentView !== 'home' && currentView !== 'drop-lab' && currentView !== 'not-found' && (
          <div className="px-6 py-4 shrink-0">
            {!routeBlocked && currentView === 'playlist' && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic truncate">{selectedPlaylist?.name}</h2>
                  {selectedPlaylist && !selectedPlaylist.is_folder && (
                    <button
                      onClick={() => selectedPlaylist && handleEditPlaylist(selectedPlaylist)}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-xs font-bold text-muted-foreground hover:text-foreground transition-all shrink-0"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-0.5 bg-[var(--color-surface)] rounded text-[8px] font-mono text-muted-foreground uppercase tracking-widest">
                    {playlistTracksLoading ? 'Loading…' : `${playlistTracks.length} Tracks`}
                  </span>
                  {avgBpm && (
                    <span className="px-2 py-0.5 bg-[var(--color-surface)] rounded text-[8px] font-mono text-muted-foreground uppercase tracking-widest">
                      Avg {avgBpm} BPM
                    </span>
                  )}
                  {totalDuration && (
                    <span className="px-2 py-0.5 bg-[var(--color-surface)] rounded text-[8px] font-mono text-muted-foreground uppercase tracking-widest">
                      {formatPlaylistDuration(totalDuration)}
                    </span>
                  )}
                  {topKey && (
                    <span className="px-2 py-0.5 bg-[var(--color-surface)] rounded text-[8px] font-mono text-secondary uppercase tracking-widest">
                      Key: {topKey}
                    </span>
                  )}
                </div>
              </div>
            )}
            {currentView === 'playlist-edit' && editingPlaylist && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic truncate">{editingPlaylist.name}</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Edit Playlist</p>
              </div>
            )}
            {!routeBlocked && currentView === 'track' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Track Intelligence</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Deep Scan Results</p>
              </div>
            )}
            {!routeBlocked && currentView === 'review' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Set Review Mode</h2>
                </div>
                <p className="text-[8px] text-secondary uppercase tracking-[0.2em] font-bold pl-7">Optimized for low-light</p>
              </div>
            )}
            {!routeBlocked && currentView === 'settings' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Settings</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">App Configuration</p>
              </div>
            )}
            {!routeBlocked && currentView === 'discovery' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Artist Discovery</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Setlists via 1001Tracklists</p>
              </div>
            )}
            {!routeBlocked && currentView === 'search' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Artist Search</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Melodic Dubstep &amp; Future Bass</p>
              </div>
            )}
            {currentView === 'import' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Import Status</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Durable import details</p>
              </div>
            )}
            {!routeBlocked && currentView === 'edit-profile' && (
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={goBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-2xl font-black italic">Edit Profile</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Your Artist Identity</p>
              </div>
            )}
          </div>
        )}

        {/* Scrollable content */}
        <main className={cn('flex-1 overflow-y-auto px-4 md:px-8 pb-32 md:pb-8', currentView === 'home' && 'pt-6')}>
          <ApplicationErrorBoundary level="feature" resetKey={routeKey(route)} onReturnToLibrary={returnToLibrary}>
          <RouteFailureProbe />
          <AnimatePresence mode="wait">
            {routeEntityLoading && <RouteLoadingState key="route-loading" label="Restoring this DropDex screen…" />}
            {routeEntityError && (
              <RouteLoadErrorState
                key="route-error"
                message={routeEntityError}
                onRetry={retryRouteEntity}
                onReturnToLibrary={returnToLibrary}
              />
            )}
            {routeEntityMissing && (
              <RouteNotFoundState
                key="route-missing"
                title="This DropDex item is unavailable"
                message="It may have been deleted, belong to another account, or no longer be available in this library snapshot."
                onReturnToLibrary={returnToLibrary}
              />
            )}

            {/* ── Home ── */}
            {!routeBlocked && currentView === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <LibraryView
                  latestImport={latestImport}
                  importLoading={importLoading}
                  importError={importError}
                  playlists={playlists}
                  playlistsLoading={playlistsLoading}
                  playlistProfilesByRbId={playlistProfilesByRbId}
                  recentTracks={recentTracks}
                  recentTracksLoading={recentTracksLoading}
                  importId={importId}
                  profile={userProfile}
                  genres={userGenres}
                  onPlaylistClick={handlePlaylistClick}
                  onEditPlaylist={handleEditPlaylist}
                  onTrackClick={handleTrackClick}
                  onImport={() => setIsImportModalOpen(true)}
                  onEditProfile={handleEditProfile}
                  onResumeAnalysis={(id) => navigate({ name: 'import', importId: id, resume: true })}
                  activeTab={route.name === 'library' ? route.tab : 'overview'}
                  searchQuery={route.name === 'library' ? route.search : ''}
                  onActiveTabChange={(tab) => {
                    if (route.name === 'library') navigate({ ...route, tab });
                  }}
                  onSearchQueryChange={(search) => {
                    if (route.name === 'library') navigate({ ...route, search }, { replace: true });
                  }}
                />

              </motion.div>
            )}

            {/* ── Playlist ── */}
            {!routeBlocked && currentView === 'playlist' && (
              <motion.div
                key="playlist"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 md:max-w-5xl md:mx-auto"
              >
                <div className="glass p-6 rounded-3xl mb-6 relative overflow-hidden">
                  <TrendingUp className="absolute -right-4 -bottom-4 text-primary/10 w-24 h-24" />
                  <div className="flex gap-4 items-start">
                    {/* Artwork thumbnail */}
                    {currentPlaylistProfile?.artwork_url && (
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden shrink-0 border border-[var(--color-border-subtle)] shadow-sm">
                        <img
                          src={currentPlaylistProfile.artwork_url}
                          alt={selectedPlaylist?.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-1">Playlist Details</p>
                      <p className="text-3xl font-black mb-3 truncate">
                        {currentPlaylistProfile?.display_name || selectedPlaylist?.name}
                      </p>
                      {currentPlaylistProfile?.description && (
                        <p className="text-xs text-muted-foreground mb-3 leading-relaxed line-clamp-2">
                          {currentPlaylistProfile.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-6">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase">Tracks</span>
                          <span className="font-bold font-mono">
                            {playlistTracksLoading ? '…' : playlistTrackTotal.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase">Avg BPM</span>
                          <span className="font-bold font-mono">{avgBpm ?? '—'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase">Total Time</span>
                          <span className="font-bold font-mono">
                            {totalDuration ? formatPlaylistDuration(totalDuration) : '—'}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase">Top Key</span>
                          <span className="font-bold font-mono text-secondary">{topKey ?? '—'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {playlistTracksLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin text-primary" size={32} />
                  </div>
                )}

                {!playlistTracksLoading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {playlistTracks.map((pt) => (
                      <TrackCard
                        key={`${selectedPlaylist?.id ?? 'playlist'}:${pt.position}`}
                        track={pt.track}
                        position={pt.position}
                        onClick={() => handleTrackClick(pt.track)}
                        isActive={selectedTrack?.id === pt.track.id}
                      />
                    ))}
                    {playlistTracks.length === 0 && (
                      <p className="text-center py-12 text-muted-foreground italic col-span-full">
                        No tracks in this playlist.
                      </p>
                    )}
                  </div>
                )}

                {!playlistTracksLoading && playlistTracksHaveMore && (
                  <button
                    onClick={() => { void loadMorePlaylistTracks(); }}
                    disabled={playlistTracksLoadingMore}
                    className="w-full py-3 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border-faint)] transition-colors disabled:opacity-60"
                  >
                    {playlistTracksLoadingMore ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={13} className="animate-spin" /> Loading more…
                      </span>
                    ) : (
                      `Load ${Math.min(200, playlistTrackTotal - playlistTracks.length).toLocaleString()} more…`
                    )}
                  </button>
                )}
              </motion.div>
            )}

            {/* ── Playlist Edit ── */}
            {!routeBlocked && currentView === 'playlist-edit' && editingPlaylist && latestImport && userId && (
              <motion.div
                key="playlist-edit"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="pt-2"
              >
                <PlaylistEditView
                  playlist={editingPlaylist}
                  latestImport={latestImport}
                  userId={userId}
                  existingProfile={existingProfileForEditing}
                  avgBpm={editingPlaylistStats?.averageBpm != null ? editingPlaylistStats.averageBpm.toFixed(1) : null}
                  totalDuration={editingPlaylistStats?.totalDurationSeconds || null}
                  topKey={editingPlaylistStats?.mostCommonKey ?? null}
                  onImport={() => setIsImportModalOpen(true)}
                  onSaved={(saved) => {
                    upsertLocalProfile(saved);
                    void refetchProfiles();
                    navigate({ name: 'playlist', playlistId: editingPlaylist.id }, { replace: true });
                  }}
                />
              </motion.div>
            )}

            {/* ── Track detail ── */}
            {!routeBlocked && currentView === 'track' && selectedTrack && (
              <motion.div
                key="track"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="md:max-w-5xl md:mx-auto"
              >
                <TrackDetailView
                  track={selectedTrack}
                  importId={selectedTrackImportId}
                  waveformState={selectedTrackWaveformState}
                  onRetryWaveform={() => {
                    if (selectedTrack) retrySelectedTrackWaveform([selectedTrack.id]);
                  }}
                  memberships={trackPlaylists}
                  membershipsLoading={trackPlaylistsLoading}
                  onTrackClick={handleTrackClick}
                  onPlaylistClick={handleAppearsInPlaylistClick}
                  onOpenDropLab={handleOpenDropLab}
                />
              </motion.div>
            )}

            {/* ── Drop Lab ── */}
            {!routeBlocked && currentView === 'drop-lab' && (
              <motion.div
                key="drop-lab"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pt-2"
              >
                <LazyFeature label="Loading Drop Lab…" boundaryKey={`${routeKey(route)}:drop-lab`} onReturnToLibrary={returnToLibrary}>
                  <DropLabView
                    sourceTrack={dropLabSourceTrack}
                    importId={dropLabSourceTrack?.import_id ?? importId}
                    preservedActiveCandidateId={dropLabActiveCandidateId}
                    preservedActiveCandidate={dropLabActiveCandidate}
                    preservedSourceDropId={route.name === 'drop-lab' ? route.sourceDropId : null}
                    preservedCandidateDropId={route.name === 'drop-lab' ? route.candidateDropId : null}
                    onActiveCandidateChange={handleDropLabCandidateChange}
                    onDropSelectionChange={handleDropLabDropSelectionChange}
                    onBack={handleDropLabBack}
                    onTrackDetails={handleDropLabCandidateDetails}
                  />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Import status ── */}
            {!routeBlocked && currentView === 'import' && selectedImport && (
              <motion.div
                key="import"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
              >
                <ImportStatusView
                  item={selectedImport}
                  isActive={selectedImport.id === latestImport?.id}
                  onMakeActive={() => { void handleSetActiveImport(selectedImport.id); }}
                  onResume={() => navigate({ name: 'import', importId: selectedImport.id, resume: true }, { replace: true })}
                />
              </motion.div>
            )}

            {/* ── Review ── */}
            {!routeBlocked && currentView === 'review' && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-6 pb-32 md:pb-8 md:max-w-5xl md:mx-auto"
              >
                <LazyFeature label="Loading Review…" boundaryKey={`${routeKey(route)}:review`} onReturnToLibrary={returnToLibrary}>
                  {!importId ? (
                    <ReviewEmptyState onImport={() => setIsImportModalOpen(true)} />
                  ) : (
                    <ReviewView
                      importId={importId}
                      tracks={reviewTracks}
                      loading={reviewTracks.length === 0}
                      onTrackClick={handleTrackClick}
                    />
                  )}
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Settings ── */}
            {!routeBlocked && currentView === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="space-y-8 pt-6 md:max-w-2xl md:mx-auto pb-8"
              >
                {/* Account */}
                <section className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">Account</h2>
                  <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                    <div className="p-4 flex items-center gap-3">
                      <User size={18} className="text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-sm">Signed in as</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {session?.user?.email ?? '—'}
                        </p>
                      </div>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <LogOut size={18} className="text-muted-foreground" />
                        <p className="font-bold text-sm">Sign Out</p>
                      </div>
                      <button
                        onClick={() => supabase.auth.signOut()}
                        className="text-xs font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                </section>

                {/* Appearance */}
                <section className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">Appearance</h2>
                  <div className="glass rounded-2xl p-5 space-y-4">
                    <div>
                      <p className="font-bold text-sm mb-0.5">Theme</p>
                      <p className="text-xs text-muted-foreground">Choose your preferred color scheme</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setTheme('dark')}
                        className={cn(
                          'flex flex-col items-start gap-3 p-4 rounded-xl border-2 transition-all text-left',
                          theme === 'dark'
                            ? 'border-primary bg-primary/10'
                            : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        <Moon size={22} className={theme === 'dark' ? 'text-primary' : 'text-muted-foreground'} />
                        <div>
                          <p className="font-bold text-sm">Dark</p>
                          <p className="text-xs text-muted-foreground">Default</p>
                        </div>
                        {theme === 'dark' && (
                          <span className="text-[9px] font-bold uppercase tracking-widest text-primary">Active</span>
                        )}
                      </button>
                      <button
                        onClick={() => setTheme('light')}
                        className={cn(
                          'flex flex-col items-start gap-3 p-4 rounded-xl border-2 transition-all text-left',
                          theme === 'light'
                            ? 'border-primary bg-primary/10'
                            : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                        )}
                      >
                        <Sun size={22} className={theme === 'light' ? 'text-primary' : 'text-muted-foreground'} />
                        <div>
                          <p className="font-bold text-sm">Light</p>
                          <p className="text-xs text-muted-foreground">High contrast</p>
                        </div>
                        {theme === 'light' && (
                          <span className="text-[9px] font-bold uppercase tracking-widest text-primary">Active</span>
                        )}
                      </button>
                    </div>
                  </div>
                </section>

                {/* Library */}
                <section className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">Library</h2>
                  <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                    <div className="p-4 flex items-center gap-3">
                      <Database size={18} className="text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-bold text-sm">Cloud Library</p>
                        <p className="text-xs text-muted-foreground">
                          {importLoading
                            ? 'Loading…'
                            : latestImport
                            ? `${latestImport.track_count.toLocaleString()} tracks · ${latestImport.playlist_count} playlists`
                            : 'No import found'}
                        </p>
                        {latestImport && (
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                            {latestImport.device_name ?? latestImport.source_filename} · {new Date(latestImport.imported_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileUp size={18} className="text-primary" />
                        <div>
                          <p className="font-bold text-sm">Import New Library</p>
                          <p className="text-xs text-muted-foreground">Upload exportLibrary.db from USB</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="text-xs font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        Import
                      </button>
                    </div>
                  </div>
                </section>

                {/* USB Library Snapshots */}
                <section className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">USB Library Snapshots</h2>
                  {importsListLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="animate-spin text-muted-foreground" size={20} />
                    </div>
                  ) : importsListError ? (
                    <div className="glass rounded-2xl p-4 text-center space-y-2">
                      <p className="text-sm text-red-400">{importsListError}</p>
                      <button onClick={refetchImportList} className="text-xs font-bold text-primary">Retry</button>
                    </div>
                  ) : allImports.length === 0 ? (
                    <div className="glass rounded-2xl p-4 text-center">
                      <p className="text-sm text-muted-foreground italic">No imports yet.</p>
                    </div>
                  ) : (
                    <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                      {allImports.map((imp) => {
                        const isActive = imp.id === latestImport?.id;
                        const importPresentation = getImportHistoryPresentation(
                          imp.status, Boolean(imp.retryable),
                        );
                        return (
                          <div key={imp.id} className="p-4 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => navigate({ name: 'import', importId: imp.id, resume: false })}
                                  className="max-w-full truncate text-left font-mono text-sm font-bold hover:text-primary"
                                  aria-label={`Open import ${imp.source_filename}`}
                                >
                                  {imp.source_filename}
                                </button>
                                {isActive && (
                                  <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-primary/10 text-primary rounded shrink-0">
                                    Active
                                  </span>
                                )}
                                {imp.status !== 'completed' && (
                                  <span className={cn(
                                    "text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0",
                                    importPresentation.tone === 'error' ? "bg-red-500/10 text-red-400" :
                                    importPresentation.tone === 'warning' ? "bg-amber-500/10 text-amber-400" :
                                    "bg-blue-500/10 text-blue-400",
                                  )}>
                                    {importPresentation.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                {new Date(imp.imported_at).toLocaleDateString()} · {imp.track_count.toLocaleString()} tracks · {imp.playlist_count} playlists
                              </p>
                              {imp.device_name && (
                                <p className="text-[10px] text-muted-foreground font-mono">{imp.device_name}</p>
                              )}
                              {(imp.status === 'failed' || imp.status === 'cancelled') && imp.error_message && (
                                <p className="text-[10px] text-red-400 mt-1">{imp.error_message}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0 pt-0.5">
                              {!isActive && importPresentation.canActivate && (
                                <button
                                  onClick={() => handleSetActiveImport(imp.id)}
                                  className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                                >
                                  Make Active
                                </button>
                              )}
                              {importPresentation.canRetry && (
                                <button
                                  onClick={() => setIsImportModalOpen(true)}
                                  className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                                >
                                  Retry
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteImport(imp)}
                                className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* About */}
                <section className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">About</h2>
                  <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                    {[
                      { label: 'Version', value: '2.0.0' },
                      { label: 'Library Source', value: 'Supabase (rekordbox USB)' },
                      { label: 'Import ID', value: latestImport?.id?.slice(0, 8) ?? '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="px-4 py-3 flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="text-sm font-mono font-bold">{value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </motion.div>
            )}

            {/* ── Discovery ── */}
            {!routeBlocked && currentView === 'discovery' && (
              <motion.div
                key="discovery"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <LazyFeature label="Loading Discovery…" boundaryKey={`${routeKey(route)}:discovery`} onReturnToLibrary={returnToLibrary}>
                  <DiscoveryView accessToken={session?.access_token ?? null} />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Search ── */}
            {!routeBlocked && currentView === 'search' && (
              <motion.div
                key="search"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <LazyFeature label="Loading Search…" boundaryKey={`${routeKey(route)}:search`} onReturnToLibrary={returnToLibrary}>
                  <SearchView />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Edit Profile ── */}
            {!routeBlocked && currentView === 'edit-profile' && userId && (
              <motion.div
                key="edit-profile"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pt-2"
              >
                <EditProfileView
                  userId={userId}
                  existingProfile={userProfile}
                  onPreferencesChanged={() => void refetchUserGenres()}
                  onSaved={(_saved) => {
                    void refetchUserProfile();
                    void refetchUserGenres();
                  }}
                />
              </motion.div>
            )}

          </AnimatePresence>
          </ApplicationErrorBoundary>
        </main>
        {/* ── Desktop NowPlaying — in-flow at bottom of content column ── */}
        {currentView !== 'drop-lab' && <NowPlayingBar className="hidden md:flex shrink-0" />}
      </div>

      {/* ── Mobile NowPlaying — fixed above mobile nav ── */}
      {currentView !== 'drop-lab' && <NowPlayingBar className="md:hidden fixed bottom-0 left-0 right-0 z-50" />}

      {/* ── Mobile-only: bottom nav (shifts up when player is active) ── */}
      <MobileNavBar
        currentView={currentView}
        setCurrentView={setCurrentView}
        libraryLabel={libraryLabel}
      />

      <ImportLibraryModal
        isOpen={isImportModalOpen}
        accessToken={session?.access_token ?? null}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={handleImportSuccess}
      />

      {resumeImportId && (
        <ResumeAnalysisModal
          isOpen
          importId={resumeImportId}
          onClose={() => {
            if (route.name === 'import') navigate({ ...route, resume: false }, { replace: true });
          }}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
    </AudioPlayerProvider>
    </UsbConnectionProvider>
  );
}
