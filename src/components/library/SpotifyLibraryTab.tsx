import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, OpenNewWindow, Refresh, Spotify } from 'iconoir-react/regular';
import {
  fetchSpotifyPlaylists,
  fetchSpotifyPlaylistTracks,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from '../../lib/api/externalAccounts';
import { ControlButton } from '../ui/controls';

export function SpotifyLibraryTab({ accessToken }: { accessToken: string }) {
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
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedPlaylist(null)}
          className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft width={15} height={15} aria-hidden="true" /> Back to Spotify playlists
        </button>

        <div className="glass flex flex-col gap-5 rounded-2xl border border-[var(--color-border-subtle)] p-5 sm:flex-row sm:items-end">
          <div className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-xl bg-black/30">
            {selectedPlaylist.image_url ? (
              <img src={selectedPlaylist.image_url} alt="" className="h-full w-full object-contain" />
            ) : (
              <Spotify width={42} height={42} aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1ed760]"><Spotify width={13} height={13} aria-hidden="true" /> Spotify playlist</p>
            <h2 className="mt-2 truncate text-2xl font-black">{selectedPlaylist.name}</h2>
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
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#1ed760] px-4 py-2 text-xs font-black text-[#07120b] transition-transform hover:scale-[1.02]"
            >
              Open in Spotify <OpenNewWindow width={14} height={14} aria-hidden="true" />
            </a>
          )}
        </div>

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
          <div className="glass overflow-hidden rounded-2xl border border-[var(--color-border-subtle)]">
            <RecordTrackListing
              tracks={tracks.map((track, index) => ({
                id: track.id + '-' + index,
                title: track.name,
                artist: track.artists.join(', ') || null,
                duration_ms: track.duration_ms,
                album: track.album_name,
                explicit: track.explicit,
                url: track.external_url,
              }))}
              importId={null}
              getActions={(track) => [
                ...(track.url ? [{
                  id: 'spotify', label: 'Open in Spotify',
                  onSelect: () => { window.open(track.url, '_blank', 'noopener,noreferrer'); },
                }] : []),
                { id: 'album', label: 'Album', hint: track.album ?? '—' },
                ...(track.explicit ? [{ id: 'explicit', label: 'Explicit' }] : []),
              ]}
              ariaLabel="Spotify playlist tracks"
            />
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1ed760]"><Spotify width={13} height={13} aria-hidden="true" /> Connected library</p>
          <h2 className="mt-1 text-xl font-black">Your Spotify Playlists</h2>
          <p className="mt-1 text-xs text-muted-foreground">{playlistsLoading ? 'Loading playlists…' : `${playlistTotal.toLocaleString()} playlists`}</p>
        </div>
        <ControlButton variant="neutral" onClick={() => void loadPlaylists()} disabled={playlistsLoading} className="text-xs">
          <Refresh width={14} height={14} aria-hidden="true" className={playlistsLoading ? 'animate-spin' : undefined} /> Refresh
        </ControlButton>
      </div>

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => setSelectedPlaylist(playlist)}
                className="group min-w-0 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[#1ed760]/45 hover:bg-[var(--color-surface-hover)]"
              >
                <div className="relative grid aspect-square place-items-center overflow-hidden rounded-xl bg-black/30">
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
