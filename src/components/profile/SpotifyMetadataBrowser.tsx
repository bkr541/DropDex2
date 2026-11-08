import { LibraryFilterRow, matchesLibrarySearch, recordOptions, useLibraryCollectionFilters } from '../library/LibraryFilterRow';
import { formatTime } from '../../lib/music/trackTiming';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, OpenNewWindow, Refresh, Spotify } from 'iconoir-react/regular';
import {
  fetchSpotifyPlaylists,
  fetchSpotifyPlaylistTracks,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from '../../lib/api/externalAccounts';
import { ControlButton } from '../ui/controls';

export function SpotifyMetadataBrowser({ accessToken }: { accessToken: string }) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);
  const [playlistsLoadingMore, setPlaylistsLoadingMore] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [trackTotal, setTrackTotal] = useState(0);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksLoadingMore, setTracksLoadingMore] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [trackSearch, setTrackSearch] = useState('');
  const [artist, setArtist] = useState('');
  const [content, setContent] = useState('');
  const playlistFilters = useLibraryCollectionFilters(playlists.filter((playlist) => !owner || playlist.owner_name === owner),
    (playlist) => playlist.name, (playlist) => playlist.item_count,
    { playlists: true, searchText: (playlist) => `${playlist.name} ${playlist.owner_name ?? ''} ${playlist.description ?? ''}` });
  const visibleTracks = tracks.filter((track) => matchesLibrarySearch(trackSearch, track.name, ...track.artists, track.album_name)
    && (!artist || track.artists.includes(artist)) && (!content || track.explicit === (content === 'explicit')));

  const loadPlaylists = useCallback(async (offset = 0) => {
    if (offset === 0) {
      setPlaylistsLoading(true);
      setPlaylistsError(null);
    } else {
      setPlaylistsLoadingMore(true);
    }
    try {
      const page = await fetchSpotifyPlaylists(accessToken, offset);
      setPlaylists((current) => offset === 0 ? page.items : [...current, ...page.items]);
      setPlaylistTotal(page.total);
    } catch (reason) {
      setPlaylistsError(reason instanceof Error ? reason.message : 'Could not load Spotify playlists.');
    } finally {
      setPlaylistsLoading(false);
      setPlaylistsLoadingMore(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  useEffect(() => {
    if (!selectedPlaylist) return;
    const controller = new AbortController();
    setTracks([]);
    setTrackSearch('');
    setArtist('');
    setContent('');
    setTrackTotal(0);
    setTracksLoading(true);
    setTracksError(null);
    fetchSpotifyPlaylistTracks(accessToken, selectedPlaylist.id, 0, controller.signal)
      .then((page) => {
        setTracks(page.items);
        setTrackTotal(page.total);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setTracksError(reason instanceof Error ? reason.message : 'Could not load playlist tracks.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTracksLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, selectedPlaylist]);

  const loadMoreTracks = async () => {
    if (!selectedPlaylist) return;
    setTracksLoadingMore(true);
    try {
      const page = await fetchSpotifyPlaylistTracks(accessToken, selectedPlaylist.id, tracks.length);
      setTracks((current) => [...current, ...page.items]);
      setTrackTotal(page.total);
    } catch (reason) {
      setTracksError(reason instanceof Error ? reason.message : 'Could not load more tracks.');
    } finally {
      setTracksLoadingMore(false);
    }
  };

  if (selectedPlaylist) {
    return (
      <section className="profile-spotify space-y-3">
        <button
          type="button"
          onClick={() => setSelectedPlaylist(null)}
          className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft width={15} height={15} aria-hidden="true" /> Back to Spotify playlists
        </button>

        <div className="profile-spotify__identity">
          <div className="profile-spotify__artwork">
            {selectedPlaylist.image_url ? (
              <img src={selectedPlaylist.image_url} alt="" className="h-full w-full object-contain" />
            ) : (
              <Spotify width={42} height={42} aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1ed760]"><Spotify width={13} height={13} aria-hidden="true" /> Spotify playlist</p>
            <h2 className="mt-1 break-words text-lg font-medium">{selectedPlaylist.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedPlaylist.owner_name ? `By ${selectedPlaylist.owner_name} · ` : ''}{trackTotal.toLocaleString()} tracks
            </p>
            {selectedPlaylist.description && <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{selectedPlaylist.description}</p>}
          </div>
          {selectedPlaylist.external_url && (
            <a
              href={selectedPlaylist.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-2 text-xs text-[#1ed760] hover:underline"
            >
              Open in Spotify <OpenNewWindow width={14} height={14} aria-hidden="true" />
            </a>
          )}
        </div>

        <LibraryFilterRow search={trackSearch} onSearchChange={setTrackSearch} label="Spotify playlist tracks"
          placeholder="Search title, artist, or album…" filters={[
            { label: 'Artist', value: artist, onChange: setArtist, options: recordOptions(tracks.flatMap((track) => track.artists)) },
            { label: 'Content', value: content, onChange: setContent, options: [
              { value: '', label: 'All' }, { value: 'clean', label: 'Not explicit' }, { value: 'explicit', label: 'Explicit' },
            ] },
          ]} />
        {!tracksLoading && tracks.length > 0 && <p className="text-xs text-muted-foreground">
          {visibleTracks.length} of {tracks.length} loaded tracks shown{tracks.length < trackTotal ? ' · Search and filters apply to loaded tracks.' : ''}
        </p>}

        {tracksLoading ? (
          <div className="flex items-center justify-center py-20"><Refresh className="animate-spin text-[#1ed760]" width={28} height={28} aria-hidden="true" /></div>
        ) : tracksError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <p className="text-sm font-bold text-red-400">Unable to load tracks</p>
            <p className="mt-1 text-xs text-muted-foreground">{tracksError}</p>
          </div>
        ) : tracks.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">This playlist has no available tracks.</p>
        ) : (
          <div className="profile-records">
            {visibleTracks.length === 0 ? <p className="profile-record text-sm text-muted-foreground">No tracks match your filters.</p> : (
              <ul aria-label="Spotify playlist track metadata" className="profile-spotify__tracks">
                {visibleTracks.map((track, index) => <li key={`${track.id}-${index}`} className="profile-record profile-spotify__track">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{track.name}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{track.artists.join(', ') || '—'}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{track.album_name || '—'}{track.explicit ? ' · Explicit' : ''}</p>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatTime(track.duration_ms)}</span>
                  {track.external_url && <a href={track.external_url} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-[#1ed760]" aria-label={`View ${track.name} on Spotify`} title="View on Spotify">
                    <OpenNewWindow width={16} height={16} aria-hidden="true" />
                  </a>}
                </li>)}
              </ul>
            )}
            {tracks.length < trackTotal && (
              <div className="flex justify-center border-t border-[var(--color-border-faint)] p-3">
                <ControlButton variant="neutral" onClick={() => void loadMoreTracks()} disabled={tracksLoadingMore}>
                  {tracksLoadingMore ? <><Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> Loading…</> : `Load more tracks`}
                </ControlButton>
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="profile-spotify space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1ed760]"><Spotify width={13} height={13} aria-hidden="true" /> Connected library</p>
          <h2 className="mt-1 text-lg font-medium">Your Spotify Playlists</h2>
          <p className="mt-1 text-xs text-muted-foreground">{playlistsLoading ? 'Loading playlists…' : `${playlistTotal.toLocaleString()} playlists`}</p>
        </div>
        <div className="cue-studio">
          <div className="cue-workstation__actions flex shrink-0 items-center">
            <button type="button" className="cue-action-icon" aria-label="Refresh Spotify playlists" title="Refresh Spotify playlists"
              onClick={() => void loadPlaylists()} disabled={playlistsLoading || playlistsLoadingMore}>
              <Refresh width={16} height={16} aria-hidden="true" className={playlistsLoading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>
      </div>

      <LibraryFilterRow search={playlistFilters.search} onSearchChange={playlistFilters.onSearchChange} label="Spotify playlists"
        placeholder="Search playlist, owner, or description…" filters={[
          { label: 'Owner', value: owner, onChange: setOwner, options: recordOptions(playlists.map((playlist) => playlist.owner_name)) },
          ...playlistFilters.filters,
        ]} />
      {!playlistsLoading && playlists.length > 0 && <p className="text-xs text-muted-foreground">
        {playlistFilters.visible.length} of {playlists.length} loaded playlists shown{playlists.length < playlistTotal ? ' · Search and filters apply to loaded playlists.' : ''}
      </p>}

      {playlistsLoading ? (
        <div className="flex items-center justify-center py-20"><Refresh className="animate-spin text-[#1ed760]" width={28} height={28} aria-hidden="true" /></div>
      ) : playlistsError ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <p className="text-sm font-bold text-red-400">Unable to load Spotify playlists</p>
          <p className="mt-1 text-xs text-muted-foreground">{playlistsError}</p>
        </div>
      ) : playlists.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No Spotify playlists found.</p>
      ) : (
        <>
          {playlistFilters.visible.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No playlists match your filters.</p>}
          <div className="profile-spotify__playlists">
            {playlistFilters.visible.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => setSelectedPlaylist(playlist)}
                className="profile-spotify__playlist group"
              >
                <div className="relative grid aspect-square place-items-center overflow-hidden rounded-lg">
                  {playlist.image_url ? <img src={playlist.image_url} alt="" className="h-full w-full object-contain" /> : <Spotify width={38} height={38} aria-hidden="true" />}
                  <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-[#1ed760] text-[#07120b] opacity-0 shadow-lg transition-opacity group-hover:opacity-100"><Spotify width={16} height={16} aria-hidden="true" /></span>
                </div>
                <p className="mt-3 truncate text-sm font-bold">{playlist.name}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{playlist.item_count.toLocaleString()} tracks{playlist.owner_name ? ` · ${playlist.owner_name}` : ''}</p>
              </button>
            ))}
          </div>
          {playlists.length < playlistTotal && (
            <div className="flex justify-center pt-2">
              <ControlButton variant="neutral" onClick={() => void loadPlaylists(playlists.length)} disabled={playlistsLoadingMore}>
                {playlistsLoadingMore ? <><Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> Loading…</> : 'Load more playlists'}
              </ControlButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}
