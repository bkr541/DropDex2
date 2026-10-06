import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CircleDash, Launch, Renew } from '@carbon/icons-react';
import {
  fetchSpotifyPlaylists,
  fetchSpotifyPlaylistTracks,
  type SpotifyPlaylist,
  type SpotifyTrack,
} from '../../lib/api/externalAccounts';
import { ControlButton } from '../ui/controls';

function SpotifyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 1.25A10.75 10.75 0 1 0 12 22.75 10.75 10.75 0 0 0 12 1.25Zm4.93 15.5a.67.67 0 0 1-.92.22c-2.52-1.54-5.7-1.89-9.44-1.03a.67.67 0 0 1-.3-1.3c4.1-.94 7.61-.54 10.44 1.19.32.2.42.61.22.92Zm1.31-2.92a.84.84 0 0 1-1.15.28c-2.88-1.77-7.28-2.29-10.69-1.25a.84.84 0 1 1-.49-1.6c3.9-1.18 8.74-.61 12.05 1.42.4.24.52.76.28 1.15Zm.12-3.05C14.9 8.73 9.2 8.54 5.9 9.54a1 1 0 1 1-.58-1.92c3.79-1.15 10.1-.93 14.08 1.44a1 1 0 0 1-1.03 1.72Z" />
    </svg>
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

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
          <ArrowLeft size={15} /> Back to Spotify playlists
        </button>

        <div className="glass flex flex-col gap-5 rounded-2xl border border-[var(--color-border-subtle)] p-5 sm:flex-row sm:items-end">
          <div className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-xl bg-black/30">
            {selectedPlaylist.image_url ? (
              <img src={selectedPlaylist.image_url} alt="" className="h-full w-full object-contain" />
            ) : (
              <SpotifyIcon size={42} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1ed760]"><SpotifyIcon size={13} /> Spotify playlist</p>
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
              Open in Spotify <Launch size={14} />
            </a>
          )}
        </div>

        {tracksLoading ? (
          <div className="flex items-center justify-center py-20"><CircleDash className="animate-spin text-[#1ed760]" size={28} /></div>
        ) : tracksError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <p className="text-sm font-bold text-red-400">Unable to load tracks</p>
            <p className="mt-1 text-xs text-muted-foreground">{tracksError}</p>
          </div>
        ) : tracks.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">This playlist has no available tracks.</p>
        ) : (
          <div className="glass overflow-hidden rounded-2xl border border-[var(--color-border-subtle)]">
            <div className="hidden grid-cols-[42px_minmax(220px,1.5fr)_minmax(150px,1fr)_70px_34px] gap-3 border-b border-[var(--color-border-faint)] px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground md:grid">
              <span>#</span><span /><span>Track</span><span>Album</span><span>Duration</span><span />
            </div>
            <div className="divide-y divide-[var(--color-border-faint)]">
              {tracks.map((track, index) => (
                <div key={`${track.id}-${index}`} className="grid grid-cols-[34px_44px_minmax(0,1fr)_34px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-hover)] md:grid-cols-[30px_44px_minmax(170px,1.5fr)_minmax(140px,1fr)_70px_24px]">
                  <span className="font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                  <div className="grid size-11 place-items-center overflow-hidden rounded-md bg-black/30">
                    {track.image_url ? <img src={track.image_url} alt="" className="h-full w-full object-contain" /> : <SpotifyIcon size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{track.name}</p>{track.explicit && <span className="rounded bg-muted-foreground/20 px-1 text-[8px] font-black text-muted-foreground">E</span>}</div>
                    <p className="truncate text-[11px] text-muted-foreground">{track.artists.join(', ') || 'Unknown artist'}</p>
                  </div>
                  <p className="hidden truncate text-xs text-muted-foreground md:block">{track.album_name ?? '—'}</p>
                  <span className="hidden font-mono text-[10px] text-muted-foreground md:block">{formatDuration(track.duration_ms)}</span>
                  {track.external_url ? (
                    <a href={track.external_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${track.name} in Spotify`} className="text-muted-foreground transition-colors hover:text-[#1ed760]"><Launch size={14} /></a>
                  ) : <span />}
                </div>
              ))}
            </div>
            {tracks.length < trackTotal && (
              <div className="flex justify-center border-t border-[var(--color-border-faint)] p-3">
                <ControlButton variant="neutral" onClick={() => void loadMoreTracks()} disabled={tracksLoadingMore}>
                  {tracksLoadingMore ? <><CircleDash size={13} className="animate-spin" /> Loading…</> : `Load more tracks`}
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
          <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#1ed760]"><SpotifyIcon size={13} /> Connected library</p>
          <h2 className="mt-1 text-xl font-black">Your Spotify Playlists</h2>
          <p className="mt-1 text-xs text-muted-foreground">{playlistsLoading ? 'Loading playlists…' : `${playlistTotal.toLocaleString()} playlists`}</p>
        </div>
        <ControlButton variant="neutral" onClick={() => void loadPlaylists()} disabled={playlistsLoading} className="text-xs">
          <Renew size={14} className={playlistsLoading ? 'animate-spin' : undefined} /> Refresh
        </ControlButton>
      </div>

      {playlistsLoading ? (
        <div className="flex items-center justify-center py-20"><CircleDash className="animate-spin text-[#1ed760]" size={28} /></div>
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
                  {playlist.image_url ? <img src={playlist.image_url} alt="" className="h-full w-full object-contain" /> : <SpotifyIcon size={38} />}
                  <span className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-[#1ed760] text-[#07120b] opacity-0 shadow-lg transition-opacity group-hover:opacity-100"><SpotifyIcon size={16} /></span>
                </div>
                <p className="mt-3 truncate text-sm font-bold">{playlist.name}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{playlist.item_count.toLocaleString()} tracks{playlist.owner_name ? ` · ${playlist.owner_name}` : ''}</p>
              </button>
            ))}
          </div>
          {playlists.length < playlistTotal && (
            <div className="flex justify-center pt-2">
              <ControlButton variant="neutral" onClick={() => void loadPlaylists(playlists.length)} disabled={playlistsLoadingMore}>
                {playlistsLoadingMore ? <><CircleDash size={13} className="animate-spin" /> Loading…</> : 'Load more playlists'}
              </ControlButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}
