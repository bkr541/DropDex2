/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, Suspense, type ReactNode } from 'react';
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
import { fetchImportById, setActiveImport } from './lib/queries/rekordbox';
import { deleteAllRekordboxImports, deleteRekordboxImport, RekordboxImportError } from './lib/api/rekordboxImport';
import { ImportLibraryModal } from './components/ImportLibraryModal';
import { BackgroundImportPanel } from './components/BackgroundImportPanel';
import { DeleteLibraryModal } from './components/DeleteLibraryModal';
import { DeleteAllLibrariesModal } from './components/DeleteAllLibrariesModal';
import {
  getNextUsableLibrarySnapshot,
  getPersistedDeleteStrategy,
  isPendingHardDelete,
  type DeleteActiveStrategy,
} from './lib/rekordbox/libraryDeletion';
import { getInFlightImport, isImportInFlight } from './lib/rekordbox/importLifecycle';
import { ResumeAnalysisModal } from './components/ResumeAnalysisModal';
import { ImportActivityBanner } from './components/imports/ImportActivityBanner';
import { ApplicationErrorBoundary } from './components/errors/ApplicationErrorBoundary';
import { RouteLoadingState, RouteLoadErrorState, RouteNotFoundState } from './components/RouteStates';
import { lazyWithRecovery } from './navigation/lazyWithRecovery';
import { routeKey, type AppRoute, type LibraryTab } from './navigation/appRoutes';
import { useAppRouter } from './navigation/useAppRouter';
import { useRouteImport, useRoutePlaylist, useRouteTracks } from './hooks/useRouteEntities';

const DiscoveryView = lazyWithRecovery('discovery', () => import('./components/discovery/DiscoveryView').then(m => ({ default: m.DiscoveryView })));
const FlipLabView = lazyWithRecovery('flip-lab', () => import('./components/flip-lab/FlipLabView').then(m => ({ default: m.FlipLabView })));
const ArtistLibraryView = lazyWithRecovery('artist-library', () => import('./components/library/ArtistLibraryView').then(m => ({ default: m.ArtistLibraryView })));
const ArtistLibraryEmptyState = lazyWithRecovery('artist-library-empty', () => import('./components/library/ArtistLibraryView').then(m => ({ default: m.ArtistLibraryEmptyState })));
const CuePointsView = lazyWithRecovery('cue-points', () => import('./components/cues/CuePointsView').then(m => ({ default: m.CuePointsView })));
const AuditionView = lazyWithRecovery('audition', () => import('./components/audition/AuditionView').then(m => ({ default: m.AuditionView })));
const UsbManagementView = lazyWithRecovery('usb-management', () => import('./components/usb-management/UsbManagementView').then(m => ({ default: m.UsbManagementView })));
const DropLabView = lazyWithRecovery('drop-lab', () => import('./components/drop-lab/DropLabView').then(m => ({ default: m.DropLabView })));
const SetLabView = lazyWithRecovery('set-lab', () => import('./features/set-lab/SetLabView').then(m => ({ default: m.SetLabView })));

import { LibraryView } from './components/library/LibraryView';
import { ImportLibraryView } from './components/library/ImportLibraryView';
import { PlaylistEditView } from './components/library/PlaylistEditView';
import { TrackDetailView } from './components/library/TrackDetailView';
import { EditProfileView } from './components/profile/EditProfileView';
import { DeveloperTab } from './components/profile/DeveloperTab';
import { ExternalMusicTab } from './components/profile/ExternalMusicTab';
import { UsbConnectionProvider, useUsbConnection } from './contexts/UsbConnectionContext';
import { FloatingSidebar } from './components/navigation/FloatingSidebar';
import { NAV_ICONS } from './components/navigation/NavIcons';
import { StreamingSyncGroup } from './components/profile/StreamingSyncGroup';
import { RekordboxXmlGroup } from './components/profile/RekordboxXmlGroup';
import { FloatingLayoutLabButton } from './components/navigation/FloatingLayoutLabButton';
import { FloatingPageHeader, type PageHeading } from './components/navigation/FloatingPageHeader';
import { AudioPlayerProvider } from './contexts/AudioPlayerContext';
import { NowPlayingBar } from './components/player/NowPlayingBar';
import { AudioDockWorkspaceProvider, useAudioDockTracks } from './contexts/AudioDockWorkspaceContext';
import { buildPlaylistIdentityKey, playlistKeyOwner } from './lib/queries/userPlaylists';
import { useUsbDevices } from './hooks/useUsbDevices';
import { groupImportsByUsb, UNASSIGNED_KEY } from './lib/usb/groupImportsByUsb';
import { UsbCardsSection } from './components/profile/UsbLibrarySections';
import { useLibraryOverviewWidgets } from './hooks/useLibraryOverviewWidgets';
import { DashboardWidgetsGroup } from './components/profile/DashboardWidgetsGroup';
import { DisplayPreferencesGroup } from './components/profile/DisplayPreferencesGroup';
import type { PlaylistWithCount } from './lib/queries/rekordbox';
import type { RekordboxTrack, RekordboxImport, UserPlaylistProfile } from './types';
import { useTheme } from './theme/ThemeProvider';
import type { ThemeId } from './theme/theme';
import { CheckCircle, CompactDisc, Database, EditPencil, GraphUp, HalfMoon, InfoCircle, MusicNote, Refresh, SunLight, Upload, Usb, User, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { openLayoutLab } from './components/ui/openLayoutLab';
import { ControlButton, FilterDropdown } from './components/ui/controls';
import { SyncedFilterError } from './components/library/LibraryFilterRow';
import { useSyncedTrackFilter } from './hooks/useSyncedTrackFilter';
import { LogOut } from 'iconoir-react/regular';
import { StatTile, SurfaceCard, TabNavigation } from './components/ui/display';
import { NoticeCard, SelectableOptionCard, StatusLoader, type PageSkeletonVariant } from './components/ui/feedback';
import './components/profile/profile.css';

type ThemeOption = {
  id: ThemeId;
  label: string;
  description: string;
  icon: typeof HalfMoon;
};

const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark', label: 'Dark', description: 'Default', icon: HalfMoon },
  { id: 'light', label: 'Light', description: 'High contrast', icon: SunLight },
  { id: 'cdj', label: 'CDJ', description: 'Performance deck', icon: CompactDisc },
];

const THEME_HERO: Record<ThemeId, { background: string; ink: string }> = {
  dark: { background: 'linear-gradient(165deg, #292d37, #191d25)', ink: '#cdd3dd' },
  light: { background: 'linear-gradient(165deg, #f7f4f2, #e8e3df)', ink: '#3a3f4b' },
  cdj: { background: 'linear-gradient(165deg, #12171d, #0b0e12)', ink: '#8fb4d8' },
};

const PROFILE_TABS = [
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Personalization' },
  { id: 'library', label: 'Library' },
  { id: 'rekordbox', label: 'Rekordbox' },
  { id: 'external-music', label: 'External Music' },
  { id: 'about', label: 'About' },
  { id: 'developer', label: 'Developer' },
] as const;

type ProfileTab = (typeof PROFILE_TABS)[number]['id'];

type View = 'home' | 'playlist' | 'playlist-edit' | 'track' | 'artist-library' | 'cues' | 'audition' | 'settings' | 'discovery' | 'drop-lab' | 'set-lab' | 'import' | 'flip-lab' | 'usb' | 'not-found';

type ImportNotice = {
  kind: 'success' | 'warning';
  title: string;
  detail: string;
};

function viewForRoute(route: AppRoute): View {
  switch (route.name) {
    case 'library': return 'home';
    case 'playlist': return 'playlist';
    case 'playlist-edit': return 'playlist-edit';
    case 'track': return 'track';
    case 'drop-lab': return 'drop-lab';
    case 'set-lab': return 'set-lab';
    case 'import': return 'import';
    case 'artist-library': return 'artist-library';
    case 'cues': return 'cues';
    case 'audition': return 'audition';
    case 'discovery': return 'discovery';
    case 'profile': return 'settings';
    case 'settings': return 'settings';
    case 'flip-lab': return 'flip-lab';
    case 'usb': return 'usb';
    case 'not-found': return 'not-found';
  }
}


// ── Player-aware mobile bottom nav ────────────────────────────────────────────

interface MobileNavProps {
  currentView: View;
  setCurrentView: (v: View) => void;
  libraryLabel: string;
}

function PlaylistDockQueue({ entries, enabled }: { entries: { track: RekordboxTrack }[]; enabled: boolean }) {
  const tracks = useMemo(() => entries.map((entry) => entry.track), [entries]);
  useAudioDockTracks(tracks, null, undefined, enabled);
  return null;
}

function MobileNavBar({ currentView, setCurrentView, libraryLabel }: MobileNavProps) {
  const { status: usbStatus, volumeName, connect: connectUsb, reconnect: reconnectUsb, selectNewUsb, ensurePermission } = useUsbConnection();

  function handleUsbPress() {
    if (usbStatus === 'connected') return;
    if (usbStatus === 'permission-required') void ensurePermission();
    else if (usbStatus === 'unavailable' || usbStatus === 'error' || usbStatus === 'released') void reconnectUsb();
    else if (usbStatus === 'wrong_root') void selectNewUsb();
    else void connectUsb();
  }

  const usbConnected = usbStatus === 'connected';
  const usbProblem = usbStatus === 'unavailable' || usbStatus === 'permission-required' || usbStatus === 'wrong_root' || usbStatus === 'error';
  const usbLabel = usbStatus === 'connecting' ? 'Connecting' : usbConnected ? (volumeName ?? 'USB') : 'Connect';
  const ArtistLibraryIcon = NAV_ICONS['artist-library'];

  return (
    <nav className={cn(
      'md:hidden relative shrink-0 glass border-t border-[var(--color-border-subtle)] px-2 pt-3 pb-5 flex justify-between items-center z-40',
    )}>
      <button
        onClick={() => setCurrentView('home')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'home' ? 'text-primary neon-text-blue' : 'text-muted-foreground')}
      >
        <NAV_ICONS.home width={20} height={20} aria-hidden="true" />
        <span className="text-[8px] font-bold uppercase tracking-widest truncate max-w-[48px]">{libraryLabel}</span>
      </button>
      <button
        onClick={() => setCurrentView('artist-library')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'artist-library' ? 'text-secondary neon-text-purple' : 'text-muted-foreground')}
      >
        <ArtistLibraryIcon width={20} height={20} aria-hidden="true" />
        <span className="text-[8px] font-bold uppercase tracking-widest">Artist Library</span>
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
          <Usb width={20} height={20} aria-hidden="true" />
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
        onClick={() => setCurrentView('discovery')}
        className={cn('flex flex-col items-center gap-1 transition-all px-2', currentView === 'discovery' ? 'text-primary neon-text-blue' : 'text-muted-foreground')}
      >
        <NAV_ICONS.discovery width={20} height={20} aria-hidden="true" />
        <span className="text-[8px] font-bold uppercase tracking-widest">Discover</span>
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
          ? 'bg-[var(--color-surface-hover)] border border-primary/40 shadow-primary-selection'
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

/**
 * How a page arrives: it fades in place, with no sliding, and the old page leaves at once. Nothing moves while a page loads, and
 * there is no empty gap between two pages; the page's own placeholders show while its content loads.
 */
const PAGE_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0 } },
  transition: { duration: 0.12 },
} as const;

function LazyFeature({
  children,
  label,
  boundaryKey,
  onReturnToLibrary,
  skeleton = 'listing',
}: {
  children: ReactNode;
  label: string;
  boundaryKey: string;
  onReturnToLibrary: () => void;
  /** The shape of the placeholder shown while the screen's code loads. */
  skeleton?: PageSkeletonVariant;
}) {
  return (
    <ApplicationErrorBoundary
      level="feature"
      resetKey={boundaryKey}
      onReturnToLibrary={onReturnToLibrary}
    >
      <Suspense fallback={<RouteLoadingState label={label} variant={skeleton} />}>
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

type ConfirmedDeleteExecutor = (strategy: DeleteActiveStrategy) => Promise<void>;

interface PendingDeletionContext {
  importId: string;
  sourceFilename: string;
  strategy: DeleteActiveStrategy;
  wasActive: boolean;
  fallbackFilename: string | null;
}

// --- App Root ---

export default function App() {
  const { route, navigate, goBack: navigateBack } = useAppRouter();
  const currentView = viewForRoute(route);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [backgroundImport, setBackgroundImport] = useState<{ importId: string; usbReleased: boolean } | null>(null);
  const { theme, setTheme } = useTheme();
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [deleteLibraryTarget, setDeleteLibraryTarget] = useState<RekordboxImport | null>(null);
  const [deleteLibraryRetryCount, setDeleteLibraryRetryCount] = useState(0);
  const [deleteLibrarySubmitting, setDeleteLibrarySubmitting] = useState(false);
  const deleteLibrarySubmittingRef = useRef(false);
  const [deleteLibraryError, setDeleteLibraryError] = useState<string | null>(null);
  const [deleteAllLibrariesOpen, setDeleteAllLibrariesOpen] = useState(false);
  const [deleteAllLibrariesSubmitting, setDeleteAllLibrariesSubmitting] = useState(false);
  const deleteAllLibrariesSubmittingRef = useRef(false);
  const [deleteAllLibrariesError, setDeleteAllLibrariesError] = useState<string | null>(null);
  const [deleteAllLibrariesPass, setDeleteAllLibrariesPass] = useState(0);
  const [deleteAllLibrariesInitialCount, setDeleteAllLibrariesInitialCount] = useState(0);
  const [deleteAllLibrariesRemainingCount, setDeleteAllLibrariesRemainingCount] = useState(0);
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(() => new Set());
  const [settingsTab, setSettingsTab] = useState<ProfileTab>('account');
  const deleteExecutorRef = useRef<ConfirmedDeleteExecutor | null>(null);
  const pendingDeletionContextsRef = useRef<Map<string, PendingDeletionContext>>(new Map());
  const importStatusRef = useRef<Map<string, {
    status: RekordboxImport['status'];
    inFlight: boolean;
  }>>(new Map());
  const importStatusSeededRef = useRef(false);
  const activationAttemptsRef = useRef<Set<string>>(new Set());

  const { session } = useAuthSession();
  const userId = session?.user?.id ?? null;
  const libraryOverviewWidgets = useLibraryOverviewWidgets(userId);

  // ── Supabase data ──────────────────────────────────────────────────────────
  const { data: latestImport, loading: importLoading, error: importError, refetch: refetchImport, settled: importSettled } =
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
  const { devices: usbDevices, loading: usbDevicesLoading } = useUsbDevices(userId, allImports.length);
  const usbGroups = useMemo(
    () => groupImportsByUsb(allImports, usbDevices, latestImport?.id ?? null),
    [allImports, usbDevices, latestImport?.id],
  );
  // The USBs you use: every saved USB that is not retired, plus any with imports that is not in the list.
  const usbCount = usbGroups.filter((group) => group.key !== UNASSIGNED_KEY && !group.retired).length;
  const inFlightImport = useMemo(() => getInFlightImport(allImports), [allImports]);

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
  const dropLabSourceTrack = route.name === 'drop-lab' && route.sourceTrackId
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

  const playlistSynced = useSyncedTrackFilter(Boolean(selectedPlaylist));
  const {
    tracks: playlistTracks,
    total: playlistTrackTotal,
    stats: selectedPlaylistStats,
    loading: playlistTracksLoading,
    loadingMore: playlistTracksLoadingMore,
    error: playlistTracksError,
    hasMore: playlistTracksHaveMore,
    loadMore: loadMorePlaylistTracks,
  } = useRekordboxPlaylistTracks(selectedPlaylist?.id ?? null, playlistSynced.filter, !playlistSynced.blocked);
  const playlistResultsLoading = playlistTracksLoading || playlistSynced.loading;
  const { stats: editingPlaylistStats } = usePlaylistStats(editingPlaylist?.id ?? null);
  const { tracks: recentTracks, loading: recentTracksLoading } = useRecentTracks(importId);
  const { memberships: trackPlaylists, loading: trackPlaylistsLoading } =
    useTrackPlaylists(selectedTrackImportId, selectedTrack?.id ?? null);


  useEffect(() => {
    if (!importNotice) return;
    const timeout = window.setTimeout(() => setImportNotice(null), 9000);
    return () => window.clearTimeout(timeout);
  }, [importNotice]);

  useEffect(() => {
    if (!userId) {
      importStatusRef.current.clear();
      importStatusSeededRef.current = false;
      activationAttemptsRef.current.clear();
      pendingDeletionContextsRef.current.clear();
      setPendingDeletionIds(new Set());
      deleteExecutorRef.current = null;
      return;
    }
    if (importsListLoading) return;

    if (!importStatusSeededRef.current) {
      importStatusRef.current = new Map(allImports.map((item) => [
        item.id,
        { status: item.status, inFlight: isImportInFlight(item) },
      ]));
      importStatusSeededRef.current = true;
      return;
    }

    for (const item of allImports) {
      const previous = importStatusRef.current.get(item.id);
      const currentInFlight = isImportInFlight(item);
      importStatusRef.current.set(item.id, { status: item.status, inFlight: currentInFlight });
      if (!previous || !previous.inFlight || currentInFlight) continue;

      if (item.status === 'completed') {
        const isReanalysis = previous.status === 'completed';
        const hasWarnings = item.analysis_status === 'partial' || item.analysis_status === 'failed';
        setImportNotice({
          kind: hasWarnings ? 'warning' : 'success',
          title: hasWarnings
            ? 'Book analysis finished with warnings'
            : isReanalysis ? 'Book analysis is ready' : 'New library is ready',
          detail: isReanalysis
            ? `${item.source_filename} finished reprocessing.`
            : `${item.source_filename} finished processing and is now being activated.`,
        });

        if (!isReanalysis && !activationAttemptsRef.current.has(item.id)) {
          activationAttemptsRef.current.add(item.id);
          void setActiveImport(item.id)
            .catch((error) => {
              console.error('Automatic import activation fallback failed:', error);
            })
            .finally(() => {
              refetchImport();
              refetchImportList();
              void refetchProfiles();
            });
        } else {
          refetchImportList();
        }
      } else {
        setImportNotice({
          kind: 'warning',
          title: item.status === 'cancelled' ? 'Book import cancelled' : 'Book import failed',
          detail: item.error_message || `${item.source_filename} stopped before it could become the active library.`,
        });
      }
    }

    if (latestImport && !allImports.some((item) => item.id === latestImport.id)) {
      refetchImport();
    }
  }, [allImports, importsListLoading, latestImport, refetchImport, refetchImportList, refetchProfiles, userId]);

  useEffect(() => {
    if (!userId || importsListLoading) return;

    let contextsChanged = false;
    for (const item of allImports) {
      if (!isPendingHardDelete(item) || pendingDeletionContextsRef.current.has(item.id)) continue;
      const strategy = getPersistedDeleteStrategy(item);
      if (!strategy) continue;
      const fallback = getNextUsableLibrarySnapshot(allImports, item.id);
      pendingDeletionContextsRef.current.set(item.id, {
        importId: item.id,
        sourceFilename: item.source_filename,
        strategy,
        wasActive: strategy === 'start_over' || latestImport?.id === item.id,
        fallbackFilename: fallback?.source_filename ?? null,
      });
      contextsChanged = true;
    }

    const visibleIds = new Set(allImports.map((item) => item.id));
    for (const [importId, context] of pendingDeletionContextsRef.current) {
      if (visibleIds.has(importId)) continue;

      pendingDeletionContextsRef.current.delete(importId);
      contextsChanged = true;
      if (backgroundImport?.importId === importId) setBackgroundImport(null);
      if (route.name === 'import' && route.importId === importId) {
        navigate({ name: 'settings' }, { replace: true });
      }

      if (!deleteAllLibrariesSubmittingRef.current) {
        setImportNotice({
          kind: 'success',
          title: context.strategy === 'start_over' && context.wasActive
            ? 'Book deleted. DropDex is ready to start over.'
            : 'Book deleted',
          detail: context.strategy === 'activate_next' && context.wasActive && context.fallbackFilename
            ? `${context.sourceFilename} was permanently deleted. ${context.fallbackFilename} is now your active library.`
            : `${context.sourceFilename} and its Rekordbox-imported data were permanently deleted.`,
        });
      }

      // The parent-row disappearance is the terminal hard-delete event. Re-read
      // the canonical user setting now, rather than trusting any transient
      // active-library fallback the client rendered while deletion was pending.
      refetchImport();
      void refetchProfiles();
    }

    if (contextsChanged) {
      setPendingDeletionIds(new Set(pendingDeletionContextsRef.current.keys()));
    }
  }, [
    allImports, backgroundImport?.importId, importsListLoading, latestImport?.id, navigate,
    refetchImport, refetchProfiles, route, userId,
  ]);

  const avgBpm = selectedPlaylistStats?.averageBpm != null
    ? selectedPlaylistStats.averageBpm.toFixed(1)
    : null;
  const totalDuration = selectedPlaylistStats?.totalDurationSeconds || null;
  const topKey = selectedPlaylistStats?.mostCommonKey ?? null;

  // Map rekordbox_playlist_id → profile for the current USB
  const usbKeyOwner = latestImport ? playlistKeyOwner(latestImport) : '';
  const playlistProfilesByRbId = useMemo(() => {
    // The USB's id, or '' when unknown — consistent with how PlaylistEditView builds the key
    const prefix = `${usbKeyOwner}::`;
    const map = new Map<string, UserPlaylistProfile>();
    for (const [key, profile] of playlistProfiles) {
      if (key.startsWith(prefix)) map.set(key.slice(prefix.length), profile);
    }
    return map;
  }, [playlistProfiles, usbKeyOwner]);

  // Profile for the currently selected playlist (used in detail header + edit)
  const currentPlaylistProfile = useMemo(() => {
    if (!selectedPlaylist) return null;
    return playlistProfilesByRbId.get(selectedPlaylist.rekordbox_playlist_id) ?? null;
  }, [selectedPlaylist, playlistProfilesByRbId]);

  // Profile for the playlist being edited
  const existingProfileForEditing = useMemo(() => {
    if (!editingPlaylist) return null;
    const key = buildPlaylistIdentityKey(usbKeyOwner, editingPlaylist.rekordbox_playlist_id);
    return playlistProfiles.get(key) ?? null;
  }, [editingPlaylist, usbKeyOwner, playlistProfiles]);

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
    || (route.name === 'drop-lab' && ((Boolean(route.sourceTrackId) && !dropLabSourceTrack) || candidateTrackMissing || candidateImportMismatch))
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
      case 'artist-library': navigate({ name: 'artist-library' }); break;
      case 'cues': navigate({ name: 'cues' }); break;
      case 'audition': navigate({ name: 'audition' }); break;
      case 'settings': navigate({ name: 'settings' }); break;
      case 'discovery': navigate({ name: 'discovery' }); break;
      case 'flip-lab': navigate({ name: 'flip-lab' }); break;
      case 'usb': navigate({ name: 'usb' }); break;
      case 'set-lab': navigate({ name: 'set-lab' }); break;
      case 'drop-lab': navigate({ name: 'drop-lab', sourceTrackId: null, candidateTrackId: null, sourceDropId: null, candidateDropId: null }); break;
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

  const handleImportStarted = (_importId: string) => {
    refetchImportList();
  };

  const handleImportBackgrounded = (nextImportId: string, usbReleased: boolean) => {
    setBackgroundImport({ importId: nextImportId, usbReleased });
    setIsImportModalOpen(false);
    refetchImportList();
    refetchImport();
  };

  const handleSetActiveImport = async (nextImportId: string) => {
    try {
      await setActiveImport(nextImportId);
      refetchImport();
    } catch (err) {
      console.error('Failed to set active import:', err);
    }
  };

  const openDeleteConfirmation = async (
    importId: string,
    executor: ConfirmedDeleteExecutor | null = null,
  ) => {
    setDeleteLibraryError(null);
    deleteExecutorRef.current = executor;

    let target = allImports.find((item) => item.id === importId) ?? null;
    if (!target) {
      try {
        target = await fetchImportById(importId);
      } catch (error) {
        console.error('Failed to load import before delete confirmation:', error);
      }
    }

    if (!target) {
      deleteExecutorRef.current = null;
      setImportNotice({
        kind: 'warning',
        title: 'Book is no longer available',
        detail: 'DropDex could not find that import. Refresh Import History before trying another destructive action.',
      });
      refetchImportList();
      refetchImport();
      return;
    }

    setDeleteLibraryTarget(target);
  };

  const handleDeleteImport = (imp: RekordboxImport) => {
    deleteExecutorRef.current = null;
    setDeleteLibraryError(null);
    setDeleteLibraryTarget(imp);
  };

  const handleConfirmDeleteImport = async (requestedStrategy: DeleteActiveStrategy) => {
    const imp = deleteLibraryTarget;
    if (!imp || deleteLibrarySubmittingRef.current) return;

    const persistedStrategy = getPersistedDeleteStrategy(imp);
    const activeStrategy = persistedStrategy ?? requestedStrategy;
    const isActive = imp.id === latestImport?.id || persistedStrategy === 'start_over';
    const fallback = getNextUsableLibrarySnapshot(allImports, imp.id);
    const context: PendingDeletionContext = {
      importId: imp.id,
      sourceFilename: imp.source_filename,
      strategy: activeStrategy,
      wasActive: isActive,
      fallbackFilename: fallback?.source_filename ?? null,
    };

    deleteLibrarySubmittingRef.current = true;
    setDeleteLibrarySubmitting(true);
    setDeleteLibraryError(null);

    try {
      pendingDeletionContextsRef.current.set(imp.id, context);
      setPendingDeletionIds(new Set(pendingDeletionContextsRef.current.keys()));

      const customExecutor = deleteExecutorRef.current;
      let result: Awaited<ReturnType<typeof deleteRekordboxImport>> | null = null;
      if (customExecutor) {
        await customExecutor(activeStrategy);
      } else {
        const token = session?.access_token;
        if (!token) throw new Error('Your session expired. Sign in again before deleting a library.');

        // A cleanup/finalization 503 can be transient, but blindly retrying every
        // 503 hundreds of times hides persistent Storage/DB faults and floods the
        // API. Make a small bounded retry attempt, then surface the structured
        // backend diagnostic so the user can retry after the actual fault is fixed.
        const MAX_AUTOMATIC_DELETE_RETRIES = 3;
        for (let attempt = 0; attempt <= MAX_AUTOMATIC_DELETE_RETRIES; attempt++) {
          try {
            result = await deleteRekordboxImport(imp.id, token, undefined, activeStrategy);
            setDeleteLibraryRetryCount(0);
            break;
          } catch (err) {
            const retryableDelete503 = err instanceof RekordboxImportError
              && err.status === 503
              && err.structured?.retryable === true
              && (err.structured.error_code === 'DELETE_CLEANUP_FAILED'
                || err.structured.error_code === 'DELETE_FINALIZE_FAILED');
            if (retryableDelete503 && attempt < MAX_AUTOMATIC_DELETE_RETRIES) {
              setDeleteLibraryRetryCount(attempt + 1);
              await new Promise<void>((resolve) => setTimeout(resolve, 3000));
              continue;
            }
            throw err;
          }
        }
      }

      deleteExecutorRef.current = null;
      setDeleteLibraryTarget(null);

      if (result?.status !== 'cancelled') {
        setImportNotice({
          kind: 'warning',
          title: 'Delete is waiting for worker shutdown',
          detail: 'DropDex will keep observing this hard delete until the worker stops and the import disappears. Your original deletion choice is preserved.',
        });
      }

      // For Start Over, this refetch returns null even while the target is still
      // stopping because fetchActiveImport honors the persisted server intent.
      if (isActive || activeStrategy === 'start_over') refetchImport();
      refetchImportList();
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : 'DropDex could not delete this library. Please retry.';
      const developerDiagnostic = import.meta.env.DEV
        && err instanceof RekordboxImportError
        && err.structured?.diagnostic
        ? ` (${err.structured.stage ?? 'cleanup'}: ${err.structured.diagnostic})`
        : '';
      console.error('Failed to delete import:', err);
      setDeleteLibraryError(`${baseMessage}${developerDiagnostic}`);
      setDeleteLibraryRetryCount(0);
      pendingDeletionContextsRef.current.delete(imp.id);
      setPendingDeletionIds(new Set(pendingDeletionContextsRef.current.keys()));
      // If the backend had already entered a retryable pending-delete state, the
      // refetched durable row will re-register the persisted strategy.
      refetchImportList();
    } finally {
      deleteLibrarySubmittingRef.current = false;
      setDeleteLibrarySubmitting(false);
    }
  };

  const handleConfirmDeleteAllLibraries = async () => {
    if (deleteAllLibrariesSubmittingRef.current) return;
    const token = session?.access_token;
    if (!token) {
      setDeleteAllLibrariesError('Your session expired. Sign in again before deleting library data.');
      return;
    }

    const initialCount = allImports.length;
    deleteAllLibrariesSubmittingRef.current = true;
    setDeleteAllLibrariesSubmitting(true);
    setDeleteAllLibrariesError(null);
    setDeleteAllLibrariesPass(0);
    setDeleteAllLibrariesInitialCount(initialCount);
    setDeleteAllLibrariesRemainingCount(initialCount);

    try {
      // A bulk reset is a sequence of the existing durable hard-delete operation.
      // Workers can need time to acknowledge stop, so retry clean pending passes
      // without turning persistent cleanup/database errors into an endless loop.
      const MAX_BULK_DELETE_PASSES = 40;
      for (let pass = 1; pass <= MAX_BULK_DELETE_PASSES; pass++) {
        setDeleteAllLibrariesPass(pass);
        const result = await deleteAllRekordboxImports(token);
        setDeleteAllLibrariesRemainingCount(result.remaining_count);
        refetchImportList();
        refetchImport();

        if (result.remaining_count === 0) {
          pendingDeletionContextsRef.current.clear();
          setPendingDeletionIds(new Set());
          setBackgroundImport(null);
          setDeleteAllLibrariesOpen(false);
          setDeleteAllLibrariesError(null);
          setImportNotice({
            kind: 'success',
            title: 'All Rekordbox library data deleted',
            detail: 'Every Rekordbox snapshot and its imported library data were permanently removed. DropDex is ready for a fresh USB import.',
          });
          return;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      }

      throw new Error(
        'Some library snapshots are still waiting for worker shutdown. Retry Delete All to continue the same cleanup.',
      );
    } catch (err) {
      const baseMessage = err instanceof Error
        ? err.message
        : 'DropDex could not delete all Rekordbox library data. Please retry.';
      const developerDiagnostic = import.meta.env.DEV
        && err instanceof RekordboxImportError
        && err.structured?.diagnostic
        ? ` (${err.structured.stage ?? 'cleanup'}: ${err.structured.diagnostic})`
        : '';
      console.error('Failed to delete all Rekordbox library data:', err);
      setDeleteAllLibrariesError(`${baseMessage}${developerDiagnostic}`);
      refetchImportList();
      refetchImport();
    } finally {
      deleteAllLibrariesSubmittingRef.current = false;
      setDeleteAllLibrariesSubmitting(false);
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
    navigateBack(route.name === 'drop-lab' && route.sourceTrackId
      ? { name: 'track', trackId: route.sourceTrackId }
      : libraryRoute());
  };

  const handleDropLabPickSource = (sourceTrackId: string, candidateTrackId: string | null, options: { auto: boolean }) => {
    navigate(
      { name: 'drop-lab', sourceTrackId, candidateTrackId, sourceDropId: null, candidateDropId: null },
      { replace: options.auto },
    );
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

  const libraryLabel = userProfile?.display_name ?? 'My Book';

  const sidebarNavItems: { view: View; icon: React.ElementType; label: string }[] = [
    { view: 'home', icon: NAV_ICONS.home, label: libraryLabel },
    { view: 'artist-library', icon: NAV_ICONS['artist-library'], label: 'Artist Library' },
    { view: 'cues', icon: NAV_ICONS.cues, label: 'Cue Points' },
    { view: 'audition', icon: NAV_ICONS.audition, label: 'Audition' },
    { view: 'discovery', icon: NAV_ICONS.discovery, label: 'Discover' },
    { view: 'drop-lab', icon: NAV_ICONS['drop-lab'], label: 'Drop Lab' },
    { view: 'set-lab', icon: NAV_ICONS['set-lab'], label: 'Set Lab' },
    { view: 'flip-lab', icon: NAV_ICONS['flip-lab'], label: 'Flip Lab' },
    { view: 'usb', icon: NAV_ICONS.usb, label: 'USB Management' },
  ];

  const titledPage = (title: string, onBack: (() => void) | null = goBack): PageHeading => ({ title, onBack });
  const pageHeading: PageHeading | null = (() => {
    if (currentView === 'not-found') return null;
    if (currentView === 'playlist-edit') return editingPlaylist ? titledPage(editingPlaylist.name) : null;
    if (currentView === 'import') return titledPage('Imported Library');
    if (routeBlocked) return null;
    switch (currentView) {
      case 'home': return titledPage(libraryLabel, null);
      case 'playlist':
        return {
          title: selectedPlaylist?.name ?? 'Playlist',
          onBack: goBack,
          details: (
            <div className="flex flex-wrap items-center gap-2">
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
              {selectedPlaylist && !selectedPlaylist.is_folder && (
                <ControlButton variant="neutral" onClick={() => selectedPlaylist && handleEditPlaylist(selectedPlaylist)} className="ml-auto text-xs">
                  <EditPencil width={12} height={12} aria-hidden="true" /> Edit
                </ControlButton>
              )}
            </div>
          ),
        };
      case 'track': return titledPage('Track Intelligence');
      case 'artist-library': return titledPage(`${userProfile?.display_name?.trim() || 'My'} Library`);
      case 'settings': return titledPage('Profile');
      case 'discovery': return titledPage('Discovery');
      case 'flip-lab': return titledPage('Flip Lab');
      case 'usb': return titledPage('USB Management');
      case 'drop-lab': return titledPage('Drop Lab', handleDropLabBack);
      case 'set-lab': return titledPage('Set Lab');
      case 'cues': return titledPage('Cue Points');
      case 'audition': return titledPage('Audition');
      default: return null;
    }
  })();

  const pageIcon: React.ElementType | undefined = (
    sidebarNavItems.find((item) => item.view === currentView)?.icon
    ?? ({ settings: User, import: Upload } as Partial<Record<View, React.ElementType>>)[currentView]
    ?? MusicNote
  );

  return (
    <UsbConnectionProvider>
    <AudioPlayerProvider imports={allImports}>
    <AudioDockWorkspaceProvider>
    <>
    <RootFailureProbe />
    <PlaylistDockQueue entries={playlistTracks} enabled={currentView === 'playlist' && !playlistSynced.blocked} />
    <div className="flex h-screen flex-col overflow-hidden font-sans relative">
      {/* Background ambience */}
      <div className="app-backdrop fixed inset-0 -z-10 overflow-hidden" data-testid="app-backdrop">
        <div className="ambience-blob absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full" />
        <div className="ambience-blob absolute bottom-[10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[100px] rounded-full" />
      </div>

      {/* ── Page name: a small floating group at the top middle; it takes no space, so the page fills the window ── */}
      {pageHeading && <FloatingPageHeader title={pageHeading.title} icon={pageIcon} />}

      <div className="flex min-h-0 flex-1">
      {/* ── Desktop sidebar ── */}
      <FloatingSidebar
        items={sidebarNavItems}
        currentView={currentView}
        onSelectView={(view) => setCurrentView(view as View)}
        onOpenProfile={() => navigate({ name: 'profile' })}
        profile={userProfile}
      />

      {/* ── Main content column ── */}
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* Scrollable content */}
        <main className={cn(
          'flex-1',
          (currentView === 'flip-lab' || currentView === 'audition' || currentView === 'settings')
            ? 'flex min-h-0 flex-col overflow-hidden p-6'
            : 'min-h-0 overflow-y-auto p-6',
          (currentView === 'cues' || currentView === 'audition' || currentView === 'discovery') && 'scrollbar-none',
        )}>
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
                {...PAGE_MOTION}
              >
                <LibraryView
                  latestImport={latestImport}
                  importLoading={importLoading}
                  importError={importError}
                  hiddenWidgets={libraryOverviewWidgets.hidden}
                  importId={importId}
                  profile={userProfile}
                  genres={userGenres}
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
                {...PAGE_MOTION}
                className="space-y-4"
              >
                <div className="glass p-6 rounded-3xl mb-6 relative overflow-hidden">
                  <GraphUp className="absolute -right-4 -bottom-4 text-primary/10 w-24 h-24" aria-hidden="true" />
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
                            {(selectedPlaylistStats?.trackCount ?? selectedPlaylist?.track_count)?.toLocaleString() ?? '…'}
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

                <div className="cue-studio"><FilterDropdown {...playlistSynced.dropdown} className="cue-browser__filter" /></div>
                {playlistSynced.error && <SyncedFilterError error={playlistSynced.error} onRetry={playlistSynced.cloud.retry} />}
                {playlistTracksError && <p className="text-sm text-red-300" role="alert">{playlistTracksError}</p>}
                {playlistResultsLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Refresh className="animate-spin text-control-primary" width={32} height={32} aria-hidden="true" />
                  </div>
                )}

                {!playlistResultsLoading && !playlistSynced.error && (
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
                    {!playlistTracksError && playlistTracks.length === 0 && (
                      <p className="text-center py-12 text-muted-foreground italic col-span-full">
                        {playlistSynced.value === 'all' ? 'No tracks in this playlist.' : 'No tracks match the Synced filter.'}
                      </p>
                    )}
                  </div>
                )}

                {!playlistResultsLoading && !playlistSynced.error && playlistTracksHaveMore && (
                  <div className="flex justify-center">
                    <ControlButton variant="neutral" onClick={() => { void loadMorePlaylistTracks(); }} disabled={playlistTracksLoadingMore}>
                      {playlistTracksLoadingMore ? (
                        <><Refresh width={13} height={13} className="animate-spin" aria-hidden="true" /> Loading more…</>
                      ) : (
                        `Load ${Math.min(200, playlistTrackTotal - playlistTracks.length).toLocaleString()} more…`
                      )}
                    </ControlButton>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Playlist Edit ── */}
            {!routeBlocked && currentView === 'playlist-edit' && editingPlaylist && latestImport && userId && (
              <motion.div
                key="playlist-edit"
                {...PAGE_MOTION}
                className="min-w-0"
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
                {...PAGE_MOTION}
                className="min-w-0"
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

            {currentView === 'set-lab' && (
              <div key="set-lab" className="min-w-0">
                {!importSettled || importLoading ? (
                  <RouteLoadingState label="Loading active library…" variant="workspace" />
                ) : importError ? (
                  <RouteLoadErrorState message={importError} onRetry={refetchImport} onReturnToLibrary={returnToLibrary} />
                ) : userId && latestImport && latestImport.user_id === userId ? (
                  <LazyFeature
                    label="Loading Set Lab…"
                    skeleton="workspace"
                    boundaryKey={`set-lab:${userId}:${latestImport.id}`}
                    onReturnToLibrary={returnToLibrary}
                  >
                    <SetLabView
                      key={`${userId}:${latestImport.id}`}
                      scope={{ userId, sourceImportId: latestImport.id }}
                      importDeviceName={latestImport.device_name}
                      onReturnToLibrary={returnToLibrary}
                    />
                  </LazyFeature>
                ) : (
                  <section className="mx-auto max-w-md py-16 text-center">
                    <h2 className="text-2xl font-black">No active Rekordbox library</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Import or activate a library to open Set Lab.</p>
                    <ControlButton type="button" variant="primary" className="mt-4" onClick={returnToLibrary}>
                      Return to Library
                    </ControlButton>
                  </section>
                )}
              </div>
            )}

            {/* ── Drop Lab ── */}
            {!routeBlocked && currentView === 'drop-lab' && (
              <motion.div
                key="drop-lab"
                {...PAGE_MOTION}
                className="min-w-0"
              >
                <LazyFeature label="Loading Drop Lab…" skeleton="workspace" boundaryKey={`${routeKey(route)}:drop-lab`} onReturnToLibrary={returnToLibrary}>
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
                    onPickSource={handleDropLabPickSource}
                  />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Import status ── */}
            {!routeBlocked && currentView === 'import' && selectedImport && (
              <motion.div
                key="import"
                {...PAGE_MOTION}
                className="min-w-0"
              >
                <ImportLibraryView
                  item={selectedImport}
                  isActive={selectedImport.id === latestImport?.id}
                  onMakeActive={() => { void handleSetActiveImport(selectedImport.id); }}
                  onResume={() => navigate({ name: 'import', importId: selectedImport.id, resume: true }, { replace: true })}
                  onRetryImport={() => setIsImportModalOpen(true)}
                  onRetryDelete={() => handleDeleteImport(selectedImport)}
                  onBack={returnToLibrary}
                />
              </motion.div>
            )}

            {/* ── Cue Points ── */}
            {!routeBlocked && currentView === 'cues' && (
              <motion.div
                key={currentView}
                {...PAGE_MOTION}
                className="min-w-0"
              >
                <LazyFeature label="Loading Cue Points…" boundaryKey={routeKey(route)} onReturnToLibrary={returnToLibrary}>
                  <CuePointsView importId={importId} key={currentView} mode="cues" onImport={() => setIsImportModalOpen(true)} />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Audition ── */}
            {!routeBlocked && currentView === 'audition' && (
              <motion.div
                key={currentView}
                {...PAGE_MOTION}
                className="min-w-0"
              >
                <LazyFeature label="Loading Audition…" boundaryKey={routeKey(route)} onReturnToLibrary={returnToLibrary}>
                  <AuditionView importId={importId} onImport={() => setIsImportModalOpen(true)} />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Artist Library ── */}
            {!routeBlocked && currentView === 'artist-library' && (
              <motion.div
                key="artist-library"
                {...PAGE_MOTION}
                className="space-y-6"
              >
                <LazyFeature label="Loading Artist Library…" boundaryKey={`${routeKey(route)}:artist-library`} onReturnToLibrary={returnToLibrary}>
                  {!importId || !latestImport ? (
                    <ArtistLibraryEmptyState onImport={() => setIsImportModalOpen(true)} />
                  ) : (
                    <ArtistLibraryView
                      importId={importId}
                      playlists={playlists}
                      playlistsLoading={playlistsLoading}
                      playlistProfilesByRbId={playlistProfilesByRbId}
                      recentTracks={recentTracks}
                      recentTracksLoading={recentTracksLoading}
                      onPlaylistClick={handlePlaylistClick}
                      onEditPlaylist={handleEditPlaylist}
                      onImport={() => setIsImportModalOpen(true)}
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
                {...PAGE_MOTION}
                className="profile-layout"
              >
                <TabNavigation
                  ariaLabel="Profile sections"
                  className="profile-tabs"
                  options={[...PROFILE_TABS]}
                  value={settingsTab}
                  onChange={(tab) => setSettingsTab(tab as ProfileTab)}
                />
                <div className="studio-surface profile-workspace">
                  {settingsTab === 'rekordbox' && (
                    <RekordboxXmlGroup userId={userId} />
                  )}

                  {settingsTab === 'external-music' && (
                    <ExternalMusicTab accessToken={session?.access_token ?? null} />
                  )}

                  {/* ── Account tab ── */}
                  {settingsTab === 'account' && userId && (
                    <EditProfileView
                      userId={userId}
                      existingProfile={userProfile}
                      onPreferencesChanged={() => void refetchUserGenres()}
                      onSaved={(_saved) => {
                        void refetchUserProfile();
                        void refetchUserGenres();
                      }}
                    />
                  )}

                  {/* ── Personalization tab ── */}
                  {settingsTab === 'appearance' && (
                    <div className="profile-stack">
                      <section className="profile-group">
                        <h2 className="profile-heading">Theme</h2>
                        <div>
                          <p className="text-sm font-bold">Choose your color scheme</p>
                          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Dark is the default. Light has higher contrast, and CDJ is built for a performance deck.</p>
                          <div className="profile-choice-grid" role="radiogroup" aria-label="Theme">
                            {THEME_OPTIONS.map(({ id, label, description, icon: Icon }) => (
                              <SelectableOptionCard
                                key={id}
                                selected={theme === id}
                                title={label}
                                description={description}
                                hero={<Icon width={26} height={26} aria-hidden="true" style={{ color: THEME_HERO[id].ink }} />}
                                heroBackground={THEME_HERO[id].background}
                                horizontal
                                onSelect={() => setTheme(id)}
                              />
                            ))}
                          </div>
                        </div>
                      </section>
                      <DashboardWidgetsGroup widgets={libraryOverviewWidgets} />
                      <DisplayPreferencesGroup />
                    </div>
                  )}

                  {/* ── Library tab ── */}
                  {settingsTab === 'library' && (
                    <div className="profile-stack">
                      <section className="profile-group">
                        <h2 className="profile-heading"><Database width={14} height={14} aria-hidden="true" />Library</h2>
                        {latestImport && (
                          <div className="profile-stats">
                            <StatTile
                              label={usbCount === 1 ? 'USB' : 'USBs'}
                              value={<span data-testid="library-usb-count">{usbCount.toLocaleString()}</span>}
                            />
                            <StatTile label="Tracks" value={latestImport.track_count.toLocaleString()} />
                            <StatTile label="Playlists" value={latestImport.playlist_count.toLocaleString()} />
                          </div>
                        )}
                      </section>

                      {/* USBs, each with the library snapshots that came from it */}
                      <section className="profile-group" data-testid="profile-usbs">
                        <h2 className="profile-heading"><Usb width={14} height={14} aria-hidden="true" />USBs</h2>
                        {usbDevicesLoading || importsListLoading ? (
                          <div className="flex justify-center py-6"><StatusLoader label="Loading USBs and imports" /></div>
                        ) : importsListError ? (
                          <NoticeCard
                            tone="error"
                            title="Could not load imports"
                            action={<ControlButton variant="secondary" onClick={refetchImportList}><Refresh width={14} height={14} aria-hidden="true" /> Retry</ControlButton>}
                          >
                            {importsListError}
                          </NoticeCard>
                        ) : (
                          <UsbCardsSection
                            groups={usbGroups}
                            activeImportId={latestImport?.id ?? null}
                            onOpen={(imp) => navigate({ name: 'import', importId: imp.id, resume: false })}
                            onMakeActive={(imp) => handleSetActiveImport(imp.id)}
                            onResumeOrRetry={(imp) => {
                              if (imp.status === 'completed' || imp.status === 'paused' || imp.status === 'interrupted') {
                                navigate({ name: 'import', importId: imp.id, resume: true });
                              } else {
                                setIsImportModalOpen(true);
                              }
                            }}
                            onDelete={handleDeleteImport}
                          />
                        )}
                      </section>

                      <StreamingSyncGroup userId={userId} importId={latestImport?.id ?? null} trackCount={latestImport?.track_count ?? null} sourceName={latestImport?.device_name ?? latestImport?.source_filename ?? null} deviceName={latestImport?.device_name ?? null} />

                      {/* Danger zone */}
                      <section className="profile-group">
                        <h2 className="profile-heading">Library Reset</h2>
                        <div className="profile-records profile-record flex flex-wrap items-center justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <WarningTriangle width={18} height={18} aria-hidden="true" className="mt-0.5 shrink-0 text-red-400" />
                            <div className="min-w-0">
                              <p className="font-bold text-sm">Delete All Rekordbox Data</p>
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                Permanently remove every library snapshot and all imported Rekordbox data for this account.
                              </p>
                            </div>
                          </div>
                          <ControlButton
                            variant="danger-outline"
                            disabled={deleteAllLibrariesSubmitting}
                            onClick={() => {
                              setDeleteAllLibrariesError(null);
                              setDeleteAllLibrariesPass(0);
                              setDeleteAllLibrariesOpen(true);
                            }}
                          >
                            Delete All
                          </ControlButton>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* ── About tab ── */}
                  {settingsTab === 'about' && (
                    <div className="profile-stack">
                      <section className="profile-group">
                        <h2 className="profile-heading"><InfoCircle width={14} height={14} aria-hidden="true" />App Information</h2>
                        <div className="profile-stats">
                          <StatTile label="Version" value="2.0.0" />
                          <StatTile label="Library Source" value="Supabase (Rekordbox USB)" />
                          <StatTile label="Import ID" value={latestImport?.id?.slice(0, 8) ?? '—'} />
                        </div>
                      </section>
                    </div>
                  )}

                  {/* ── Developer tab ── */}
                  {settingsTab === 'developer' && <DeveloperTab />}
                </div>
                {settingsTab === 'account' && userId && (
                  <div className="profile-signout">
                    <ControlButton variant="secondary" onClick={() => void supabase.auth.signOut()}><LogOut width={14} height={14} aria-hidden="true" /> Sign Out</ControlButton>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Discovery ── */}
            {!routeBlocked && currentView === 'discovery' && (
              <motion.div
                key="discovery"
                {...PAGE_MOTION}
                className="min-w-0"
              >
                <LazyFeature label="Loading Discovery…" skeleton="cards" boundaryKey={`${routeKey(route)}:discovery`} onReturnToLibrary={returnToLibrary}>
                  <DiscoveryView accessToken={session?.access_token ?? null} userId={userId} onEditTaste={handleEditProfile} />
                </LazyFeature>
              </motion.div>
            )}

            {/* ── Flip Lab ── */}
            {!routeBlocked && currentView === 'flip-lab' && (
              <motion.div
                key="flip-lab"
                {...PAGE_MOTION}
                className="flex min-h-0 flex-1 flex-col"
              >
                <FlipLabView
                  activeImport={latestImport ?? null}
                  activeImportLoading={importLoading}
                  activeImportError={importError}
                />
              </motion.div>
            )}

            {/* ── USB Management ── */}
            {!routeBlocked && currentView === 'usb' && (
              <motion.div
                key="usb"
                {...PAGE_MOTION}
                className="min-w-0"
              >
                <LazyFeature label="Loading USB Management…" boundaryKey={routeKey(route)} onReturnToLibrary={returnToLibrary}>
                  <UsbManagementView />
                </LazyFeature>
              </motion.div>
            )}

          </AnimatePresence>
          </ApplicationErrorBoundary>
        </main>
        <FloatingLayoutLabButton onOpen={openLayoutLab} />
      </div>
      </div>

      <NowPlayingBar
        independentWorkspace={currentView === 'drop-lab' ? 'Drop Lab'
          : currentView === 'set-lab' ? 'Set Lab' : currentView === 'flip-lab' ? 'Flip Lab' : undefined}
        holdWorkspaceTrack={currentView === 'artist-library' || currentView === 'cues' || currentView === 'audition'}
      />

      {/* ── Mobile-only: navigation below the always-present dock ── */}
      <MobileNavBar
        currentView={currentView}
        setCurrentView={setCurrentView}
        libraryLabel={libraryLabel}
      />

      <AnimatePresence>
        <DeleteAllLibrariesModal
          key="delete-all-libraries"
          open={deleteAllLibrariesOpen}
          visibleSnapshotCount={allImports.length}
          deleting={deleteAllLibrariesSubmitting}
          cleanupPass={deleteAllLibrariesPass}
          initialCount={deleteAllLibrariesInitialCount}
          remainingCount={deleteAllLibrariesRemainingCount}
          error={deleteAllLibrariesError}
          onClose={() => {
            if (deleteAllLibrariesSubmitting) return;
            setDeleteAllLibrariesOpen(false);
            setDeleteAllLibrariesError(null);
            setDeleteAllLibrariesPass(0);
          }}
          onConfirm={handleConfirmDeleteAllLibraries}
        />

        <DeleteLibraryModal
          key="delete-library"
          target={deleteLibraryTarget}
          profileStyle={currentView === 'settings'}
          isActive={Boolean(deleteLibraryTarget && (
            deleteLibraryTarget.id === latestImport?.id
            || pendingDeletionContextsRef.current.get(deleteLibraryTarget.id)?.wasActive
          ))}
          nextUsableImport={deleteLibraryTarget ? getNextUsableLibrarySnapshot(allImports, deleteLibraryTarget.id) : null}
          deleting={deleteLibrarySubmitting}
          deletingRetryCount={deleteLibraryRetryCount}
          error={deleteLibraryError}
          onClose={() => {
            if (deleteLibrarySubmitting) return;
            setDeleteLibraryTarget(null);
            setDeleteLibraryError(null);
            deleteExecutorRef.current = null;
          }}
          onConfirm={handleConfirmDeleteImport}
        />

        {importNotice && (
          <motion.div
            key="import-notice"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            className={cn(
              'fixed right-4 top-4 z-[80] flex max-w-sm items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl',
              importNotice.kind === 'success'
                ? 'border-emerald-500/25 bg-emerald-950/90 text-emerald-50'
                : 'border-amber-500/25 bg-amber-950/90 text-amber-50',
            )}
            role="status"
          >
            {importNotice.kind === 'success'
              ? <CheckCircle width={20} height={20} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-400" />
              : <WarningTriangle width={20} height={20} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400" />}
            <div className="min-w-0">
              <p className="text-sm font-black">{importNotice.title}</p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">{importNotice.detail}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {backgroundImport && session?.access_token && (
        <BackgroundImportPanel
          importId={backgroundImport.importId}
          usbReleased={backgroundImport.usbReleased}
          accessToken={session.access_token}
          onClose={() => {
            if (backgroundImport.usbReleased) setBackgroundImport(null);
          }}
          onManageLocalUpload={() => {
            setBackgroundImport(null);
            setIsImportModalOpen(true);
          }}
          onRequestDelete={() => {
            void openDeleteConfirmation(backgroundImport.importId);
          }}
          deletionPending={pendingDeletionIds.has(backgroundImport.importId)}
          onChanged={() => {
            refetchImport();
            refetchImportList();
          }}
        />
      )}

      <ImportLibraryModal
        isOpen={isImportModalOpen}
        accessToken={session?.access_token ?? null}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={handleImportSuccess}
        onImportStarted={handleImportStarted}
        onBackgrounded={handleImportBackgrounded}
        onRequestDelete={(importId, executor) => {
          void openDeleteConfirmation(importId, executor);
        }}
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
    </>
    </AudioDockWorkspaceProvider>
    </AudioPlayerProvider>
    </UsbConnectionProvider>
  );
}
