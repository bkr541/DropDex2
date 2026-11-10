import { useMemo } from 'react';
import { Refresh } from 'iconoir-react/regular';
import type { DiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import type { DiscoveryForYou } from '../../hooks/useDiscoveryForYou';
import { ArtistCard } from './ArtistCard';
import { ArtistFeedRow } from './ArtistFeedRow';
import { DiscoveryShelf } from './DiscoveryShelf';
import { GenreTile } from './GenreTile';
import { SetlistFeedCard } from './SetlistFeedCard';
import type { CatalogGenre, DiscoveryArtist, DiscoverySetlistResult } from '../../types';

interface DiscoveryHomeFeedProps {
  feed: DiscoveryFeed;
  forYou: DiscoveryForYou;
  /** Every genre in the catalog. */
  genres: CatalogGenre[];
  onSelectArtist: (artist: DiscoveryArtist) => void;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
  onSelectGenre: (genreId: string) => void;
  /** Opens the profile so the user can choose favorite artists and genres. */
  onEditTaste?: () => void;
}

const POPULAR_GENRES = 16;
const FRESH_SETS = 20;

const toDiscoveryArtist = (artist: { id: string; name: string; normalized_name: string | null; profile_image_url: string | null }): DiscoveryArtist => ({
  id: artist.id, name: artist.name, normalized_name: artist.normalized_name, matched_alias: null, profile_image_url: artist.profile_image_url,
});

/**
 * The Discovery home: rows to browse. First what is personal (your genres, your artists, artists like them,
 * more of each favorite genre), then what is going on (trending artists, fresh sets), then ways in (popular
 * genres) and each top artist with their latest sets.
 */
export function DiscoveryHomeFeed({ feed, forYou, genres, onSelectArtist, onOpenSetlist, onSelectGenre, onEditTaste }: DiscoveryHomeFeedProps) {
  const { artists, setlistsByArtist } = feed;

  const freshSets = useMemo(() => {
    const names = new Map(artists.map((artist) => [artist.id, artist.name]));
    return [...setlistsByArtist.entries()]
      .flatMap(([artistId, setlists]) => setlists.map((setlist) => ({ setlist, artistName: names.get(artistId) ?? null })))
      .sort((a, b) => (b.setlist.set_date ?? '').localeCompare(a.setlist.set_date ?? ''))
      .slice(0, FRESH_SETS);
  }, [artists, setlistsByArtist]);
  const popularGenres = useMemo(() => [...genres].sort((a, b) => b.artistCount - a.artistCount).slice(0, POPULAR_GENRES), [genres]);

  if (feed.loading && forYou.loading) {
    return (
      <div className="studio-empty" role="status">
        <Refresh className="animate-spin text-control-primary" width={24} height={24} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div data-testid="discovery-feed">
      {forYou.error && (
        <div className="discovery-notice" role="alert">
          <span className="text-red-300">{forYou.error}</span>
          <button type="button" onClick={forYou.retry} className="studio-link">Try again</button>
        </div>
      )}

      {!forYou.loading && !forYou.error && !forYou.hasTaste && (
        <div className="discovery-notice" data-testid="discovery-taste-prompt">
          <span>Pick your favorite artists and genres and Discovery will fill with artists like them.</span>
          {onEditTaste && <button type="button" onClick={onEditTaste} className="studio-link">Choose favorites</button>}
        </div>
      )}

      {forYou.favoriteGenres.length > 0 && (
        <DiscoveryShelf title="Your genres" testId="discovery-your-genres">
          {forYou.favoriteGenres.map((genre) => <GenreTile key={genre.id} name={genre.name} artistCount={genre.artistCount} favorite onOpen={() => onSelectGenre(genre.id)} />)}
        </DiscoveryShelf>
      )}

      {forYou.shelves.map((shelf) => (
        <DiscoveryShelf
          key={shelf.id}
          title={shelf.title}
          caption={shelf.caption}
          action={shelf.genreId ? { label: 'See all', onClick: () => onSelectGenre(shelf.genreId!) } : undefined}
          testId={`discovery-shelf-${shelf.kind}`}
        >
          {shelf.artists.map((artist) => <ArtistCard key={artist.id} name={artist.name} imageUrl={artist.profile_image_url} subtitle={artist.subtitle} onOpen={() => onSelectArtist(toDiscoveryArtist(artist))} />)}
        </DiscoveryShelf>
      ))}

      {feed.error ? (
        <div className="discovery-notice" role="alert">
          <span className="text-red-300">{feed.error}</span>
          <button type="button" onClick={feed.retry} className="studio-link">Try again</button>
        </div>
      ) : (
        <>
          {artists.length > 0 && (
            <DiscoveryShelf title="Trending artists" caption="Most sets" testId="discovery-shelf-trending">
              {artists.map((artist) => (
                <ArtistCard
                  key={artist.id}
                  name={artist.name}
                  imageUrl={artist.profile_image_url}
                  subtitle={artist.genres.slice(0, 3).map((genre) => genre.name).join(' · ') || null}
                  setCount={artist.setlist_count}
                  onOpen={() => onSelectArtist(toDiscoveryArtist(artist))}
                />
              ))}
            </DiscoveryShelf>
          )}

          {freshSets.length > 0 && (
            <DiscoveryShelf title="Fresh sets" caption="Newest first" testId="discovery-shelf-fresh">
              {freshSets.map(({ setlist, artistName }) => <SetlistFeedCard key={setlist.id} setlist={setlist} artistName={artistName} onOpen={onOpenSetlist} />)}
            </DiscoveryShelf>
          )}
        </>
      )}

      {popularGenres.length > 0 && (
        <DiscoveryShelf title="Popular genres" caption="Most artists" testId="discovery-shelf-popular">
          {popularGenres.map((genre) => <GenreTile key={genre.id} name={genre.name} artistCount={genre.artistCount} onOpen={() => onSelectGenre(genre.id)} />)}
        </DiscoveryShelf>
      )}

      {!feed.error && artists.length > 0 && (
        <section aria-label="Latest sets by artist" data-testid="discovery-artist-rows">
          <div className="discovery-section-head discovery-shelf-heading">
            <h3 className="studio-title">Latest sets by artist</h3>
            <span className="discovery-shelf-caption">{artists.length} {artists.length === 1 ? 'artist' : 'artists'}</span>
          </div>
          {artists.map((artist) => {
            const setlists = setlistsByArtist.get(artist.id);
            return (
              <ArtistFeedRow
                key={artist.id}
                artist={artist}
                setlists={setlists ?? []}
                setlistsLoading={setlists === undefined}
                onSeeAll={() => onSelectArtist(toDiscoveryArtist(artist))}
                onOpenSetlist={onOpenSetlist}
              />
            );
          })}
        </section>
      )}

      {!feed.loading && !feed.error && artists.length === 0 && forYou.shelves.length === 0 && (
        <div className="studio-empty">
          <p>No artist setlists in the catalog yet.</p>
          <p>Search for an artist above to add their setlists to this list.</p>
        </div>
      )}
    </div>
  );
}
