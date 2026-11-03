import { CircleDash } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { UserPlaylistProfile } from '../../types';
import { PlaylistOverviewCard } from './PlaylistOverviewCard';

/** The Playlists tab: a card for every playlist. Shared by the Library and Review pages. */
export function PlaylistsPanel({
  playlists, loading, profilesByRbId, onPlaylistClick, onEditPlaylist,
}: {
  playlists: PlaylistWithCount[];
  loading: boolean;
  profilesByRbId: Map<string, UserPlaylistProfile>;
  onPlaylistClick: (playlist: PlaylistWithCount) => void;
  onEditPlaylist: (playlist: PlaylistWithCount) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-mono">
          {loading ? '…' : `${playlists.length} items`}
        </p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <CircleDash className="animate-spin text-muted-foreground" size={20} />
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
          <p className="text-muted-foreground text-sm">No playlists in this import.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {playlists.map((playlist) => {
            const prof = profilesByRbId.get(playlist.rekordbox_playlist_id);
            return (
              <div key={playlist.id} className="w-[304px]">
                <PlaylistOverviewCard
                  playlist={playlist}
                  artworkUrl={prof?.artwork_url}
                  displayName={prof?.display_name}
                  onClick={() => onPlaylistClick(playlist)}
                  onEdit={() => onEditPlaylist(playlist)}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The Genres tab: how many tracks are in each genre. */
export function GenresPanel({ genreStats, loading }: { genreStats: ReadonlyArray<readonly [string, number]>; loading: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-mono">
        {loading ? 'Loading…' : `${genreStats.length} genres`}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <CircleDash className="animate-spin text-primary" size={28} />
        </div>
      ) : genreStats.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground italic text-sm">No genre data in this library.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {genreStats.map(([genre, count]) => (
            <div
              key={genre}
              className="glass rounded-2xl p-4 border border-[var(--color-border-subtle)] hover:border-primary/25 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-bold text-sm leading-snug">{genre}</p>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">
                  {count.toLocaleString()}
                </span>
              </div>
              <div className="h-1 rounded-full bg-[var(--color-border-subtle)] overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(count / genreStats[0][1]) * 100}%` }}
                />
              </div>
              <p className="text-[9px] text-muted-foreground mt-1.5 font-mono">tracks</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Artists tab: how many tracks each artist has. */
export function ArtistsPanel({ artistStats, loading }: { artistStats: ReadonlyArray<readonly [string, number]>; loading: boolean }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-mono">
        {loading ? 'Loading…' : `${artistStats.length.toLocaleString()} artists`}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <CircleDash className="animate-spin text-primary" size={28} />
        </div>
      ) : artistStats.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground italic text-sm">No artist data in this library.</p>
      ) : (
        <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
          <div className="hidden sm:grid grid-cols-[auto_1fr_80px] px-4 py-2.5 border-b border-[var(--color-border-faint)]">
            {['', 'Artist', 'Tracks'].map((col, i) => (
              <p key={i} className={cn('text-[9px] uppercase tracking-widest text-muted-foreground font-bold', i === 2 && 'text-right')}>
                {col}
              </p>
            ))}
          </div>
          <div className="divide-y divide-[var(--color-border-faint)]">
            {artistStats.map(([artist, count]) => (
              <div
                key={artist}
                className="grid grid-cols-[auto_1fr_80px] items-center px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3 shrink-0">
                  <span className="text-xs font-black text-primary">
                    {artist[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <span className="text-sm font-semibold truncate">{artist}</span>
                <span className="text-[10px] font-mono text-muted-foreground text-right">
                  {count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
