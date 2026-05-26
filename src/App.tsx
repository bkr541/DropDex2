/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
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
  Play,
  Moon,
  Sun,
  Database,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/db';
import { parseRekordboxXml } from './lib/rekordbox';
import { Track, PlaylistNode } from './types';
import { cn, formatDuration, formatKey, getDeterministicBars } from './lib/utils';

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
  track: Track;
  onClick: () => void;
  isActive?: boolean;
}

const TrackCard = ({ track, onClick, isActive }: TrackCardProps) => (
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
      {track.artist.substring(0, 1).toUpperCase()}
      {track.title.substring(0, 1).toUpperCase()}
    </div>
    <div className="min-w-0 pr-2">
      <h4 className="text-sm font-bold truncate text-foreground">{track.title}</h4>
      <p className="text-[10px] text-muted-foreground uppercase tracking-tighter truncate">{track.artist}</p>
    </div>
    <div className="text-center">
      <p className={cn('text-xs font-mono font-bold', isActive ? 'text-primary neon-text-blue' : 'text-[var(--color-text-subdued)]')}>
        {track.bpm.toFixed(1)}
      </p>
      {isActive && <p className="text-[8px] text-slate-500 uppercase">BPM</p>}
    </div>
    <div className="text-right">
      <p className={cn('text-xs font-mono font-bold', isActive ? 'text-secondary neon-text-purple' : 'text-[var(--color-text-subdued)]')}>
        {formatKey(track.key)}
      </p>
      {isActive && <p className="text-[8px] text-slate-500 uppercase">Key</p>}
    </div>
  </motion.div>
);

const ImportModal = ({ isOpen, onClose, onImport }: any) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      await parseRekordboxXml(text);
      onImport();
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to parse XML. Make sure it is a valid Rekordbox Export.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-sm glass p-8 rounded-3xl text-center"
          >
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <FileUp className="text-primary" size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-2">Import Collection</h2>
            <p className="text-muted-foreground mb-8">
              Select your Rekordbox XML export file to load your playlists and tracks.
            </p>
            <input type="file" ref={fileInputRef} onChange={handleFile} className="hidden" accept=".xml" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              {isImporting ? 'Processing...' : 'Choose XML File'}
            </button>
            <button onClick={onClose} className="mt-4 text-muted-foreground text-sm hover:text-foreground">
              Cancel
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// --- App Root ---

export default function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistNode | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('dropdex-theme') as Theme) || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dropdex-theme', theme);
  }, [theme]);

  const playlists = useLiveQuery(() => db.playlists.toArray()) || [];
  const tracks = useLiveQuery(() => db.tracks.toArray()) || [];
  const recentTracks = useLiveQuery(() => db.tracks.limit(5).reverse().toArray()) || [];

  const filteredTracks = useMemo(() => {
    if (!searchQuery) return [];
    return tracks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.genre.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .slice(0, 50);
  }, [tracks, searchQuery]);

  const playlistTracks = useLiveQuery(async () => {
    if (!selectedPlaylist || !selectedPlaylist.trackIds) return [];
    return await db.tracks.where('rekordboxId').anyOf(selectedPlaylist.trackIds).toArray();
  }, [selectedPlaylist]);

  const handlePlaylistClick = (p: PlaylistNode) => {
    setSelectedPlaylist(p);
    setCurrentView('playlist');
  };

  const handleTrackClick = (t: Track) => {
    setSelectedTrack(t);
    setCurrentView('track');
  };

  const goBack = () => {
    if (currentView === 'track' && selectedPlaylist) setCurrentView('playlist');
    else if (currentView === 'track') setCurrentView('home');
    else if (currentView === 'playlist') setCurrentView('home');
    else if (currentView === 'review') setCurrentView('home');
    else if (currentView === 'settings') setCurrentView('home');
  };

  const clearCollection = async () => {
    if (!confirm('Clear all tracks and playlists? This cannot be undone.')) return;
    await db.tracks.clear();
    await db.playlists.clear();
    setCurrentView('home');
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
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="w-8 h-8 brand-gradient rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(207,107,101,0.4)] shrink-0">
            <div className="w-4 h-4 bg-[var(--color-panel)] rounded-sm rotate-45 flex items-center justify-center">
              <div className="w-1 h-1 bg-primary rounded-full" />
            </div>
          </div>
          <span className="text-xl font-black tracking-tighter uppercase leading-none">
            Drop<span className="text-primary">Dex</span>
          </span>
        </div>

        {/* Nav links */}
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

        {/* Sidebar footer */}
        <div className="p-3 border-t border-[var(--color-border-subtle)] space-y-1">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="w-full flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/20 transition-colors"
          >
            <FileUp size={16} /> Import Collection
          </button>
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
                <div className="w-8 h-8 brand-gradient rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(207,107,101,0.4)]">
                  <div className="w-4 h-4 bg-[var(--color-panel)] rounded-sm rotate-45 flex items-center justify-center">
                    <div className="w-1 h-1 bg-primary rounded-full" />
                  </div>
                </div>
                <span className="text-xl font-black tracking-tighter uppercase leading-none">
                  Drop<span className="text-primary">Dex</span>
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {currentView === 'home' && (
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="md:hidden flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-primary/20 transition-colors"
              >
                <FileUp size={14} /> Import
              </button>
            )}
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
                <div className="flex gap-4 mt-1">
                  <span className="px-2 py-0.5 bg-[var(--color-surface)] rounded text-[8px] font-mono text-muted-foreground uppercase tracking-widest">
                    Total Tracks: {selectedPlaylist?.trackIds?.length || 0}
                  </span>
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
                    placeholder="Search tracks, artists, keys..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-medium text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                {searchQuery ? (
                  <div className="space-y-4">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Search size={14} /> Search Results
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                      {filteredTracks.map((track) => (
                        <TrackCard key={track.id} track={track} onClick={() => handleTrackClick(track)} />
                      ))}
                    </div>
                    {filteredTracks.length === 0 && (
                      <p className="text-center py-12 text-muted-foreground italic">No tracks found matching your search.</p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Stats row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="glass p-4 rounded-2xl border-l-4 border-l-primary">
                        <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Collection</p>
                        <p className="text-2xl font-bold font-mono">{tracks.length}</p>
                      </div>
                      <div
                        className="glass p-4 rounded-2xl border-l-4 border-l-secondary cursor-pointer"
                        onClick={() => setCurrentView('review')}
                      >
                        <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Set Review</p>
                        <p className="text-2xl font-bold flex items-center gap-2">
                          Start <Play size={18} className="fill-secondary text-secondary" />
                        </p>
                      </div>
                    </div>

                    {/* Playlists */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                          <ListMusic size={14} /> Playlists
                        </h2>
                        <span className="text-[10px] text-muted-foreground font-mono">{playlists.length} ITEMS</span>
                      </div>
                      {playlists.length === 0 && (
                        <div
                          className="text-center py-12 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl cursor-pointer"
                          onClick={() => setIsImportModalOpen(true)}
                        >
                          <p className="text-muted-foreground mb-4">No playlists imported yet.</p>
                          <button className="text-primary font-bold flex items-center gap-2 mx-auto">
                            <Plus size={18} /> Import Now
                          </button>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {playlists.map((playlist) => (
                          <motion.div
                            key={playlist.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handlePlaylistClick(playlist)}
                            className="glass p-4 rounded-2xl flex items-center justify-between cursor-pointer group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center text-secondary">
                                <TrendingUp size={20} />
                              </div>
                              <div>
                                <h3 className="font-bold group-hover:text-primary transition-colors">{playlist.name}</h3>
                                <p className="text-[10px] text-muted-foreground font-mono uppercase">
                                  {playlist.trackIds?.length || 0} Tracks
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="text-muted-foreground" size={20} />
                          </motion.div>
                        ))}
                      </div>
                    </section>

                    {/* Recently imported */}
                    <section className="space-y-4">
                      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <History size={14} /> Recently Import
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                        {recentTracks.map((track) => (
                          <TrackCard key={track.id} track={track} onClick={() => handleTrackClick(track)} />
                        ))}
                      </div>
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
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase">Tracks</span>
                      <span className="font-bold font-mono">{selectedPlaylist?.trackIds?.length || 0}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase">Avg BPM</span>
                      <span className="font-bold font-mono">124.5</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {playlistTracks?.map((track) => (
                    <TrackCard
                      key={track.id}
                      track={track}
                      onClick={() => handleTrackClick(track)}
                      isActive={selectedTrack?.id === track.id}
                    />
                  ))}
                  {playlistTracks?.length === 0 && (
                    <p className="text-center py-12 text-muted-foreground italic col-span-full">
                      No tracks loaded in this playlist.
                    </p>
                  )}
                </div>
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
                        <p className="text-sm font-bold text-primary uppercase tracking-widest">{selectedTrack.artist}</p>
                      </div>
                      <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-lg border border-[var(--color-border-subtle)] text-xs font-mono font-black text-secondary neon-text-purple italic">
                        {formatKey(selectedTrack.key)}
                      </div>
                    </div>

                    <div className="flex justify-around items-center bg-[var(--color-surface)] py-6 rounded-2xl border border-[var(--color-border-faint)] shadow-inner">
                      <div className="text-center">
                        <p className="text-4xl font-mono font-black tracking-tighter text-foreground">
                          {Math.round(selectedTrack.bpm)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1">BPM</p>
                      </div>
                      <div className="h-12 w-px bg-[var(--color-border-subtle)]" />
                      <div className="text-center">
                        <p className="text-4xl font-mono font-black tracking-tighter text-secondary neon-text-purple">
                          {formatKey(selectedTrack.key)}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1">Key</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-4 rounded-xl">
                        <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Duration</p>
                        <p className="text-sm font-mono font-bold text-[var(--color-text-subdued)]">
                          {formatDuration(selectedTrack.duration)}
                        </p>
                      </div>
                      <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-4 rounded-xl">
                        <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Energy</p>
                        <div className="flex gap-0.5 mt-1">
                          {[...Array(5)].map((_, i) => (
                            <div
                              key={i}
                              className={cn('w-3 h-1.5 rounded-[1px]', i < selectedTrack.rating / 20 ? 'bg-primary' : 'bg-muted')}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: comments, cues, similar */}
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
                        <Clock size={14} /> Cue Points
                      </h3>
                      <div className="space-y-2">
                        {selectedTrack.cuePoints.length > 0 ? (
                          selectedTrack.cuePoints.map((cue, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-4 glass p-3 rounded-xl border border-[var(--color-border-faint)]"
                            >
                              <div
                                className={cn(
                                  'w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs',
                                  cue.type === 'hot' ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary'
                                )}
                              >
                                {cue.type === 'hot' ? 'H' : 'M'}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-bold">{cue.name}</p>
                                <p className="text-[10px] font-mono text-muted-foreground">{formatDuration(cue.time)}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-center text-muted-foreground text-xs italic py-4">No cue points found in export.</p>
                        )}
                      </div>
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                        <TrendingUp size={14} /> Similar Vibes
                      </h3>
                      <div>
                        {tracks
                          .filter(
                            (t) =>
                              t.id !== selectedTrack.id &&
                              (t.key === selectedTrack.key || Math.abs(t.bpm - selectedTrack.bpm) < 2)
                          )
                          .slice(0, 3)
                          .map((t) => (
                            <TrackCard key={t.id} track={t} onClick={() => handleTrackClick(t)} />
                          ))}
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
                <div className="glass p-6 rounded-[2rem] border-2 border-secondary/20 text-center">
                  <Music size={48} className="mx-auto mb-4 text-secondary opacity-50" />
                  <h2 className="text-2xl font-black mb-2">Review Mode</h2>
                  <p className="text-muted-foreground text-sm">
                    Quickly swipe or scroll through your collection. Tap for full details.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {tracks.map((t) => (
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
                          {formatKey(t.key)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mb-4">{t.artist}</p>
                      <div className="flex gap-6 items-center">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">BPM</span>
                          <span className="text-lg font-black font-mono">{t.bpm.toFixed(1)}</span>
                        </div>
                        <div className="h-8 w-px bg-[var(--color-border-subtle)]" />
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Energy</span>
                          <div className="flex gap-0.5 mt-1">
                            {[...Array(5)].map((_, i) => (
                              <div
                                key={i}
                                className={cn('w-3 h-1.5 rounded-sm', i < t.rating / 20 ? 'bg-primary' : 'bg-muted')}
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
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Database size={18} className="text-muted-foreground" />
                        <div>
                          <p className="font-bold text-sm">Collection</p>
                          <p className="text-xs text-muted-foreground">{tracks.length} tracks · {playlists.length} playlists</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="text-xs font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        Import
                      </button>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Trash2 size={18} className="text-red-400" />
                        <div>
                          <p className="font-bold text-sm text-red-400">Clear Collection</p>
                          <p className="text-xs text-muted-foreground">Remove all tracks and playlists</p>
                        </div>
                      </div>
                      <button
                        onClick={clearCollection}
                        className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </section>

                {/* About */}
                <section className="space-y-3">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">About</h2>
                  <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
                    {[
                      { label: 'Version', value: '1.0.0' },
                      { label: 'Storage', value: 'IndexedDB (local)' },
                      { label: 'Source', value: 'Rekordbox XML' },
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

      {/* ── Mobile-only: status bar ── */}
      {currentView === 'home' && (
        <div className="md:hidden fixed bottom-24 left-0 right-0 px-4 z-30">
          <div className="h-10 bg-[var(--color-panel-alt)] border border-[var(--color-border-subtle)] rounded-full flex items-center justify-center gap-4 px-4 overflow-hidden">
            <div className="flex items-center gap-2 text-[9px] text-slate-500 font-bold">
              <span className="font-mono text-[8px] opacity-60">SYSTEM:</span>
              <span className="text-emerald-500 uppercase tracking-tight">Sync Active</span>
            </div>
            <div className="w-px h-3 bg-[var(--color-border-subtle)]" />
            <button className="text-[9px] font-bold text-primary uppercase tracking-widest">All Tracks</button>
            <button className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Hot Reload</button>
          </div>
        </div>
      )}

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

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={() => {}}
      />
    </div>
  );
}
