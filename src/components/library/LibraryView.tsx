import { useState } from 'react';
import { Search, ListMusic, Loader2, Disc3, FileUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useRekordboxSearch } from '../../hooks/useRekordboxTracks';
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
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';

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
  genres,
  onPlaylistClick,
  onEditPlaylist,
  onTrackClick,
  onImport,
  onEditProfile,
}: LibraryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { results: searchResults, loading: searchLoading } = useRekordboxSearch(
    importId,
    searchQuery,
  );

  const showSearch = searchQuery.trim().length >= 2;

  return (
    <div className="space-y-6 md:max-w-7xl md:mx-auto">
      {/* Search input — material underline style */}
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
              loading={searchLoading}
              importId={importId}
              onTrackClick={onTrackClick}
            />
          </motion.div>
        ) : (
          <motion.div
            key="library-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-6"
          >
            {/* Loading */}
            {importLoading && (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="animate-spin text-primary" size={32} />
              </div>
            )}

            {/* Error */}
            {!importLoading && importError && (
              <div className="text-center py-24 space-y-2">
                <p className="text-red-400 font-bold">Failed to load library</p>
                <p className="text-xs text-muted-foreground">{importError}</p>
              </div>
            )}

            {/* Empty */}
            {!importLoading && !importError && !latestImport && (
              <EmptyLibrary onImport={onImport} />
            )}

            {/* Library */}
            {!importLoading && !importError && latestImport && (
              <>
                <LibraryHero
                  latestImport={latestImport}
                  profile={profile}
                  genres={genres}
                  onImport={onImport}
                  onEditProfile={onEditProfile}
                />

                {/* Playlists */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <ListMusic size={13} /> Playlists
                    </h2>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {playlistsLoading ? '…' : `${playlists.length} items`}
                    </span>
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

                {/* Recently added */}
                <RecentlyAddedTracksTable
                  tracks={recentTracks}
                  loading={recentTracksLoading}
                  onTrackClick={onTrackClick}
                />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
