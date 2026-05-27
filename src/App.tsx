/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Music,
  ListMusic,
  ChevronRight,
  ChevronLeft,
  Info,
  Clock,
  Settings,
  History,
  TrendingUp,
  FileUp,
  Moon,
  Sun,
  Database,
  LogOut,
  User,
  Loader2,
  FolderOpen,
  Tag,
  Disc3,
  Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDuration, formatKey, formatPosition, formatPlaylistDuration, getDeterministicBars } from './lib/utils';
import { supabase } from './lib/supabase';
import { useAuthSession } from './hooks/useAuthSession';
import { useLatestRekordboxImport } from './hooks/useLatestRekordboxImport';
import { useRekordboxPlaylists } from './hooks/useRekordboxPlaylists';
import { useRekordboxPlaylistTracks } from './hooks/useRekordboxPlaylistTracks';
import { useRecentTracks, useRekordboxSearch } from './hooks/useRekordboxTracks';
import { useTrackPlaylists } from './hooks/useTrackPlaylists';
import { useImportList } from './hooks/useImportList';
import { fetchSimilarTracks, fetchReviewTracks, setActiveImport, deleteImport } from './lib/queries/rekordbox';
import { ImportLibraryModal } from './components/ImportLibraryModal';
import type { PlaylistWithCount } from './lib/queries/rekordbox';
import type { RekordboxTrack, RekordboxImport } from './types';

type Theme = 'dark' | 'light';
type View = 'home' | 'playlist' | 'track' | 'review' | 'settings';

// --- Components ---

const Waveform = ({
  seed,
  className,
  count = 40,
  color = 'primary',
}: {
  seed: string;
  className?: string;
  count?: number;
  color?: 'primary' | 'secondary';
}) => {
  const bars = useMemo(() => getDeterministicBars(seed, count), [seed, count]);
  return (
    <div className={cn('flex items-end gap-[2px] h-full w-full', className)}>
      {bars.map((height, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-full transition-all duration-500',
            color === 'primary' ? 'bg-primary/40' : 'bg-secondary/40'
          )}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
};

const IconButton = ({ icon: Icon, onClick, className }: any) => (
  <button
    onClick={onClick}
    className={cn(
      'p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-slate-400 hover:text-foreground transition-all active:scale-90',
      className
    )}
  >
    <Icon size={20} />
  </button>
);

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

// Shown when the user has no completed Supabase import yet
const EmptyLibraryState = ({ onImport }: { onImport: () => void }) => (
  <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
    <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-2">
      <Disc3 size={40} className="text-primary/50" />
    </div>
    <h2 className="text-xl font-black">No Library Imported Yet</h2>
    <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
      Connect your rekordbox USB drive, then import your library to get started.
    </p>
    <button
      onClick={onImport}
      className="mt-2 flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 hover:bg-primary/90"
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

// --- App Root ---

export default function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistWithCount | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<RekordboxTrack | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('dropdex-theme') as Theme) || 'dark'
  );
  const [reviewTracks, setReviewTracks] = useState<RekordboxTrack[]>([]);
  const [similarTracks, setSimilarTracks] = useState<RekordboxTrack[]>([]);
  const [previousView, setPreviousView] = useState<View>('home');

  const { session } = useAuthSession();
  const userId = session?.user?.id ?? null;

  // ── Supabase data ──────────────────────────────────────────────────────────
  const { data: latestImport, loading: importLoading, error: importError, refetch: refetchImport } =
    useLatestRekordboxImport(userId);
  const importId = latestImport?.id ?? null;

  const { playlists, loading: playlistsLoading } = useRekordboxPlaylists(importId);
  const { tracks: playlistTracks, loading: playlistTracksLoading } =
    useRekordboxPlaylistTracks(selectedPlaylist?.id ?? null);
  const { results: searchResults, loading: searchLoading } = useRekordboxSearch(importId, searchQuery);
  const { tracks: recentTracks, loading: recentTracksLoading } = useRecentTracks(importId);
  const { memberships: trackPlaylists, loading: trackPlaylistsLoading } =
    useTrackPlaylists(importId, selectedTrack?.id ?? null);
  const { imports: allImports, loading: importsListLoading, refetch: refetchImportList } =
    useImportList(userId);

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

  // Load similar tracks when a track is opened
  useEffect(() => {
    if (!selectedTrack || !importId) {
      setSimilarTracks([]);
      return;
    }
    fetchSimilarTracks(importId, selectedTrack.bpm, selectedTrack.musical_key, selectedTrack.id)
      .then(setSimilarTracks)
      .catch(() => setSimilarTracks([]));
  }, [selectedTrack, importId]);

  // Compute playlist statistics from loaded tracks
  const avgBpm = useMemo(() => {
    const bpms = playlistTracks
      .map((pt) => pt.track.bpm)
      .filter((b): b is number => b != null && b > 0);
    if (!bpms.length) return null;
    return (bpms.reduce((a, b) => a + b, 0) / bpms.length).toFixed(1);
  }, [playlistTracks]);

  const totalDuration = useMemo(() => {
    const secs = playlistTracks.reduce(
      (sum, pt) => sum + (pt.track.duration_seconds ?? 0), 0
    );
    return secs > 0 ? secs : null;
  }, [playlistTracks]);

  const topKey = useMemo(() => {
    const keyCounts: Record<string, number> = {};
    for (const pt of playlistTracks) {
      const k = pt.track.musical_key;
      if (k) keyCounts[k] = (keyCounts[k] ?? 0) + 1;
    }
    const entries = Object.entries(keyCounts);
    if (!entries.length) return null;
    return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }, [playlistTracks]);

  const handleImportSuccess = () => {
    // Navigate home and reset any stale playlist/track selection before the new
    // import data arrives via refetchImport().
    setCurrentView('home');
    setSelectedPlaylist(null);
    setSelectedTrack(null);
    refetchImport();
    refetchImportList();
  };

  const handleSetActiveImport = async (importId: string) => {
    try {
      await setActiveImport(importId);
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
      if (isActive) refetchImport();
      refetchImportList();
    } catch (err) {
      console.error('Failed to delete import:', err);
    }
  };

  const handlePlaylistClick = (p: PlaylistWithCount) => {
    setSelectedPlaylist(p);
    setCurrentView('playlist');
  };

  const handleTrackClick = (t: RekordboxTrack) => {
    if (currentView !== 'track') setPreviousView(currentView);
    setSelectedTrack(t);
    setCurrentView('track');
  };

  const handleAppearsInPlaylistClick = (playlistId: string) => {
    const found = playlists.find((p) => p.id === playlistId);
    if (found) {
      setSelectedPlaylist(found);
      setCurrentView('playlist');
    }
  };

  const goBack = () => {
    if (currentView === 'track') setCurrentView(previousView);
    else if (currentView === 'playlist') setCurrentView('home');
    else if (currentView === 'review') setCurrentView('home');
    else if (currentView === 'settings') setCurrentView('home');
  };

  const sidebarNavItems: { view: View; icon: React.ElementType; label: string; activeColor: string; activeBg: string }[] = [
    { view: 'home', icon: Music, label: 'Library', activeColor: 'text-primary neon-text-blue', activeBg: 'bg-primary/10 border-primary/20' },
    { view: 'review', icon: TrendingUp, label: 'Review', activeColor: 'text-secondary neon-text-purple', activeBg: 'bg-secondary/10 border-secondary/20' },
    { view: 'search' as any, icon: Search, label: 'Search', activeColor: 'text-foreground', activeBg: 'bg-[var(--color-surface)] border-[var(--color-border-subtle)]' },
  ];

  return (
    <div className="flex h-screen overflow-hidden font-sans relative">
      {/* Background ambience */}
      <div className="fixed inset-0 -z-10 bg-background overflow-hidden">
        <div className="ambience-blob absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full" />
        <div className="ambience-blob absolute bottom-[10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[100px] rounded-full" />
      </div>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-panel)] z-40">
        <div className="h-16 flex items-center gap-3 px-6 border-b border-[var(--color-border-subtle)] shrink-0">
          <img src="/logos/dropdexlogo.png" alt="DropDex" className="w-8 h-8 object-contain shrink-0" />
          <span className="text-xl font-black tracking-tighter uppercase leading-none">
            Drop<span className="text-primary">Dex</span>
          </span>
        </div>

        <nav className="flex flex-col gap-1 p-3 flex-1">
          {sidebarNavItems.map(({ view, icon: Icon, label, activeColor, activeBg }) => (
            <button
              key={label}
              onClick={() => view !== ('search' as any) && setCurrentView(view)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all text-left border',
                currentView === view
                  ? `${activeColor} ${activeBg}`
                  : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent'
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--color-border-subtle)] space-y-1">
          <button
            onClick={() => setCurrentView('settings')}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-sm transition-all border',
              currentView === 'settings'
                ? 'text-foreground bg-[var(--color-surface)] border-[var(--color-border-subtle)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent'
            )}
          >
            <Settings size={18} /> Settings
          </button>
        </div>
      </aside>

      {/* ── Main content column ── */}
      <div className="flex flex-col flex-1 min-w-0 h-screen">

        {/* Header */}
        <header className="h-16 border-b border-[var(--color-border-subtle)] flex items-center justify-between px-6 bg-[var(--color-panel)] sticky top-0 z-40 shrink-0">
          <div className="flex items-center gap-3">
            {currentView !== 'home' && <IconButton icon={ChevronLeft} onClick={goBack} />}
            {currentView === 'home' && (
              <div className="flex items-center gap-3 md:hidden">
                <img src="/logos/dropdexlogo.png" alt="DropDex" className="w-8 h-8 object-contain shrink-0" />
                <span className="text-xl font-black tracking-tighter uppercase leading-none">
                  Drop<span className="text-primary">Dex</span>
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentView('settings')}
              className={cn(
                'md:hidden p-2 rounded-lg transition-all active:scale-90',
                currentView === 'settings'
                  ? 'text-foreground bg-[var(--color-surface)]'
                  : 'text-slate-400 hover:text-foreground bg-transparent'
              )}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* View subheader */}
        {currentView !== 'home' && (
          <div className="px-6 py-4 bg-gradient-to-b from-primary/5 to-transparent border-b border-[var(--color-border-subtle)] shrink-0">
            {currentView === 'playlist' && (
              <div>
                <h2 className="text-2xl font-black italic">{selectedPlaylist?.name}</h2>
                <div className="flex flex-wrap gap-2 mt-1">
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
            {currentView === 'track' && (
              <div>
                <h2 className="text-2xl font-black italic">Track Intelligence</h2>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em]">Deep Scan Results</p>
              </div>
            )}
            {currentView === 'review' && (
              <div>
                <h2 className="text-2xl font-black italic">Set Review Mode</h2>
                <p className="text-[8px] text-secondary uppercase tracking-[0.2em] font-bold">Optimized for low-light</p>
              </div>
            )}
            {currentView === 'settings' && (
              <div>
                <h2 className="text-2xl font-black italic">Settings</h2>
                <p className="text-[8px] text-muted-foreground uppercase tracking-[0.2em]">App Configuration</p>
              </div>
            )}
          </div>
        )}

        {/* Scrollable content */}
        <main className={cn('flex-1 overflow-y-auto px-4 md:px-8 pb-32 md:pb-8', currentView === 'home' && 'pt-6')}>
          <AnimatePresence mode="wait">

            {/* ── Home ── */}
            {currentView === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8 md:max-w-5xl md:mx-auto"
              >
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                  <input
                    type="text"
                    placeholder="Search tracks, artists, genres…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-medium text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                {/* Library loading / error / empty states */}
                {importLoading && !searchQuery && (
                  <div className="flex items-center justify-center py-24">
                    <Loader2 className="animate-spin text-primary" size={32} />
                  </div>
                )}

                {!importLoading && importError && !searchQuery && (
                  <div className="text-center py-24 space-y-2">
                    <p className="text-red-400 font-bold">Failed to load library</p>
                    <p className="text-xs text-muted-foreground">{importError}</p>
                  </div>
                )}

                {!importLoading && !importError && !latestImport && !searchQuery && (
                  <EmptyLibraryState onImport={() => setIsImportModalOpen(true)} />
                )}

                {/* Search results (shown regardless of import state) */}
                {searchQuery && (
                  <div className="space-y-4">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Search size={14} />
                      {searchLoading ? 'Searching…' : 'Search Results'}
                    </h2>
                    {searchLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="animate-spin text-primary" size={24} />
                      </div>
                    )}
                    {!searchLoading && (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                        {searchResults.map((track) => (
                          <TrackCard key={track.id} track={track} onClick={() => handleTrackClick(track)} />
                        ))}
                      </div>
                    )}
                    {!searchLoading && searchResults.length === 0 && importId && (
                      <p className="text-center py-12 text-muted-foreground italic">No tracks found matching your search.</p>
                    )}
                    {!searchLoading && !importId && (
                      <p className="text-center py-12 text-muted-foreground italic">Import a library to search your tracks.</p>
                    )}
                  </div>
                )}

                {/* Main library content */}
                {!searchQuery && !importLoading && !importError && latestImport && (
                  <>
                    {/* Stats row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="glass p-4 rounded-2xl border-l-4 border-l-primary">
                        <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Tracks</p>
                        <p className="text-2xl font-bold font-mono">{latestImport.track_count.toLocaleString()}</p>
                      </div>
                      <div className="glass p-4 rounded-2xl border-l-4 border-l-secondary">
                        <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Playlists</p>
                        <p className="text-2xl font-bold font-mono">{latestImport.playlist_count}</p>
                      </div>
                      <div className="glass p-4 rounded-2xl border-l-4 border-l-primary/40">
                        <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Source</p>
                        <p className="text-sm font-mono font-bold truncate" title={latestImport.source_filename}>
                          {latestImport.source_filename}
                        </p>
                      </div>
                      <div className="glass p-4 rounded-2xl border-l-4 border-l-secondary/40">
                        <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Imported</p>
                        <p className="text-sm font-bold">
                          {new Date(latestImport.imported_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Playlists */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                          <ListMusic size={14} /> Playlists
                        </h2>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {playlistsLoading ? '…' : `${playlists.length} ITEMS`}
                        </span>
                      </div>
                      {playlistsLoading && (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-muted-foreground" size={24} />
                        </div>
                      )}
                      {!playlistsLoading && playlists.length === 0 && (
                        <div className="text-center py-12 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
                          <p className="text-muted-foreground">No playlists in this import.</p>
                        </div>
                      )}
                      <div className="flex flex-col gap-3">
                        {playlists.map((playlist) => (
                          <motion.div
                            key={playlist.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handlePlaylistClick(playlist)}
                            className="glass p-4 rounded-2xl flex items-center justify-between cursor-pointer group"
                          >
                            <div className="flex items-center gap-4">
                              <div className={cn(
                                'w-10 h-10 rounded-xl flex items-center justify-center',
                                playlist.is_folder
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-secondary/10 text-secondary'
                              )}>
                                {playlist.is_folder ? <FolderOpen size={20} /> : <TrendingUp size={20} />}
                              </div>
                              <div>
                                <h3 className="font-bold group-hover:text-primary transition-colors">{playlist.name}</h3>
                                <p className="text-[10px] text-muted-foreground font-mono uppercase">
                                  {playlist.track_count} Tracks
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="text-muted-foreground" size={20} />
                          </motion.div>
                        ))}
                      </div>
                    </section>

                    {/* Recently Added */}
                    <section className="space-y-4">
                      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <History size={14} /> Recently Added
                      </h2>
                      {recentTracksLoading && (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-muted-foreground" size={20} />
                        </div>
                      )}
                      {!recentTracksLoading && recentTracks.length === 0 && (
                        <p className="text-center py-8 text-muted-foreground text-sm italic">
                          No recently dated tracks found.
                        </p>
                      )}
                      {!recentTracksLoading && recentTracks.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                          {recentTracks.map((track) => (
                            <TrackCard key={track.id} track={track} onClick={() => handleTrackClick(track)} />
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </motion.div>
            )}

            {/* ── Playlist ── */}
            {currentView === 'playlist' && (
              <motion.div
                key="playlist"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 md:max-w-5xl md:mx-auto"
              >
                <div className="glass p-6 rounded-3xl mb-6 relative overflow-hidden">
                  <TrendingUp className="absolute -right-4 -bottom-4 text-primary/10 w-24 h-24" />
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Playlist Details</p>
                  <p className="text-3xl font-black mb-4 truncate">{selectedPlaylist?.name}</p>
                  <div className="flex flex-wrap gap-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase">Tracks</span>
                      <span className="font-bold font-mono">
                        {playlistTracksLoading ? '…' : playlistTracks.length}
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

                {playlistTracksLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin text-primary" size={32} />
                  </div>
                )}

                {!playlistTracksLoading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {playlistTracks.map((pt) => (
                      <TrackCard
                        key={pt.track.id}
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
              </motion.div>
            )}

            {/* ── Track detail ── */}
            {currentView === 'track' && selectedTrack && (
              <motion.div
                key="track"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="md:max-w-5xl md:mx-auto"
              >
                <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-8">
                  {/* Left: artwork + core stats */}
                  <div className="flex flex-col gap-6">
                    <div className="relative aspect-video w-full glass rounded-2xl overflow-hidden flex items-center justify-center border border-[var(--color-border-subtle)] group">
                      <div className="absolute inset-0 brand-gradient opacity-10 group-hover:opacity-20 transition-opacity" />
                      <Music className="w-16 h-16 text-primary/20" />
                      <div className="absolute bottom-0 left-0 right-0 h-1/2 opacity-30 px-4 pb-2">
                        <Waveform seed={selectedTrack.id} count={60} />
                      </div>
                      <div className="absolute bottom-4 left-4 right-4 z-10">
                        <h2 className="text-xl font-black italic uppercase leading-tight line-clamp-2">{selectedTrack.title}</h2>
                        <p className="text-sm font-bold text-primary uppercase tracking-widest">
                          {selectedTrack.artist ?? 'Artist Not Stored'}
                        </p>
                      </div>
                      <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-lg border border-[var(--color-border-subtle)] text-xs font-mono font-black text-secondary neon-text-purple italic">
                        {formatKey(selectedTrack.musical_key)}
                      </div>
                    </div>

                    <div className="flex justify-around items-center bg-[var(--color-surface)] py-6 rounded-2xl border border-[var(--color-border-faint)] shadow-inner">
                      <div className="text-center">
                        <p className="text-4xl font-mono font-black tracking-tighter text-foreground">
                          {selectedTrack.bpm != null ? Math.round(selectedTrack.bpm) : '—'}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1">BPM</p>
                      </div>
                      <div className="h-12 w-px bg-[var(--color-border-subtle)]" />
                      <div className="text-center">
                        <p className="text-4xl font-mono font-black tracking-tighter text-secondary neon-text-purple">
                          {formatKey(selectedTrack.musical_key)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1">Key</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-4 rounded-xl">
                        <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Duration</p>
                        <p className="text-sm font-mono font-bold text-[var(--color-text-subdued)]">
                          {formatDuration(selectedTrack.duration_seconds)}
                        </p>
                      </div>
                      <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-4 rounded-xl">
                        <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Energy</p>
                        <div className="flex gap-0.5 mt-1">
                          {[...Array(5)].map((_, i) => (
                            <div
                              key={i}
                              className={cn('w-3 h-1.5 rounded-[1px]', i < (selectedTrack.rating ?? 0) ? 'bg-primary' : 'bg-muted')}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: comments, metadata, similar */}
                  <div className="flex flex-col gap-6 pb-8">
                    <section className="space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                        <Info size={14} /> DJ Comments
                      </h3>
                      <div className="glass p-4 rounded-2xl text-sm leading-relaxed border-l-4 border-l-secondary">
                        {selectedTrack.comments ||
                          'No specific DJ notes for this track. Use this space to remember energy level or transition tips.'}
                      </div>
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                        <Tag size={14} /> Library Metadata
                      </h3>
                      <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                        {[
                          { icon: Disc3, label: 'Album', value: selectedTrack.album },
                          { icon: Tag, label: 'Genre', value: selectedTrack.genre },
                          { icon: Tag, label: 'Label', value: selectedTrack.label },
                          { icon: Clock, label: 'Format', value: selectedTrack.file_format },
                          { icon: Calendar, label: 'Added', value: selectedTrack.date_added },
                        ].map(({ icon: Icon, label, value }) => (
                          <div key={label} className="px-4 py-2.5 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                              <Icon size={12} />
                              <p className="text-[10px] uppercase font-bold tracking-widest">{label}</p>
                            </div>
                            <p className={cn('text-xs font-mono text-right truncate', !value && 'text-muted-foreground italic')}>
                              {value ?? 'Not stored'}
                            </p>
                          </div>
                        ))}
                        <div className="px-4 py-2.5">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                            <FolderOpen size={12} />
                            <p className="text-[10px] uppercase font-bold tracking-widest">File Path</p>
                          </div>
                          <p className={cn(
                            'text-xs font-mono leading-relaxed break-all select-all',
                            selectedTrack.file_path ? 'text-primary/80' : 'text-muted-foreground italic'
                          )}>
                            {selectedTrack.file_path ?? 'Not stored'}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                        <ListMusic size={14} /> Appears In
                      </h3>
                      {trackPlaylistsLoading && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="animate-spin text-muted-foreground" size={18} />
                        </div>
                      )}
                      {!trackPlaylistsLoading && (
                        <div className="glass rounded-2xl overflow-hidden divide-y divide-[var(--color-border-faint)]">
                          {trackPlaylists.length === 0 ? (
                            <p className="px-4 py-3 text-xs text-muted-foreground italic">
                              Not found in any playlists.
                            </p>
                          ) : (
                            trackPlaylists.map(({ playlist, position }) => (
                              <button
                                key={playlist.id}
                                onClick={() => handleAppearsInPlaylistClick(playlist.id)}
                                className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--color-surface-hover)] transition-colors text-left"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <ListMusic size={11} className="text-muted-foreground shrink-0" />
                                  <p className="text-xs font-bold truncate">{playlist.name}</p>
                                </div>
                                <span className="text-[10px] font-mono text-primary shrink-0">
                                  #{formatPosition(position)}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                        <TrendingUp size={14} /> Similar Vibes
                      </h3>
                      <div>
                        {similarTracks.length > 0
                          ? similarTracks.map((t) => (
                              <TrackCard key={t.id} track={t} onClick={() => handleTrackClick(t)} />
                            ))
                          : (
                            <p className="text-xs text-muted-foreground italic text-center py-4">
                              No similar tracks found by key or BPM.
                            </p>
                          )}
                      </div>
                    </section>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Review ── */}
            {currentView === 'review' && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-6 pb-32 md:pb-8 md:max-w-5xl md:mx-auto"
              >
                {!importId && (
                  <div className="glass p-6 rounded-[2rem] border-2 border-secondary/20 text-center">
                    <Music size={48} className="mx-auto mb-4 text-secondary opacity-50" />
                    <h2 className="text-2xl font-black mb-2">Review Mode</h2>
                    <p className="text-muted-foreground text-sm">Import a library to start reviewing your collection.</p>
                  </div>
                )}
                {importId && reviewTracks.length === 0 && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="animate-spin text-primary" size={32} />
                  </div>
                )}
                <div className="flex flex-col gap-4">
                  {reviewTracks.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => handleTrackClick(t)}
                      className="glass p-6 rounded-3xl active:scale-[0.97] transition-transform overflow-hidden relative group cursor-pointer"
                    >
                      <div className="absolute bottom-0 left-0 right-0 h-8 opacity-10 px-4 group-hover:opacity-30 transition-opacity">
                        <Waveform seed={t.id} count={30} color="secondary" />
                      </div>
                      <div className="flex justify-between items-start mb-2 relative z-10">
                        <h3 className="text-xl font-bold line-clamp-1 flex-1 pr-4">{t.title}</h3>
                        <span className="font-mono text-secondary neon-text-purple border border-secondary/20 px-2 py-0.5 rounded text-sm">
                          {formatKey(t.musical_key)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mb-4">{t.artist ?? 'Artist Not Stored'}</p>
                      <div className="flex gap-6 items-center">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">BPM</span>
                          <span className="text-lg font-black font-mono">
                            {t.bpm != null ? t.bpm.toFixed(1) : '—'}
                          </span>
                        </div>
                        <div className="h-8 w-px bg-[var(--color-border-subtle)]" />
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Energy</span>
                          <div className="flex gap-0.5 mt-1">
                            {[...Array(5)].map((_, i) => (
                              <div
                                key={i}
                                className={cn('w-3 h-1.5 rounded-sm', i < (t.rating ?? 0) ? 'bg-primary' : 'bg-muted')}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Settings ── */}
            {currentView === 'settings' && (
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
                  ) : allImports.length === 0 ? (
                    <div className="glass rounded-2xl p-4 text-center">
                      <p className="text-sm text-muted-foreground italic">No imports yet.</p>
                    </div>
                  ) : (
                    <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                      {allImports.map((imp) => {
                        const isActive = imp.id === latestImport?.id;
                        return (
                          <div key={imp.id} className="p-4 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-sm font-mono truncate">{imp.source_filename}</p>
                                {isActive && (
                                  <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-primary/10 text-primary rounded shrink-0">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                {new Date(imp.imported_at).toLocaleDateString()} · {imp.track_count.toLocaleString()} tracks · {imp.playlist_count} playlists
                              </p>
                              {imp.device_name && (
                                <p className="text-[10px] text-muted-foreground font-mono">{imp.device_name}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0 pt-0.5">
                              {!isActive && (
                                <button
                                  onClick={() => handleSetActiveImport(imp.id)}
                                  className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                                >
                                  Make Active
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

          </AnimatePresence>
        </main>
      </div>

      {/* ── Mobile-only: bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass border-t border-[var(--color-border-subtle)] px-8 pt-4 pb-8 flex justify-between items-center z-40">
        <button
          onClick={() => setCurrentView('home')}
          className={cn(
            'flex flex-col items-center gap-1 transition-all',
            currentView === 'home' ? 'text-primary neon-text-blue' : 'text-muted-foreground'
          )}
        >
          <Music size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Library</span>
        </button>
        <button
          onClick={() => setCurrentView('review')}
          className={cn(
            'flex flex-col items-center gap-1 transition-all',
            currentView === 'review' ? 'text-secondary neon-text-purple' : 'text-muted-foreground'
          )}
        >
          <TrendingUp size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Review</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <Search size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Search</span>
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={cn(
            'flex flex-col items-center gap-1 transition-all',
            currentView === 'settings' ? 'text-primary neon-text-blue' : 'text-muted-foreground'
          )}
        >
          <Settings size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Setup</span>
        </button>
      </nav>

      <ImportLibraryModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
