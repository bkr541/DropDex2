import { SurfaceCard } from '../ui/display/SurfaceCard';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, OpenNewWindow, Refresh, Spotify, WarningCircle } from 'iconoir-react/regular';
import {
  beginSpotifyAccountLink,
  fetchSpotifyAccountStatus,
  unlinkSpotifyAccount,
  type SpotifyAccountStatus,
} from '../../lib/api/externalAccounts';
import { ControlButton } from '../ui/controls';
import { NoticeCard, StatusBadge } from '../ui/feedback';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

export function SpotifyExternalAccount({ accessToken, onAvailabilityChange }: {
  accessToken: string | null;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [account, setAccount] = useState<SpotifyAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return null;
    const next = await fetchSpotifyAccountStatus(accessToken, signal);
    setAccount(next);
    onAvailabilityChange?.(next.status === 'linked' && next.playlist_access);
    return next;
  }, [accessToken, onAvailabilityChange]);

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
      onAvailabilityChange?.(false);
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
      onAvailabilityChange?.(false);
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
    <SurfaceCard as="div" className="profile-records profile-record space-y-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center text-muted-foreground">
            <Spotify width={24} height={24} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold text-sm">Spotify</p>
              {isPending ? (
                <StatusBadge tone="warning" icon={<Refresh width={10} height={10} aria-hidden="true" className="animate-spin" />}>Connecting</StatusBadge>
              ) : isLinked ? (
                <StatusBadge tone="success" icon={<CheckCircle width={10} height={10} aria-hidden="true" />}>Linked</StatusBadge>
              ) : (
                <StatusBadge tone="error" icon={<WarningCircle width={10} height={10} aria-hidden="true" />}>Failed</StatusBadge>
              )}
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {isLinked
                ? account?.playlist_access
                  ? account.display_name || 'Spotify account connected'
                  : 'Relink Spotify once to enable playlist access'
                : 'Connect Spotify to your DropDex profile'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ControlButton
            variant={isLinked ? 'secondary' : 'primary'}
            onClick={() => void linkSpotify()}
            disabled={!accessToken || loading || isPending}
          >
            {isLinked ? <Refresh width={12} height={12} aria-hidden="true" /> : <OpenNewWindow width={12} height={12} aria-hidden="true" />}
            {isLinked ? 'Relink Spotify' : isPending ? 'Connecting…' : 'Link Spotify'}
          </ControlButton>
          {isLinked && (
            <ControlButton
              variant="danger-outline"
              onClick={() => void unlinkSpotify()}
              disabled={!accessToken || loading || isPending}
            >
              Unlink Spotify
            </ControlButton>
          )}
        </div>
      </div>
      {error && <NoticeCard tone="error">{error}</NoticeCard>}
    </SurfaceCard>
  );
}
