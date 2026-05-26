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
  Star, 
  Clock, 
  Filter, 
  Settings,
  History,
  TrendingUp,
  X,
  FileUp,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './lib/db';
import { parseRekordboxXml } from './lib/rekordbox';
import { Track, PlaylistNode } from './types';
import { cn, formatDuration, formatKey, getDeterministicBars } from './lib/utils';

// --- Components ---

const Waveform = ({ seed, className, count = 40, color = "primary" }: { seed: string, className?: string, count?: number, color?: "primary" | "secondary" }) => {
  const bars = useMemo(() => getDeterministicBars(seed, count), [seed, count]);
  
  return (
    <div className={cn("flex items-end gap-[2px] h-full w-full", className)}>
      {bars.map((height, i) => (
        <div 
          key={i} 
          className={cn(
            "flex-1 rounded-full transition-all duration-500",
            color === "primary" ? "bg-primary/40" : "bg-secondary/40"
          )} 
          style={{ height: `${height}%` }} 
        />
      ))}
    </div>
  );
};

const ViewTitle = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h1 className={cn("text-2xl font-black tracking-tight uppercase", className)}>{children}</h1>
);

const IconButton = ({ icon: Icon, onClick, className }: any) => (
  <button 
    onClick={onClick}
    className={cn("p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all active:scale-90", className)}
  >
    <Icon size={20} />
  </button>
);

interface TrackCardProps {
  track: Track;
  onClick: () => void;
  isActive?: boolean;
  key?: React.Key;
}

const TrackCard = ({ track, onClick, isActive }: TrackCardProps) => (
  <motion.div 
    layout
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={cn(
      "grid grid-cols-[56px_1fr_60px_60px] gap-3 items-center p-3 rounded-xl transition-all cursor-pointer mb-2",
      isActive 
        ? "bg-white/10 border border-primary/40 shadow-[0_4px_20px_rgba(0,242,255,0.1)]" 
        : "bg-white/5 border border-white/5 hover:bg-white/10"
    )}
  >
    <div className={cn(
      "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shadow-md",
      isActive ? "brand-gradient text-white" : "bg-slate-800 text-slate-500"
    )}>
      {track.artist.substring(0, 1).toUpperCase()}{track.title.substring(0, 1).toUpperCase()}
    </div>
    <div className="min-w-0 pr-2">
      <h4 className="text-sm font-bold truncate text-foreground">{track.title}</h4>
      <p className="text-[10px] text-muted-foreground uppercase tracking-tighter truncate">{track.artist}</p>
    </div>
    <div className="text-center">
      <p className={cn("text-xs font-mono font-bold", isActive ? "text-primary neon-text-blue" : "text-slate-300")}>
        {track.bpm.toFixed(1)}
      </p>
      {isActive && <p className="text-[8px] text-slate-500 uppercase">BPM</p>}
    </div>
    <div className="text-right">
      <p className={cn("text-xs font-mono font-bold", isActive ? "text-secondary neon-text-purple" : "text-slate-300")}>
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
            <p className="text-muted-foreground mb-8">Select your Rekordbox XML export file to load your playlists and tracks.</p>
            
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFile} 
              className="hidden" 
              accept=".xml"
            />
            
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              {isImporting ? 'Processing...' : 'Choose XML File'}
            </button>
            <button 
              onClick={onClose}
              className="mt-4 text-muted-foreground text-sm hover:text-white"
            >
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
  const [currentView, setCurrentView] = useState<'home' | 'playlist' | 'track' | 'review'>('home');
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistNode | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Queries
  const playlists = useLiveQuery(() => db.playlists.toArray()) || [];
  const tracks = useLiveQuery(() => db.tracks.toArray()) || [];
  const recentTracks = useLiveQuery(() => db.tracks.limit(5).reverse().toArray()) || [];

  const filteredTracks = useMemo(() => {
    if (!searchQuery) return [];
    return tracks.filter(t => 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.genre.toLowerCase().includes(searchQuery.toLowerCase())
    ).slice(0, 50);
  }, [tracks, searchQuery]);

  const playlistTracks = useLiveQuery(async () => {
    if (!selectedPlaylist || !selectedPlaylist.trackIds) return [];
    // Rekordbox uses TrackID as keys in the XML, which I mapped to rekordboxId
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
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto relative overflow-hidden font-sans">
      {/* Background Ambience */}
      <div className="fixed inset-0 -z-10 bg-background overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[100px] rounded-full" />
      </div>

      {/* Header */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0a0b0d] sticky top-0 z-40">
        <div className="flex items-center gap-3">
          {currentView !== 'home' ? (
            <IconButton icon={ChevronLeft} onClick={goBack} />
          ) : (
            <div className="w-8 h-8 brand-gradient rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(0,242,255,0.4)]">
              <div className="w-4 h-4 bg-[#0a0b0d] rounded-sm rotate-45 flex items-center justify-center">
                <div className="w-1 h-1 bg-[#00f2ff] rounded-full"></div>
              </div>
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-xl font-black tracking-tighter uppercase leading-none">Drop<span className="text-primary">Dex</span></span>
          </div>
        </div>
        <div className="flex gap-2">
          {currentView === 'home' && (
            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 bg-primary/10 border border-primary/30 text-primary px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-primary/20 transition-colors"
            >
              <FileUp size={14} /> Import
            </button>
          )}
          <IconButton icon={Settings} className="p-1.5 border-none bg-transparent" />
        </div>
      </header>

      {/* View Indicator Bar (Subheader) */}
      {currentView !== 'home' && (
        <div className="px-6 py-4 bg-gradient-to-b from-primary/5 to-transparent border-b border-white/10">
          {currentView === 'playlist' && (
            <div>
              <h2 className="text-2xl font-black italic">{selectedPlaylist?.name}</h2>
              <div className="flex gap-4 mt-1">
                <span className="px-2 py-0.5 bg-white/5 rounded text-[8px] font-mono text-slate-400 uppercase tracking-widest">
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
        </div>
      )}

      {/* Content */}
      <main className={cn("flex-1 overflow-y-auto px-4 pb-32", currentView === 'home' && "pt-6")}>
        <AnimatePresence mode="wait">
          {currentView === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <input 
                  type="text" 
                  placeholder="Search tracks, artists, keys..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-medium"
                />
              </div>

              {searchQuery ? (
                <div className="space-y-4">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <Search size={14} /> Search Results
                  </h2>
                  {filteredTracks.map(track => (
                    <TrackCard key={track.id} track={track} onClick={() => handleTrackClick(track)} />
                  ))}
                  {filteredTracks.length === 0 && (
                    <p className="text-center py-12 text-muted-foreground italic">No tracks found matches your search.</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Stats Row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="glass p-4 rounded-2xl border-l-4 border-l-primary">
                      <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Collection</p>
                      <p className="text-2xl font-bold font-mono">{tracks.length}</p>
                    </div>
                    <div className="glass p-4 rounded-2xl border-l-4 border-l-secondary" onClick={() => setCurrentView('review')}>
                       <p className="text-xs uppercase tracking-tighter text-muted-foreground mb-1">Set Review</p>
                       <p className="text-2xl font-bold flex items-center gap-2">Start <Play size={18} className="fill-secondary text-secondary" /></p>
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
                      <div className="text-center py-12 border-2 border-dashed border-border rounded-3xl" onClick={() => setIsImportModalOpen(true)}>
                        <p className="text-muted-foreground mb-4">No playlists imported yet.</p>
                        <button className="text-primary font-bold flex items-center gap-2 mx-auto">
                          <Plus size={18} /> Import Now
                        </button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3">
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

                  {/* Recently Modified */}
                  <section className="space-y-4">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <History size={14} /> Recently Import
                    </h2>
                    <div className="space-y-3">
                      {recentTracks.map(track => (
                        <TrackCard key={track.id} track={track} onClick={() => handleTrackClick(track)} />
                      ))}
                    </div>
                  </section>
                </>
              )}
            </motion.div>
          )}

          {currentView === 'playlist' && (
            <motion.div 
              key="playlist"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
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
              
              <div className="space-y-3">
                {playlistTracks?.map((track) => (
                  <TrackCard 
                    key={track.id} 
                    track={track} 
                    onClick={() => handleTrackClick(track)} 
                    isActive={selectedTrack?.id === track.id}
                  />
                ))}
                {playlistTracks?.length === 0 && (
                  <p className="text-center py-12 text-muted-foreground italic">No tracks loaded in this playlist.</p>
                )}
              </div>
            </motion.div>
          )}

          {currentView === 'track' && selectedTrack && (
            <motion.div 
              key="track"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              {/* Artwork / Header */}
              <div className="relative aspect-video w-full glass rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 group">
                <div className="absolute inset-0 brand-gradient opacity-10 group-hover:opacity-20 transition-opacity" />
                <Music className="w-16 h-16 text-primary/20" />
                
                {/* Simulated Waveform Background */}
                <div className="absolute bottom-0 left-0 right-0 h-1/2 opacity-30 px-4 pb-2">
                   <Waveform seed={selectedTrack.id} count={60} />
                </div>

                <div className="absolute bottom-4 left-4 right-4 z-10">
                   <h2 className="text-xl font-black italic uppercase leading-tight line-clamp-2">{selectedTrack.title}</h2>
                   <p className="text-sm font-bold text-primary uppercase tracking-widest">{selectedTrack.artist}</p>
                </div>
                
                <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-lg border border-white/10 text-xs font-mono font-black text-secondary neon-text-purple italic">
                  {formatKey(selectedTrack.key)}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="flex justify-around items-center bg-white/5 py-6 rounded-2xl border border-white/5 shadow-inner">
                <div className="text-center">
                  <p className="text-4xl font-mono font-black tracking-tighter text-white">{Math.round(selectedTrack.bpm)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1">BPM</p>
                </div>
                <div className="h-12 w-px bg-white/10"></div>
                <div className="text-center">
                  <p className="text-4xl font-mono font-black tracking-tighter text-secondary neon-text-purple">{formatKey(selectedTrack.key)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-1">Key</p>
                </div>
              </div>

              {/* Extended Info Cards */}
              <div className="grid grid-cols-2 gap-3">
                 <div className="bg-white/5 border border-white/10 p-4 rounded-xl">
                    <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Duration</p>
                    <p className="text-sm font-mono font-bold text-slate-300">{formatDuration(selectedTrack.duration)}</p>
                 </div>
                 <div className="bg-white/5 border border-white/10 p-4 rounded-xl">
                    <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Energy</p>
                    <div className="flex gap-0.5 mt-1">
                       {[...Array(5)].map((_, i) => (
                         <div key={i} className={cn("w-3 h-1.5 rounded-[1px]", i < selectedTrack.rating / 20 ? "bg-primary" : "bg-muted")} />
                       ))}
                    </div>
                 </div>
              </div>

              {/* Comments */}
              <section className="space-y-3">
                 <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                   <Info size={14} /> DJ Comments
                 </h3>
                 <div className="glass p-4 rounded-2xl text-sm leading-relaxed border-l-4 border-l-secondary">
                    {selectedTrack.comments || 'No specific DJ notes for this track. Use this space to remember energy level or transition tips.'}
                 </div>
              </section>

              {/* Cue Points */}
              <section className="space-y-3">
                 <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                   <Clock size={14} /> Cue Points
                 </h3>
                 <div className="space-y-2">
                   {selectedTrack.cuePoints.length > 0 ? selectedTrack.cuePoints.map((cue, i) => (
                     <div key={i} className="flex items-center gap-4 glass p-3 rounded-xl border border-white/5">
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs",
                          cue.type === 'hot' ? "bg-primary/20 text-primary" : "bg-secondary/20 text-secondary"
                        )}>
                          {cue.type === 'hot' ? 'H' : 'M'}
                        </div>
                        <div className="flex-1">
                           <p className="text-sm font-bold">{cue.name}</p>
                           <p className="text-[10px] font-mono text-muted-foreground">{formatDuration(cue.time)}</p>
                        </div>
                     </div>
                   )) : (
                     <p className="text-center text-muted-foreground text-xs italic py-4">No cue points found in export.</p>
                   )}
                 </div>
              </section>

              {/* Related Tracks */}
              <section className="space-y-3 pb-8">
                 <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-2">
                   <TrendingUp size={14} /> Similar Vibes
                 </h3>
                 <div className="space-y-3">
                   {tracks
                     .filter(t => t.id !== selectedTrack.id && (t.key === selectedTrack.key || Math.abs(t.bpm - selectedTrack.bpm) < 2))
                     .slice(0, 3)
                     .map(t => (
                       <TrackCard key={t.id} track={t} onClick={() => handleTrackClick(t)} />
                     ))}
                 </div>
              </section>
            </motion.div>
          )}

          {currentView === 'review' && (
            <motion.div 
              key="review"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="space-y-6 pb-32"
            >
              <div className="glass p-6 rounded-[2rem] border-2 border-secondary/20 text-center">
                 <Music size={48} className="mx-auto mb-4 text-secondary opacity-50" />
                 <h2 className="text-2xl font-black mb-2">Review Mode</h2>
                 <p className="text-muted-foreground text-sm">Quickly swipe or scroll through your collection. Tap for full details.</p>
              </div>

              <div className="space-y-4">
                {tracks.map(t => (
                  <div key={t.id} onClick={() => handleTrackClick(t)} className="glass p-6 rounded-3xl active:scale-[0.97] transition-transform overflow-hidden relative group">
                     <div className="absolute bottom-0 left-0 right-0 h-8 opacity-10 px-4 group-hover:opacity-30 transition-opacity">
                        <Waveform seed={t.id} count={30} color="secondary" />
                     </div>
                     <div className="flex justify-between items-start mb-2 relative z-10">
                        <h3 className="text-xl font-bold line-clamp-1 flex-1 pr-4">{t.title}</h3>
                        <span className="font-mono text-secondary neon-text-purple border border-secondary/20 px-2 py-0.5 rounded text-sm">{formatKey(t.key)}</span>
                     </div>
                     <p className="text-muted-foreground mb-4">{t.artist}</p>
                     <div className="flex gap-6 items-center">
                        <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">BPM</span>
                           <span className="text-lg font-black font-mono">{t.bpm.toFixed(1)}</span>
                        </div>
                        <div className="h-8 w-[1px] bg-white/10" />
                        <div className="flex flex-col">
                           <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">Energy</span>
                           <div className="flex gap-0.5 mt-1">
                              {[...Array(5)].map((_, i) => (
                                <div key={i} className={cn("w-3 h-1.5 rounded-sm", i < t.rating / 20 ? "bg-primary" : "bg-muted")} />
                              ))}
                           </div>
                        </div>
                     </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Persistent Search/Quick Access / Stats Footer */}
      {currentView === 'home' && (
        <div className="fixed bottom-24 left-0 right-0 px-4 z-30 max-w-md mx-auto">
           <div className="h-10 bg-[#0d0f12] border border-white/10 rounded-full flex items-center justify-center gap-4 px-4 overflow-hidden">
              <div className="flex items-center gap-2 text-[9px] text-slate-500 font-bold">
                <span className="font-mono text-[8px] opacity-60">SYSTEM:</span>
                <span className="text-emerald-500 uppercase tracking-tight">Sync Active</span>
              </div>
              <div className="w-px h-3 bg-white/10" />
              <button className="text-[9px] font-bold text-primary uppercase tracking-widest">All Tracks</button>
              <button className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Hot Reload</button>
           </div>
        </div>
      )}

      {/* Navigation Bar (Mobile focused) */}
      <nav className="fixed bottom-0 left-0 right-0 glass border-t border-white/10 px-8 pt-4 pb-8 flex justify-between items-center z-40 max-w-md mx-auto">
        <button 
          onClick={() => setCurrentView('home')}
          className={cn("flex flex-col items-center gap-1 transition-all", currentView === 'home' ? "text-primary neon-text-blue" : "text-muted-foreground")}
        >
          <Music size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Library</span>
        </button>
        <button 
          onClick={() => setCurrentView('review')}
          className={cn("flex flex-col items-center gap-1 transition-all", currentView === 'review' ? "text-secondary neon-text-purple" : "text-muted-foreground")}
        >
          <TrendingUp size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Review</span>
        </button>
        <button 
          className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
        >
          <Search size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Search</span>
        </button>
        <button 
          className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
        >
          <Settings size={20} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Setup</span>
        </button>
      </nav>

      <ImportModal 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        onImport={() => {
          // Success handled in the parser and by Dexie live queries
        }}
      />
    </div>
  );
}
