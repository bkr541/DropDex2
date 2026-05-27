import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { useArtistsByGenre } from '../../hooks/useArtistsByGenre';
import { ArtistCard, artistAvatarColor } from './ArtistCard';
import type { SearchArtist } from '../../types';

const GENRES = ['Melodic Dubstep', 'Future Bass'];

export function SearchView() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | null>(null);

  const { artists, loading, error } = useArtistsByGenre(GENRES);

  const trimmed = query.trim();
  const showDropdown = trimmed.length >= 2 && focused;

  const filteredArtists: SearchArtist[] = showDropdown
    ? artists.filter((a) =>
        a.name.toLowerCase().includes(trimmed.toLowerCase()) ||
        (a.normalized_name ?? '').includes(trimmed.toLowerCase()),
      )
    : [];

  const handleFocus = () => {
    if (blurTimer.current !== null) {
      window.clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    setFocused(true);
  };

  const handleBlur = () => {
    blurTimer.current = window.setTimeout(() => setFocused(false), 150);
  };

  useEffect(() => {
    return () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
    };
  }, []);

  const handleDropdownSelect = (_artist: SearchArtist) => {
    setQuery('');
    setFocused(false);
  };

  return (
    <div className="space-y-8 md:max-w-5xl md:mx-auto">
      {/* Search input */}
      <div className="relative">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10"
          size={18}
        />
        <input
          ref={inputRef}
          type="text"
          placeholder="Filter artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-2xl py-4 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-medium text-foreground placeholder:text-muted-foreground"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        )}

        {/* Dropdown */}
        <AnimatePresence>
          {showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 right-0 z-50 mt-2 bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-2xl shadow-2xl overflow-hidden"
              style={{ maxHeight: '288px', overflowY: 'auto' }}
            >
              {filteredArtists.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-5 text-muted-foreground">
                  <Users size={16} />
                  <p className="text-sm">No matching artists</p>
                </div>
              ) : (
                filteredArtists.map((artist) => (
                  <button
                    key={artist.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleDropdownSelect(artist)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface)] transition-colors text-left border-b border-[var(--color-border-faint)] last:border-0"
                  >
                    <div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0',
                        artistAvatarColor(artist.name),
                      )}
                    >
                      {artist.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{artist.name}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest truncate">
                        {artist.genres.join(' · ')}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Artists section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Users size={12} />
            Melodic Dubstep &amp; Future Bass
          </h3>
          {!loading && !error && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {artists.length} ARTISTS
            </span>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}

        {error && (
          <div className="text-center py-12 space-y-2">
            <p className="text-red-400 font-bold text-sm">Failed to load artists</p>
            <p className="text-xs text-muted-foreground font-mono">{error}</p>
          </div>
        )}

        {!loading && !error && artists.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl space-y-3">
            <Users size={32} className="mx-auto text-muted-foreground opacity-40" />
            <div>
              <p className="text-sm font-bold text-muted-foreground">No artists yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Artists tagged as Melodic Dubstep or Future Bass will appear here.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && artists.length > 0 && (
          <div
            className="flex gap-4 overflow-x-auto pb-3 -mx-4 px-4 md:-mx-8 md:px-8 scrollbar-none"
          >
            {artists.map((artist, i) => (
              <motion.div
                key={artist.id}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4) }}
              >
                <ArtistCard artist={artist} />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
