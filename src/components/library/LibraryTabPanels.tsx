import { Refresh } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import type { PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { UserPlaylistProfile } from '../../types';
import { PlaylistOverviewCard } from './PlaylistOverviewCard';

/** The Playlists tab: a card for every playlist. Shared by the Library and Artist Library pages. */
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
        <p className="lib-label">
          {loading ? '…' : `${playlists.length} items`}
        </p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Refresh className="animate-spin text-muted-foreground" width={20} height={20} aria-hidden="true" />
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-[#ffffff1a] rounded-[20px]">
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
      <p className="lib-label">
        {loading ? 'Loading…' : `${genreStats.length} genres`}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Refresh className="animate-spin text-primary" width={28} height={28} aria-hidden="true" />
        </div>
      ) : genreStats.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground italic text-sm">No genre data in this library.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {genreStats.map(([genre, count]) => (
            <div
              key={genre}
              className="lib-card lib-card--hover p-4"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-[13px] font-medium leading-snug text-[#edf0f6]">{genre}</p>
                <span className="lib-figure shrink-0 text-[20px]">
                  {count.toLocaleString()}
                </span>
              </div>
              <div className="lib-bar"><span style={{ width: `${(count / genreStats[0][1]) * 100}%` }} /></div>
              <p className="lib-label mt-2">tracks</p>
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
      <p className="lib-label">
        {loading ? 'Loading…' : `${artistStats.length.toLocaleString()} artists`}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Refresh className="animate-spin text-primary" width={28} height={28} aria-hidden="true" />
        </div>
      ) : artistStats.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground italic text-sm">No artist data in this library.</p>
      ) : (
        <div className="lib-panel">
          <div className="lib-list-head hidden sm:grid grid-cols-[auto_1fr_80px]">
            {['', 'Artist', 'Tracks'].map((col, i) => (
              <p key={i} className={cn('lib-label', i === 2 && 'text-right')}>
                {col}
              </p>
            ))}
          </div>
          <div>
            {artistStats.map(([artist, count]) => (
              <div
                key={artist}
                className="lib-list-row grid-cols-[auto_1fr_80px]"
              >
                <div className="lib-avatar mr-3">{artist[0]?.toUpperCase() ?? '?'}</div>
                <span className="truncate text-[13px] font-normal text-[#edf0f6]">{artist}</span>
                <span className="lib-figure text-right text-[16px]">
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
