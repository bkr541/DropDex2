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
import { fetchImportById, fetchReviewTracks, setActiveImport } from './lib/queries/rekordbox';
import { deleteAllRekordboxImports, deleteRekordboxImport, RekordboxImportError } from './lib/api/rekordboxImport';
import { ImportLibraryModal } from './components/ImportLibraryModal';
import { BackgroundImportPanel } from './components/BackgroundImportPanel';
import { DeleteLibraryModal } from './components/DeleteLibraryModal';
import { DeleteAllLibrariesModal } from './components/DeleteAllLibrariesModal';
import { getImportHistoryPresentation } from './lib/rekordbox/importHistoryPresentation';
import {
  getNextUsableLibrarySnapshot,
  getPersistedDeleteStrategy,
  isPendingHardDelete,
  isUsableLibrarySnapshot,
  type DeleteActiveStrategy,
} from './lib/rekordbox/libraryDeletion';
import { getImportProgress, getInFlightImport, isImportInFlight, isImportStalled } from './lib/rekordbox/importLifecycle';
import { ResumeAnalysisModal } from './components/ResumeAnalysisModal';
import { ImportActivityBanner } from './components/imports/ImportActivityBanner';
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
const CuePointsView = lazyWithRecovery('cue-points', () => import('./components/cues/CuePointsView').then(m => ({ default: m.CuePointsView })));
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
import { useTheme } from './theme/ThemeProvider';
import type { ThemeId } from './theme/theme';
import { ReusableComponentsView } from './components/reusable/ReusableComponentsView';
import { CheckmarkFilled, ChevronLeft, CircleDash, Close, DataBase, Edit, Growth, Layers, Logout, Moon, Music, Radio, RecordingFilled, Renew, Search, Settings, Sun, Upload, Usb, User, WarningAlt } from '@carbon/icons-react';
import { ControlButton } from './components/ui/controls';

type ThemeOption = {
  id: ThemeId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark', label: 'Dark', description: 'Default', icon: Moon },
  { id: 'light', label: 'Light', description: 'High contrast', icon: Sun },
  { id: 'cdj', label: 'CDJ', description: 'Performance deck', icon: RecordingFilled },
];

function CuePointsNavIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" style={{ transform: 'rotate(180deg)' }} aria-hidden="true">
      <path d="M18,22a1,1,0,0,1-1-1V19H15a1,1,0,0,1,0-2h2V15a1,1,0,0,1,2,0v2h2a1,1,0,0,1,0,2H19v2A1,1,0,0,1,18,22Z" />
      <path d="M15,13h3a1,1,0,0,0,1-1V9a1,1,0,0,0-.29-.71l-6-6a1,1,0,0,0-1.42,0l-6,6A1,1,0,0,0,5,9V20a2,2,0,0,0,2,2h5a1,1,0,0,0,1-1V15A2,2,0,0,1,15,13Z" />
    </svg>
  );
}

type View = 'home' | 'playlist' | 'playlist-edit' | 'track' | 'review' | 'cues' | 'settings' | 'discovery' | 'search' | 'edit-profile' | 'drop-lab' | 'import' | 'reusable-components' | 'not-found';

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
    case 'import': return 'import';
    case 'review': return 'review';
    case 'cues': return 'cues';
    case 'discovery': return 'discovery';
    case 'search': return 'search';
    case 'profile': return 'edit-profile';
    case 'settings': return 'settings';
    case 'reusable-components': return 'reusable-components';
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
        <Growth size={20} />
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
  onRetryImport,
  onMakeActive,
  onRetryDelete,
  onBack,
}: {
  item: RekordboxImport;
  isActive: boolean;
  onResume: () => void;
  onRetryImport: () => void;
  onMakeActive: () => void;
  onRetryDelete?: () => void;
  onBack?: () => void;
}) {
  const presentation = getImportHistoryPresentation(
    item.status,
    Boolean(item.retryable),
    item.analysis_status,
  );
  const progress = getImportProgress(item);
  const inFlight = isImportInFlight(item);
  const stalled = isImportStalled(item);
  const statusLabel = stalled ? 'Interrupted' : presentation.label;
  const statusTone = stalled ? 'warning' : presentation.tone;
  const analysisCanResume = (item.status === 'completed' || item.status === 'paused' || item.status === 'interrupted')
    && !inFlight
    && item.analysis_status !== 'completed'
    && item.analysis_status !== 'not_requested';

  return (
    <section className="mx-auto max-w-2xl space-y-5 pt-4" data-testid="import-status-screen">
      <div className="glass rounded-3xl border border-[var(--color-border-subtle)] p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
              <DataBase className="text-primary" size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate">{item.source_filename}</h2>
              <p className="font-mono text-xs text-muted-foreground truncate">{item.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span className={cn(
              'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
              statusTone === 'error' ? 'bg-red-500/10 text-red-400' :
              statusTone === 'warning' ? 'bg-amber-500/10 text-amber-400' :
              statusTone === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
              'bg-blue-500/10 text-blue-400',
            )}>
              {statusLabel}
            </span>
            {onBack && (
              <ControlButton variant="ghost" onClick={onBack}>
                <Close size={18} />
              </ControlButton>
            )}
          </div>
        </div>

        {stalled && (
          <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-sm font-bold text-amber-300">This import stopped reporting progress</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              DropDex will no longer treat this historical job as active. Retry the import, or resume analysis when the metadata snapshot is complete.
            </p>
          </div>
        )}

        {inFlight && (
          <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Analysis is continuing in the background</p>
              <span className="font-mono text-xs font-bold text-primary">{progress.percent}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface)]">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} tracks
              {progress.currentTrackLabel ? ` · ${progress.currentTrackLabel}` : ''}
            </p>
            {!isActive && (
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Your previous active library remains visible until this snapshot reaches a terminal state. A successful snapshot will become active automatically.
              </p>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt className="text-[9px] uppercase text-muted-foreground">Tracks</dt><dd className="font-mono font-bold">{item.track_count.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Playlists</dt><dd className="font-mono font-bold">{item.playlist_count.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Imported</dt><dd className="font-mono text-xs font-bold">{new Date(item.imported_at).toLocaleDateString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Book</dt><dd className="font-mono text-xs font-bold">{isActive ? 'Active' : inFlight ? 'Pending' : 'Snapshot'}</dd></div>
        </dl>

        {item.error_message && (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{item.error_message}</p>
        )}

        <div className="mt-6 flex justify-center gap-3">
          {!isActive && !inFlight && !stalled && isUsableLibrarySnapshot(item) && presentation.canActivate && (
            <ControlButton type="button" variant="primary" onClick={onMakeActive}>
              <CheckmarkFilled size={16} /> Make Active
            </ControlButton>
          )}
          {analysisCanResume && (
            <ControlButton type="button" variant="primary" onClick={onResume}>
              <Renew size={16} /> Resume Analysis
            </ControlButton>
          )}
          {(presentation.canRetry || stalled) && !analysisCanResume && (
            <ControlButton type="button" variant="primary" onClick={onRetryImport}>
              <Upload size={16} /> Retry Import
            </ControlButton>
          )}
          {isPendingHardDelete(item) && onRetryDelete && (
            <ControlButton type="button" variant="danger-outline" onClick={onRetryDelete}>
              Retry Delete
            </ControlButton>
          )}
        </div>
      </div>
    </section>
  );
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
  const [reviewTracks, setReviewTracks] = useState<RekordboxTrack[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('dropdex-sidebar-collapsed') === 'true'
  );
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
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(() => new Set());
  const [settingsTab, setSettingsTab] = useState<'account' | 'appearance' | 'library' | 'about'>('account');
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
      case 'cues': navigate({ name: 'cues' }); break;
      case 'settings': navigate({ name: 'settings' }); break;
      case 'discovery': navigate({ name: 'discovery' }); break;
      case 'search': navigate({ name: 'search' }); break;
      case 'edit-profile': navigate({ name: 'profile' }); break;
      case 'reusable-components': navigate({ name: 'reusable-components' }); break;
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

    deleteAllLibrariesSubmittingRef.current = true;
    setDeleteAllLibrariesSubmitting(true);
    setDeleteAllLibrariesError(null);
    setDeleteAllLibrariesPass(0);

    try {
      // A bulk reset is a sequence of the existing durable hard-delete operation.
      // Workers can need time to acknowledge stop, so retry clean pending passes
      // without turning persistent cleanup/database errors into an endless loop.
      const MAX_BULK_DELETE_PASSES = 40;
      for (let pass = 1; pass <= MAX_BULK_DELETE_PASSES; pass++) {
        setDeleteAllLibrariesPass(pass);
        const result = await deleteAllRekordboxImports(token);
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

  const libraryLabel = userProfile?.display_name ?? 'My Book';

  const sidebarNavItems: { view: View; icon: React.ElementType; label: string; activeColor: string; activeBg: string }[] = [
    { view: 'home', icon: Music, label: libraryLabel, activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'review', icon: Growth, label: 'Review', activeColor: 'text-secondary neon-text-purple', activeBg: 'bg-secondary/10 border-secondary/20' },
    { view: 'cues', icon: CuePointsNavIcon, label: 'Cue Points', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'discovery', icon: Radio, label: 'Discover', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'search', icon: Search, label: 'Search', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'reusable-components', icon: Layers, label: 'Reusable Components', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
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
              Drop<span className="text-[var(--color-brand-primary)]">Dex</span>
            </span>
          )}
        </div>

        <nav className="flex flex-col gap-1 p-3 flex-1">
          {sidebarNavItems.map(({ view, icon: Icon, label, activeColor, activeBg }) => (
            <button
              key={label}
              onClick={() => setCurrentView(view)}
              title={sidebarCollapsed ? label : undefined}
              aria-current={currentView === view ? 'page' : undefined}
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
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic truncate">{selectedPlaylist?.name}</h2>
                  {selectedPlaylist && !selectedPlaylist.is_folder && (
                    <ControlButton variant="neutral" onClick={() => selectedPlaylist && handleEditPlaylist(selectedPlaylist)} className="ml-auto text-xs">
                      <Edit size={12} /> Edit
                    </ControlButton>
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
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic truncate">{editingPlaylist.name}</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Edit Playlist</p>
              </div>
            )}
            {!routeBlocked && currentView === 'track' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Track Intelligence</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Deep Scan Results</p>
              </div>
            )}
            {!routeBlocked && currentView === 'review' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Set Review Mode</h2>
                </div>
                <p className="text-[8px] text-secondary uppercase tracking-[0.2em] font-bold pl-7">Optimized for low-light</p>
              </div>
            )}
            {!routeBlocked && currentView === 'settings' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Settings</h2>
                </div>
                <div className="flex gap-1 mt-4 border-b border-[var(--color-border-faint)]">
                  {(['account', 'appearance', 'library', 'about'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSettingsTab(tab)}
                      className={cn(
                        'px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors border-b-2 -mb-px capitalize',
                        settingsTab === tab
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!routeBlocked && currentView === 'discovery' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Artist Discovery</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Setlists via 1001Tracklists</p>
              </div>
            )}
            {!routeBlocked && currentView === 'search' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Artist Search</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Melodic Dubstep &amp; Future Bass</p>
              </div>
            )}
            {currentView === 'import' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Import Status</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Durable import details</p>
              </div>
            )}
            {!routeBlocked && currentView === 'edit-profile' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Edit Profile</h2>
                </div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em] pl-7">Your Artist Identity</p>
              </div>
            )}
            {currentView === 'reusable-components' && (
              <div>
                <div className="flex items-center gap-2">
                  <ControlButton variant="ghost" onClick={goBack}>
                    <ChevronLeft size={20} />
                  </ControlButton>
                  <h2 className="text-2xl font-black italic">Reusable Components</h2>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-4 md:px-8 pb-32 md:pb-8">
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
                  <Growth className="absolute -right-4 -bottom-4 text-primary/10 w-24 h-24" />
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
                    <CircleDash className="animate-spin text-primary" size={32} />
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
                  <div className="flex justify-center">
                    <ControlButton variant="neutral" onClick={() => { void loadMorePlaylistTracks(); }} disabled={playlistTracksLoadingMore}>
                      {playlistTracksLoadingMore ? (
                        <><CircleDash size={13} className="animate-spin" /> Loading more…</>
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
                  onRetryImport={() => setIsImportModalOpen(true)}
                  onRetryDelete={() => handleDeleteImport(selectedImport)}
                  onBack={returnToLibrary}
                />
              </motion.div>
            )}

            {/* ── Cue Points ── */}
            {!routeBlocked && currentView === 'cues' && (
              <motion.div
                key="cues"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pt-1"
              >
                <LazyFeature label="Loading Cue Points…" boundaryKey={`${routeKey(route)}:cues`} onReturnToLibrary={returnToLibrary}>
                  <CuePointsView importId={importId} onImport={() => setIsImportModalOpen(true)} />
                </LazyFeature>
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
                {/* ── Account tab ── */}
                {settingsTab === 'account' && (
                  <section className="space-y-3">
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
                          <Logout size={18} className="text-muted-foreground" />
                          <p className="font-bold text-sm">Sign Out</p>
                        </div>
                        <ControlButton variant="ghost" onClick={() => supabase.auth.signOut()} className="text-xs">
                          <Logout size={14} /> Sign Out
                        </ControlButton>
                      </div>
                    </div>
                  </section>
                )}

                {/* ── Appearance tab ── */}
                {settingsTab === 'appearance' && (
                  <section className="space-y-3">
                    <div className="glass rounded-2xl p-5 space-y-4">
                      <div>
                        <p className="font-bold text-sm mb-0.5">Theme</p>
                        <p className="text-xs text-muted-foreground">Choose your preferred color scheme</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {THEME_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isActive = theme === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setTheme(option.id)}
                              aria-pressed={isActive}
                              className={cn(
                                'flex flex-col items-start gap-3 p-4 rounded-xl border-2 transition-all text-left',
                                isActive
                                  ? 'border-primary bg-primary/10'
                                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                              )}
                            >
                              <Icon size={22} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                              <div>
                                <p className="font-bold text-sm">{option.label}</p>
                                <p className="text-xs text-muted-foreground">{option.description}</p>
                              </div>
                              {isActive && (
                                <span className="text-[9px] font-bold uppercase tracking-widest text-primary">Active</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                {/* ── Library tab ── */}
                {settingsTab === 'library' && (
                  <>
                    {/* Library stat cards */}
                    <section className="space-y-3">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1.5"><DataBase size={11} />Library</h2>
                      {latestImport && (
                      <div className="grid grid-cols-3 gap-3">
                        {/* USB */}
                        <div className="glass rounded-2xl p-4 flex flex-col items-center text-center">
                          <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <rect x="3" y="7" width="14" height="10" rx="1" transform="translate(20 24) rotate(180)" style={{fill: '#348dff', opacity: 0.35}} />
                            <polyline points="8 12 10 13 10 11 12 12" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                            <path d="M17,15V9h4v6ZM4,17H16a1,1,0,0,0,1-1V8a1,1,0,0,0-1-1H4A1,1,0,0,0,3,8v8A1,1,0,0,0,4,17Z" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                          </svg>
                          <p className="mt-2 text-2xl font-black leading-none truncate w-full text-center">
                            {latestImport.device_name ?? latestImport.source_filename}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(latestImport.imported_at).toLocaleDateString()}
                          </p>
                        </div>

                        {/* Tracks */}
                        <div className="glass rounded-2xl p-4 flex flex-col items-center text-center">
                          <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7,19a2,2,0,1,1-2-2A2,2,0,0,1,7,19ZM9,7l2,2h8V4a1,1,0,0,0-1-1H6A1,1,0,0,0,5,4V7Z" style={{fill: '#348dff', opacity: 0.35}} />
                            <path d="M10,16a2.9,2.9,0,0,0-3-3v6" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                            <path d="M3,13V8A1,1,0,0,1,4,7H9l2,2h9a1,1,0,0,1,1,1V20a1,1,0,0,1-1,1H11" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                            <path d="M7,19a2,2,0,1,1-2-2A2,2,0,0,1,7,19ZM9,7l2,2h8V4a1,1,0,0,0-1-1H6A1,1,0,0,0,5,4V7Z" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                          </svg>
                          <p className="mt-2 text-2xl font-black tabular-nums leading-none">
                            {latestImport.track_count >= 1000
                              ? `${(latestImport.track_count / 1000).toFixed(1)}k`
                              : latestImport.track_count.toLocaleString()}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Tracks</p>
                        </div>

                        {/* Playlists */}
                        <div className="glass rounded-2xl p-4 flex flex-col items-center text-center">
                          <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18,4H4A1,1,0,0,0,3,5V19a1,1,0,0,0,1,1H18a1,1,0,0,0,1-1V5A1,1,0,0,0,18,4ZM9,16a2,2,0,1,1,2-2A2,2,0,0,1,9,16Z" style={{fill: '#348dff', opacity: 0.35}} />
                            <path d="M11,14V8a2.9,2.9,0,0,1,3,3" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                            <path d="M11,14a2,2,0,1,1-2-2A2,2,0,0,1,11,14Zm8,5V5a1,1,0,0,0-1-1H4A1,1,0,0,0,3,5V19a1,1,0,0,0,1,1H18A1,1,0,0,0,19,19Zm2-7a5,5,0,0,1-2,4V8A5,5,0,0,1,21,12Z" style={{fill: 'none', stroke: '#000000', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2}} />
                          </svg>
                          <p className="mt-2 text-2xl font-black tabular-nums leading-none">
                            {latestImport.playlist_count}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Playlists</p>
                        </div>
                      </div>
                    )}
                    </section>

                    {/* Snapshots */}
                    <section className="space-y-3">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1.5"><Layers size={11} />USB Library Snapshots</h2>
                      {importsListLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <CircleDash className="animate-spin text-muted-foreground" size={20} />
                        </div>
                      ) : importsListError ? (
                        <div className="glass rounded-2xl p-4 text-center space-y-2">
                          <p className="text-sm text-red-400">{importsListError}</p>
                          <ControlButton variant="ghost" onClick={refetchImportList} className="text-xs"><Renew size={13} /> Retry</ControlButton>
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
                              imp.status, Boolean(imp.retryable), imp.analysis_status,
                            );
                            const importProgress = getImportProgress(imp);
                            const importInFlight = isImportInFlight(imp);
                            const importStalled = isImportStalled(imp);
                            const showStatusBadge = imp.status !== 'completed'
                              || (imp.analysis_status !== 'completed' && imp.analysis_status !== 'not_requested');
                            return (
                              <div key={imp.id} data-testid={`import-history-row-${imp.id}`} className="p-4 flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <ControlButton
                                      type="button"
                                      variant="ghost"
                                      onClick={() => navigate({ name: 'import', importId: imp.id, resume: false })}
                                      aria-label={`Open import ${imp.source_filename}`}
                                      className="max-w-full text-left font-mono text-sm font-bold"
                                    >
                                      {imp.source_filename}
                                    </ControlButton>
                                    {isActive && (
                                      <span className="text-[9px] font-bold capitalize tracking-widest px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full shrink-0">
                                        Active
                                      </span>
                                    )}
                                    {showStatusBadge && (
                                      <span className={cn(
                                        "text-[9px] font-bold capitalize tracking-widest px-1.5 py-0.5 rounded-full shrink-0",
                                        importPresentation.tone === 'error' ? "bg-red-500/10 text-red-400" :
                                        (importPresentation.tone === 'warning' || importStalled) ? "bg-amber-500/10 text-amber-400" :
                                        "bg-blue-500/10 text-blue-400",
                                      )}>
                                        {importStalled ? 'Interrupted' : importPresentation.label}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                    {new Date(imp.imported_at).toLocaleDateString()} · {imp.track_count.toLocaleString()} tracks · {imp.playlist_count} playlists
                                  </p>
                                  {imp.device_name && (
                                    <p className="text-[10px] text-muted-foreground font-mono">{imp.device_name}</p>
                                  )}
                                  {importInFlight && (
                                    <div className="mt-2 max-w-md">
                                      <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                                        <span className="truncate">{importProgress.currentTrackLabel || 'Preparing current track…'}</span>
                                        <span className="shrink-0 font-mono">{importProgress.percent}%</span>
                                      </div>
                                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${importProgress.percent}%` }} />
                                      </div>
                                    </div>
                                  )}
                                  {(imp.status === 'failed' || imp.status === 'cancelled') && imp.error_message && (
                                    <p className="text-[10px] text-red-400 mt-1">{imp.error_message}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0 pt-0.5">
                                  {!isActive && !importInFlight && !importStalled && isUsableLibrarySnapshot(imp) && importPresentation.canActivate && (
                                    <button
                                      onClick={() => handleSetActiveImport(imp.id)}
                                      className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                                    >
                                      Make Active
                                    </button>
                                  )}
                                  {(importPresentation.canRetry || importStalled) && (
                                    <button
                                      onClick={() => {
                                        if (imp.status === 'completed' || imp.status === 'paused' || imp.status === 'interrupted') {
                                          navigate({ name: 'import', importId: imp.id, resume: true });
                                        } else {
                                          setIsImportModalOpen(true);
                                        }
                                      }}
                                      className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                                    >
                                      {imp.status === 'completed' || imp.status === 'paused' || imp.status === 'interrupted' ? 'Resume' : 'Retry'}
                                    </button>
                                  )}
                                  {(!importInFlight || imp.retryable || isPendingHardDelete(imp)) && (
                                    <button
                                      onClick={() => handleDeleteImport(imp)}
                                      className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors"
                                    >
                                      {isPendingHardDelete(imp) ? 'Retry Delete' : 'Delete'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* Danger zone */}
                    <section className="space-y-3">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">Library Reset</h2>
                      <div className="glass rounded-2xl p-4 flex items-center justify-between gap-4 border border-red-500/10">
                        <div className="flex items-start gap-3 min-w-0">
                          <WarningAlt size={18} className="mt-0.5 shrink-0 text-red-400" />
                          <div className="min-w-0">
                            <p className="font-bold text-sm">Delete All Rekordbox Data</p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Permanently remove every library snapshot and all imported Rekordbox data for this account.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={deleteAllLibrariesSubmitting}
                          onClick={() => {
                            setDeleteAllLibrariesError(null);
                            setDeleteAllLibrariesPass(0);
                            setDeleteAllLibrariesOpen(true);
                          }}
                          className="shrink-0 text-xs font-bold text-red-400 transition-colors hover:text-red-300 disabled:opacity-50"
                        >
                          Delete All
                        </button>
                      </div>
                    </section>
                  </>
                )}

                {/* ── About tab ── */}
                {settingsTab === 'about' && (
                  <section className="space-y-3">
                    <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                      {[
                        { label: 'Version', value: '2.0.0' },
                        { label: 'Book Source', value: 'Supabase (rekordbox USB)' },
                        { label: 'Import ID', value: latestImport?.id?.slice(0, 8) ?? '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="px-4 py-3 flex items-center justify-between">
                          <p className="text-sm text-muted-foreground">{label}</p>
                          <p className="text-sm font-mono font-bold">{value}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </motion.div>
            )}

            {/* ── Reusable Components ── */}
            {!routeBlocked && currentView === 'reusable-components' && (
              <motion.div
                key="reusable-components"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pt-6"
              >
                <ReusableComponentsView />
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
        <NowPlayingBar className="hidden md:flex shrink-0" />
      </div>

      {/* ── Mobile NowPlaying — fixed above mobile nav ── */}
      <NowPlayingBar className="md:hidden fixed bottom-0 left-0 right-0 z-50" />

      {/* ── Mobile-only: bottom nav (shifts up when player is active) ── */}
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
              ? <CheckmarkFilled size={20} className="mt-0.5 shrink-0 text-emerald-400" />
              : <WarningAlt size={20} className="mt-0.5 shrink-0 text-amber-400" />}
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
    </AudioPlayerProvider>
    </UsbConnectionProvider>
  );
}
