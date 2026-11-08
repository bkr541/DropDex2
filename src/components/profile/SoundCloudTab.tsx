import { useEffect, useState } from 'react';
import { fetchIlleniumTrackTitles } from '../../lib/api/soundcloud';
import { isAbortError } from '../../lib/api/responseValidation';
import { ControlButton } from '../ui/controls';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { EmptyState, NoticeCard, StatusLoader } from '../ui/feedback';

export function SoundCloudTab({ accessToken }: { accessToken: string | null }) {
  const [titles, setTitles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setTitles([]);
    setError(null);
    setLoading(true);
    if (!accessToken) return () => controller.abort();

    fetchIlleniumTrackTitles(accessToken, controller.signal)
      .then((results) => {
        if (!controller.signal.aborted) setTitles(results);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && !isAbortError(reason)) {
          setError(reason instanceof Error ? reason.message : 'SoundCloud search failed.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, attempt]);

  return (
    <section className="profile-group" aria-label="SoundCloud track search">
      <h2 className="profile-heading">SoundCloud</h2>
      <p className="text-xs text-muted-foreground">Track search results for ILLENIUM · Up to 20 results</p>
      <SurfaceCard as="div" className="profile-records">
        <p className="profile-record-heading">Track</p>
        {loading ? (
          <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <StatusLoader label="Loading SoundCloud tracks" />
            <span>Loading tracks…</span>
          </div>
        ) : error ? (
          <div className="p-4">
            <NoticeCard
              tone="error"
              title="SoundCloud search failed"
              action={<ControlButton variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</ControlButton>}
            >
              {error}
            </NoticeCard>
          </div>
        ) : titles.length === 0 ? (
          <EmptyState title="No tracks found" message="The SoundCloud search returned no track titles." />
        ) : (
          <ul className="divide-y divide-[var(--color-border-faint)] text-xs">
            {titles.map((title, index) => <li key={index} className="profile-record flex items-center break-words">{title}</li>)}
          </ul>
        )}
      </SurfaceCard>
    </section>
  );
}
