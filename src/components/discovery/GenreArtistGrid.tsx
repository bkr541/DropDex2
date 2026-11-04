import { useState } from 'react';
import { motion } from 'motion/react';
import { CircleDash, Group, User } from '@carbon/icons-react';
import { useGenreArtists } from '../../hooks/useGenreArtists';
import type { DiscoveryArtist, GenreBrowseArtist } from '../../types';

interface GenreArtistGridProps {
  genreId: string;
  genreName: string;
  onSelectArtist: (artist: DiscoveryArtist) => void;
}

function toDiscoveryArtist(artist: GenreBrowseArtist): DiscoveryArtist {
  return { id: artist.id, name: artist.name, normalized_name: artist.normalized_name, matched_alias: null, profile_image_url: artist.profile_image_url };
}

function Avatar({ artist }: { artist: GenreBrowseArtist }) {
  const [failed, setFailed] = useState(false);
  if (artist.profile_image_url && !failed) {
    return <img src={artist.profile_image_url} alt="" onError={() => setFailed(true)} className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-primary/20" />;
  }
  const initials = artist.name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20">
      {initials ? <span className="text-sm font-black text-primary">{initials}</span> : <User size={20} className="text-primary/60" />}
    </div>
  );
}

/** The artists in one genre. Clicking one opens it in Discovery, the same as picking it from the search results. */
export function GenreArtistGrid({ genreId, genreName, onSelectArtist }: GenreArtistGridProps) {
  const { artists, loading, error, retry } = useGenreArtists(genreId);

  return (
    <section className="space-y-4" data-testid="genre-artist-grid">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Group size={12} /> {genreName}
        </h3>
        {!loading && !error && <span className="font-mono text-[10px] text-muted-foreground">{artists.length} ARTISTS</span>}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16"><CircleDash className="animate-spin text-primary" size={28} /></div>
      )}

      {error && (
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm font-bold text-red-400">Couldn&apos;t load the artists in this genre.</p>
          <button type="button" onClick={retry} className="text-xs font-bold text-primary hover:underline">Try again</button>
        </div>
      )}

      {!loading && !error && artists.length === 0 && (
        <div className="space-y-1 rounded-3xl border-2 border-dashed border-[var(--color-border-subtle)] py-14 text-center">
          <p className="text-sm font-bold text-muted-foreground">No artists in this genre yet</p>
        </div>
      )}

      {!loading && !error && artists.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {artists.map((artist, index) => (
            <motion.button
              key={artist.id}
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.02, 0.3) }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectArtist(toDiscoveryArtist(artist))}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-[var(--color-surface-hover)]"
            >
              <Avatar artist={artist} />
              <span className="min-w-0 truncate text-sm font-bold">{artist.name}</span>
            </motion.button>
          ))}
        </div>
      )}
    </section>
  );
}
