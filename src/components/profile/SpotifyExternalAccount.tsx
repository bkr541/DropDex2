import { useCallback, useEffect, useState } from 'react';
import { CheckmarkFilled, Launch, Renew, WarningFilled } from '@carbon/icons-react';
import {
  beginSpotifyAccountLink,
  fetchSpotifyAccountStatus,
  unlinkSpotifyAccount,
  type SpotifyAccountStatus,
} from '../../lib/api/externalAccounts';
import { ControlButton } from '../ui/controls';
import { StatusBadge } from '../ui/feedback';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

function SpotifyIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 1.25A10.75 10.75 0 1 0 12 22.75 10.75 10.75 0 0 0 12 1.25Zm4.93 15.5a.67.67 0 0 1-.92.22c-2.52-1.54-5.7-1.89-9.44-1.03a.67.67 0 0 1-.3-1.3c4.1-.94 7.61-.54 10.44 1.19.32.2.42.61.22.92Zm1.31-2.92a.84.84 0 0 1-1.15.28c-2.88-1.77-7.28-2.29-10.69-1.25a.84.84 0 1 1-.49-1.6c3.9-1.18 8.74-.61 12.05 1.42.4.24.52.76.28 1.15Zm.12-3.05C14.9 8.73 9.2 8.54 5.9 9.54a1 1 0 1 1-.58-1.92c3.79-1.15 10.1-.93 14.08 1.44a1 1 0 0 1-1.03 1.72Z" />
    </svg>
  );
}

export function SpotifyExternalAccount({ accessToken }: { accessToken: string | null }) {
  const [account, setAccount] = useState<SpotifyAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return null;
    const next = await fetchSpotifyAccountStatus(accessToken, signal);
    setAccount(next);
    return next;
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    refresh(controller.signal)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load Spotify status.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (account?.status !== 'pending') return;
    const startedAt = Date.now();
    let disposed = false;

    const poll = async () => {
      try {
        const next = await refresh();
        if (!disposed && next?.status !== 'pending') setLoading(false);
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : 'Could not verify Spotify status.');
        }
      }
      if (!disposed && Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setAccount((current) => current ? { ...current, status: 'failed' } : current);
        setError('Spotify connection timed out. Try linking again.');
      }
    };

    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [account?.status, refresh]);

  const linkSpotify = async () => {
    if (!accessToken) return;
    setError(null);
    setLoading(true);
    try {
      const authorizationUrl = await beginSpotifyAccountLink(accessToken);
      setAccount({
        provider: 'spotify',
        status: 'pending',
        display_name: account?.display_name ?? null,
        profile_url: account?.profile_url ?? null,
        linked_at: account?.linked_at ?? null,
        playlist_access: false,
      });
      window.open(authorizationUrl, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      setAccount((current) => current ? { ...current, status: 'failed' } : {
        provider: 'spotify',
        status: 'failed',
        display_name: null,
        profile_url: null,
        linked_at: null,
        playlist_access: false,
      });
      setError(reason instanceof Error ? reason.message : 'Could not start Spotify authorization.');
      setLoading(false);
    }
  };

  const unlinkSpotify = async () => {
    if (!accessToken) return;
    setError(null);
    setLoading(true);
    try {
      await unlinkSpotifyAccount(accessToken);
      setAccount({
        provider: 'spotify',
        status: 'failed',
        display_name: null,
        profile_url: null,
        linked_at: null,
        playlist_access: false,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not unlink Spotify.');
    } finally {
      setLoading(false);
    }
  };

  const status = account?.status ?? 'failed';
  const isPending = status === 'pending';
  const isLinked = status === 'linked';

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#1ed760]/12 text-[#1ed760]">
            <SpotifyIcon />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-sm">Spotify</p>
              {isPending ? (
                <StatusBadge tone="warning" icon={<Renew size={10} className="animate-spin" />}>Connecting</StatusBadge>
              ) : isLinked ? (
                <StatusBadge tone="success" icon={<CheckmarkFilled size={10} />}>Linked</StatusBadge>
              ) : (
                <StatusBadge tone="error" icon={<WarningFilled size={10} />}>Failed</StatusBadge>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {isLinked
                ? account?.playlist_access
                  ? account.display_name || 'Spotify account connected'
                  : 'Relink Spotify once to enable playlist access'
                : 'Connect Spotify to your DropDex profile'}
            </p>
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          <ControlButton
            variant={isLinked ? 'surface' : 'primary'}
            onClick={() => void linkSpotify()}
            disabled={!accessToken || loading || isPending}
            className="!h-7 !min-h-7 w-[116px] !px-2.5 !text-[10px]"
          >
            {isLinked ? <Renew size={12} /> : <Launch size={12} />}
            {isLinked ? 'Relink Spotify' : isPending ? 'Connecting…' : 'Link Spotify'}
          </ControlButton>
          {isLinked && (
            <ControlButton
              variant="danger-outline"
              onClick={() => void unlinkSpotify()}
              disabled={!accessToken || loading || isPending}
              className="!h-7 !min-h-7 w-[116px] !px-2.5 !text-[10px]"
            >
              Unlink Spotify
            </ControlButton>
          )}
        </div>
      </div>
    </div>
  );
}
