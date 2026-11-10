import type { ReactNode } from 'react';
import { EditPencil, Folder, MusicNote, Refresh } from 'iconoir-react/regular';
import { LibraryFilterRow, useLibraryCollectionFilters } from './LibraryFilterRow';
import { useLibraryListingViewport } from './useLibraryListingViewport';
import type { GenreSummary, PlaylistWithCount } from '../../lib/queries/rekordbox';
import type { UserPlaylistProfile } from '../../types';
import { Artwork } from '../ui/display/Artwork';
import { TrackTable, TrackTableBody, TrackTableHead, TrackTableHeadCell, TrackTableRow } from '../ui/display/TrackTable';
import '../ui/display/track-listing.css';

function LibraryCollectionTable({ label, hasActions, children }: {
  label: 'Playlist' | 'Artist';
  hasActions?: boolean;
  children: ReactNode;
}) {
  const { listingRef, maxHeight } = useLibraryListingViewport();
  return (
    <div className="track-listing" ref={listingRef}>
      <div className="track-listing__scroll overflow-auto scrollbar-none" style={{ maxHeight }}>
        <TrackTable className="track-listing__table table-fixed" aria-label={`${label} listing`}>
          <TrackTableHead className="normal-case">
            <TrackTableHeadCell label={label} className="tracking-[.12em]" />
            <TrackTableHeadCell label="Tracks" className="w-[88px] text-center tracking-[.12em]" />
            {hasActions && <TrackTableHeadCell label="Actions" className="w-[88px] text-center" />}
          </TrackTableHead>
          <TrackTableBody>{children}</TrackTableBody>
        </TrackTable>
      </div>
    </div>
  );
}

function LibraryCollectionRow({ name, label, leading, trackCount, onOpen, actions }: {
  name: string;
  label: string;
  leading: ReactNode;
  trackCount: number;
  onOpen: () => void;
  actions?: ReactNode;
}) {
  return (
    <TrackTableRow aria-label={label} onClick={onOpen} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      onOpen();
    }}>
      <td className="px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {leading}
          <span className="min-w-0 truncate text-xs text-[#edf0f6]" title={name}>{name}</span>
        </div>
      </td>
      <td className="px-3 py-1.5 tabular-nums">{trackCount.toLocaleString()}</td>
      {actions !== undefined && <td className="track-listing__actions px-3 py-1.5">{actions}</td>}
    </TrackTableRow>
  );
}

export function PlaylistsPanel({
  playlists, loading, profilesByRbId, onPlaylistClick, onEditPlaylist,
}: {
  playlists: PlaylistWithCount[];
  loading: boolean;
  profilesByRbId: Map<string, UserPlaylistProfile>;
  onPlaylistClick: (playlist: PlaylistWithCount) => void;
  onEditPlaylist: (playlist: PlaylistWithCount) => void;
}) {
  const { visible, ...filterRow } = useLibraryCollectionFilters(playlists,
    (playlist) => profilesByRbId.get(playlist.rekordbox_playlist_id)?.display_name || playlist.name,
    (playlist) => playlist.track_count,
    { playlists: true, searchText: (playlist) => `${profilesByRbId.get(playlist.rekordbox_playlist_id)?.display_name ?? ''} ${playlist.name} ${playlist.top_genres?.join(' ') ?? ''}` });
  return (
    <section className="pb-10" aria-label="Library playlists">
      <LibraryFilterRow {...filterRow} label="Playlists" placeholder="Search playlists or genres…" />
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <Refresh className="animate-spin text-control-primary" width={22} height={22} aria-hidden="true" />
          Loading playlists…
        </div>
      ) : visible.length === 0 ? (
        <p className="px-5 py-14 text-center text-sm text-muted-foreground">
          {playlists.length === 0 ? 'No playlists in this import.' : 'No playlists match your filters.'}
        </p>
      ) : (
        <LibraryCollectionTable label="Playlist" hasActions>
          {visible.map((playlist) => {
            const profile = profilesByRbId.get(playlist.rekordbox_playlist_id);
            const name = profile?.display_name || playlist.name;
            const Icon = playlist.is_folder ? Folder : MusicNote;
            return (
              <LibraryCollectionRow
                key={playlist.id}
                name={name}
                label={`Open ${name}`}
                leading={profile?.artwork_url
                  ? <Artwork src={profile.artwork_url} alt="" className="size-6 shrink-0 rounded" />
                  : <span className="lib-list-mark" aria-hidden="true"><Icon width={13} height={13} /></span>}
                trackCount={playlist.track_count}
                onOpen={() => onPlaylistClick(playlist)}
                actions={playlist.is_folder ? null : (
                  <button type="button" className="track-listing__actions-button" aria-label={`Edit ${name}`} onClick={(event) => {
                    event.stopPropagation();
                    onEditPlaylist(playlist);
                  }}>
                    <EditPencil width={15} height={15} aria-hidden="true" />
                  </button>
                )}
              />
            );
          })}
        </LibraryCollectionTable>
      )}
    </section>
  );
}

const genreShareFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const genreBpmFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function GenresPanel({ genreStats, loading, onGenreClick }: {
  genreStats: readonly GenreSummary[];
  loading: boolean;
  onGenreClick: (genre: string | null) => void;
}) {
  const { visible, ...filterRow } = useLibraryCollectionFilters(genreStats, ({ name }) => name ?? 'Untagged', ({ count }) => count);
  const taggedGenres = genreStats.filter(({ name }) => name !== null);
  const taggedTrackCount = taggedGenres.reduce((total, { count }) => total + count, 0);

  return (
    <section className="pb-10" aria-label="Library genres">
      <div className="border-b border-[var(--color-border-faint)]">
        <LibraryFilterRow {...filterRow} label="Genres" placeholder="Search genres…" />
      </div>
      <div className="space-y-3 px-4 pt-3" data-testid="library-genre-content">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground" role="status">
            <Refresh className="animate-spin text-control-primary" width={22} height={22} aria-hidden="true" />
            Loading genres…
          </div>
        ) : genreStats.length === 0 ? (
          <p className="py-12 text-center text-sm italic text-muted-foreground">No genre data in this library.</p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No genres match your filters.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {visible.map(({ name, count, minBpm, maxBpm, artistCount }) => {
              const label = name ?? 'Untagged';
              const share = taggedTrackCount > 0 ? count / taggedTrackCount : 0;
              const bpm = minBpm === null || maxBpm === null ? '—' : minBpm === maxBpm
                ? genreBpmFormat.format(minBpm)
                : `${genreBpmFormat.format(minBpm)}–${genreBpmFormat.format(maxBpm)}`;

              return (
                <button
                  key={name ?? ''}
                  type="button"
                  className="lib-card lib-card--hover flex min-w-0 cursor-pointer flex-col gap-2 p-4 text-left"
                  onClick={() => onGenreClick(name)}
                  aria-label={name === null ? 'View untagged tracks' : `View ${name} tracks`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-[13px] font-medium leading-snug">{label}</span>
                    <span className="shrink-0 whitespace-nowrap">
                      <span className="lib-figure text-[20px]">{count.toLocaleString()}</span>{' '}
                      <span className="lib-label">{count === 1 ? 'track' : 'tracks'}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>{bpm} BPM</span>
                    <span>{artistCount?.toLocaleString() ?? '—'} {artistCount === 1 ? 'artist' : 'artists'}</span>
                  </span>
                  {name === null ? (
                    <span className="lib-label">Missing genre tag</span>
                  ) : (
                    <>
                      <span className="lib-bar" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></span>
                      <span className="lib-label">{genreShareFormat.format(share)} of tagged tracks</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/** The Artists tab: how many tracks each artist has. */
export function ArtistsPanel({ artistStats, loading, onArtistClick }: {
  artistStats: ReadonlyArray<readonly [string, number]>;
  loading: boolean;
  onArtistClick: (artist: string) => void;
}) {
  const { visible, ...filterRow } = useLibraryCollectionFilters(artistStats, ([name]) => name, ([, count]) => count);
  return (
    <section className="pb-10" aria-label="Library artists">
      <LibraryFilterRow {...filterRow} label="Artists" placeholder="Search artists…" />
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <Refresh className="animate-spin text-control-primary" width={22} height={22} aria-hidden="true" />
          Loading artists…
        </div>
      ) : visible.length === 0 ? (
        <p className="px-5 py-14 text-center text-sm text-muted-foreground">
          {artistStats.length === 0 ? 'No artist data in this library.' : 'No artists match your filters.'}
        </p>
      ) : (
        <LibraryCollectionTable label="Artist">
          {visible.map(([artist, count]) => (
            <LibraryCollectionRow
              key={artist}
              name={artist}
              label={`View tracks by ${artist}`}
              leading={<span className="lib-list-mark" aria-hidden="true">{artist[0]?.toUpperCase() ?? '?'}</span>}
              trackCount={count}
              onOpen={() => onArtistClick(artist)}
            />
          ))}
        </LibraryCollectionTable>
      )}
    </section>
  );
}
