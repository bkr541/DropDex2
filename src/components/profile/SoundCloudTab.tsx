import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, NavArrowRight } from 'iconoir-react/regular';
import { fetchSoundCloudArtistTrackTitles, fetchSoundCloudFavoriteArtists, type SoundCloudFavoriteArtist } from '../../lib/api/soundcloud';
import { isAbortError } from '../../lib/api/responseValidation';
import { ControlButton } from '../ui/controls';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { EmptyState, NoticeCard, StatusLoader } from '../ui/feedback';

type Results = { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; titles: string[] };

interface SoundCloudTabProps {
  accessToken: string | null;
  /** Back from the artist cards to the External Music screen. */
  onBackToServices: () => void;
}

/**
 * SoundCloud: the user's top five saved favorite artists as cards. Opening a card searches SoundCloud for that artist only
 * (one search at a time, started on click) and lists the track titles. Back returns to the cards, then to External Music.
 */
export function SoundCloudTab({ accessToken, onBackToServices }: SoundCloudTabProps) {
  const [artists, setArtists] = useState<SoundCloudFavoriteArtist[] | null>(null);
  const [artistsError, setArtistsError] = useState<string | null>(null);
  const [artistsAttempt, setArtistsAttempt] = useState(0);
  const [selected, setSelected] = useState<SoundCloudFavoriteArtist | null>(null);
  const [results, setResults] = useState<Results>({ status: 'loading' });
  const [searchAttempt, setSearchAttempt] = useState(0);
  // Results already fetched in this visit, so going back and reopening an artist does not search again.
  const cache = useRef(new Map<string, string[]>());

  useEffect(() => {
    if (!accessToken) return undefined;
    const controller = new AbortController();
    setArtists(null);
    setArtistsError(null);
    fetchSoundCloudFavoriteArtists(accessToken, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setArtists(rows); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && !isAbortError(reason)) setArtistsError(reason instanceof Error ? reason.message : 'Your favorite artists could not be loaded.');
      });
    return () => controller.abort();
  }, [accessToken, artistsAttempt]);

  // The search runs only for the open artist. Leaving or switching cancels it, so an earlier artist's answer can never land on a later one.
  useEffect(() => {
    if (!selected || !accessToken) return undefined;
    const cached = cache.current.get(selected.id);
    if (cached) { setResults({ status: 'done', titles: cached }); return undefined; }
    const controller = new AbortController();
    setResults({ status: 'loading' });
    fetchSoundCloudArtistTrackTitles(accessToken, selected.id, controller.signal)
      .then((titles) => {
        if (controller.signal.aborted) return;
        cache.current.set(selected.id, titles);
        setResults({ status: 'done', titles });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && !isAbortError(reason)) setResults({ status: 'error', message: reason instanceof Error ? reason.message : 'SoundCloud search failed.' });
      });
    return () => controller.abort();
  }, [accessToken, selected, searchAttempt]);

  const open = useCallback((artist: SoundCloudFavoriteArtist) => { setResults({ status: 'loading' }); setSelected(artist); }, []);

  if (selected) {
    return (
      <section className="profile-group" aria-label={`SoundCloud tracks for ${selected.name}`}>
        <ControlButton variant="ghost" onClick={() => setSelected(null)} aria-label="Back to Artists">
          <ArrowLeft width={16} height={16} aria-hidden="true" /> Back to Artists
        </ControlButton>
        <h2 className="profile-heading">SoundCloud / {selected.name}</h2>
        <p className="text-xs text-muted-foreground">Tracks found · Up to 20 results</p>
        <SurfaceCard as="div" className="profile-records">
          <p className="profile-record-heading">Track</p>
          {results.status === 'loading' ? (
            <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
              <StatusLoader label="Loading SoundCloud tracks" />
              <span>Loading tracks…</span>
            </div>
          ) : results.status === 'error' ? (
            <div className="p-4">
              <NoticeCard
                tone="error"
                title="SoundCloud search failed"
                action={<ControlButton variant="secondary" onClick={() => setSearchAttempt((value) => value + 1)}>Retry</ControlButton>}
              >
                {results.message}
              </NoticeCard>
            </div>
          ) : results.titles.length === 0 ? (
            <EmptyState title="No tracks found" message={`The SoundCloud search for ${selected.name} returned no track titles.`} />
          ) : (
            <ul className="divide-y divide-[var(--color-border-faint)] text-xs">
              {results.titles.map((title, index) => <li key={index} className="profile-record flex items-center break-words">{title}</li>)}
            </ul>
          )}
        </SurfaceCard>
      </section>
    );
  }

  return (
    <section className="profile-group" aria-label="SoundCloud favorite artists">
      <ControlButton variant="ghost" onClick={onBackToServices} aria-label="Back to External Music">
        <ArrowLeft width={16} height={16} aria-hidden="true" /> Back to External Music
      </ControlButton>
      <h2 className="profile-heading">SoundCloud</h2>
      <p className="text-xs text-muted-foreground">Your Favorite Artists · Choose one to see its SoundCloud tracks</p>
      {artistsError ? (
        <NoticeCard
          tone="error"
          title="Favorite artists failed to load"
          action={<ControlButton variant="secondary" onClick={() => setArtistsAttempt((value) => value + 1)}>Retry</ControlButton>}
        >
          {artistsError}
        </NoticeCard>
      ) : artists === null ? (
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <StatusLoader label="Loading favorite artists" />
          <span>Loading your favorite artists…</span>
        </div>
      ) : artists.length === 0 ? (
        <EmptyState title="No favorite artists yet" message="Choose your favorite artists in your profile, and they will appear here." />
      ) : (
        <div className="profile-external-services" data-testid="soundcloud-artists">
          {artists.map((artist) => (
            <button key={artist.id} type="button" className="profile-external-service" onClick={() => open(artist)} aria-label={`Open SoundCloud tracks for ${artist.name}`}>
              <span className="min-w-0"><span className="block text-sm font-medium">{artist.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">View SoundCloud tracks</span></span>
              <NavArrowRight width={16} height={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
