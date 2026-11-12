import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Refresh, Shuffle } from 'iconoir-react/regular';
import type { DiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import type { DiscoveryForYou } from '../../hooks/useDiscoveryForYou';
import { useDiscoveryPick } from '../../hooks/useDiscoveryPick';
import { dayNumber } from '../../lib/discovery/forYou';
import { buildFreshWeek, pickCandidates } from '../../lib/discovery/headerGroups';
import type { CatalogGenre, DiscoveryArtist, DiscoverySetlistResult } from '../../types';
import { ControlButton } from '../ui/controls';
import { SkeletonBlock } from '../ui/feedback';

/** How long each group stays before the header moves to the next one. */
export const HERO_CYCLE_MS = 9000;

interface HeroGroupProps {
  groupId: string;
  label: string;
  title: string;
  figures: readonly (readonly [string, string])[];
  actions: ReactNode;
  chartTitle: string;
  chartLabel: string;
  values: readonly number[];
  ticks: readonly string[];
}

/** One group in the header: a small label, a light title, three figures, two buttons, and a small bar chart on the right. */
export function DiscoveryHeroGroup({ groupId, label, title, figures, actions, chartTitle, chartLabel, values, ticks }: HeroGroupProps) {
  const max = Math.max(1, ...values);
  return (
    <div className="discovery-hero-group" data-testid={`discovery-hero-${groupId}`}>
      <div className="discovery-hero-main">
        <span className="studio-label">{label}</span>
        <h2>{title}</h2>
        <div className="discovery-hero-figures">
          {figures.map(([value, caption]) => <span key={caption}><em title={value}>{value}</em><small>{caption}</small></span>)}
        </div>
        <div className="discovery-hero-actions">{actions}</div>
      </div>
      <div className="discovery-hero-chart" role="img" aria-label={chartLabel}>
        <small>{chartTitle}</small>
        <div>{values.map((n, i) => <span key={i} style={{ '--bar': `${(n / max) * 100}%` } as CSSProperties}><i /><b>{ticks[i]}</b></span>)}</div>
      </div>
    </div>
  );
}

interface DiscoveryHeroProps {
  feed: DiscoveryFeed;
  forYou: DiscoveryForYou;
  genres: CatalogGenre[];
  onSelectArtist: (artist: DiscoveryArtist) => void;
  onOpenSetlist: (setlist: DiscoverySetlistResult) => void;
  /** The feed, genres or personal rows are still loading, so what the header will show is not known yet. */
  pending?: boolean;
  /** Some top artist's latest sets have not arrived, so "Fresh this week" may still appear. */
  setlistsPending?: boolean;
}

/** The header before it knows what to show: the same box and the same parts, so the page below does not move when it fills in. */
export function DiscoveryHeroSkeleton() {
  return (
    <section className="discovery-hero" role="status" aria-busy="true" aria-live="polite" aria-label="Loading highlights" data-testid="discovery-hero-skeleton">
      <div className="discovery-hero-group">
        <div className="discovery-hero-main">
          <SkeletonBlock className="discovery-hero-skeleton__label" />
          <SkeletonBlock className="discovery-hero-skeleton__title" />
          <SkeletonBlock className="discovery-hero-skeleton__figures" />
          <SkeletonBlock className="discovery-hero-skeleton__actions" />
        </div>
        <div className="discovery-hero-chart"><SkeletonBlock className="discovery-hero-skeleton__chart" /></div>
      </div>
    </section>
  );
}

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The top of the Discovery home. It cycles through groups, each in the same look: "Fresh This Week" (what the top artists added in
 * the last seven days) and "Picked for You" (an artist chosen from the user's favorites). A group with nothing to show is left out.
 * The cycle pauses while the pointer or keyboard focus is inside, and does not run at all for people who prefer reduced motion.
 */
export function DiscoveryHero({ feed, forYou, genres, onSelectArtist, onOpenSetlist, pending = false, setlistsPending = false }: DiscoveryHeroProps) {
  const fresh = useMemo(() => buildFreshWeek(feed.artists, feed.setlistsByArtist), [feed.artists, feed.setlistsByArtist]);
  const candidates = useMemo(() => pickCandidates(forYou.shelves, dayNumber()), [forYou.shelves]);
  const [pickIndex, setPickIndex] = useState(0);
  const pick = candidates.length > 0 ? candidates[pickIndex % candidates.length] : null;
  const details = useDiscoveryPick(pick?.artist.id ?? null, genres);

  const groups = useMemo(() => [
    ...(fresh.newSets > 0 ? ['fresh' as const] : []),
    ...(pick ? ['pick' as const] : []),
  ], [fresh.newSets, pick]);

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = groups.length > 0 ? Math.min(active, groups.length - 1) : 0;
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (groups.length < 2 || paused || prefersReducedMotion()) return undefined;
    const timer = window.setTimeout(() => setActive((current + 1) % groups.length), HERO_CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [groups.length, paused, current]);

  // Hold the space while the header's content is undecided. With a pick it is certain, and without one "Fresh this week" may still come.
  if (pending || (!pick && setlistsPending)) return <DiscoveryHeroSkeleton />;
  if (groups.length === 0) return null;
  const group = groups[current];
  const names: Record<(typeof groups)[number], string> = { fresh: 'Fresh This Week', pick: 'Picked for You' };

  const seeWhatsNew = () => document.querySelector('[data-testid="discovery-shelf-fresh"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const surprise = () => {
    if (fresh.sets.length > 0) onOpenSetlist(fresh.sets[Math.floor(Math.random() * fresh.sets.length)].setlist);
  };

  return (
    <section
      ref={rootRef}
      className="discovery-hero"
      aria-label="Highlights"
      data-testid="discovery-hero"
      data-group={group}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => { if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setPaused(false); }}
    >
      {group === 'fresh' && (
        <DiscoveryHeroGroup
          groupId="fresh"
          label="This week on DropDex"
          title="Fresh this week"
          figures={[
            [fresh.newSets.toLocaleString(), fresh.newSets === 1 ? 'New set' : 'New sets'],
            [fresh.artistsWithNewSets.toLocaleString(), fresh.artistsWithNewSets === 1 ? 'Artist with new sets' : 'Artists with new sets'],
            [fresh.trendingGenre?.name ?? '—', fresh.trendingGenre ? `Trending genre · ${fresh.trendingGenre.artists} ${fresh.trendingGenre.artists === 1 ? 'artist' : 'artists'}` : 'Trending genre'],
          ]}
          actions={<>
            <ControlButton variant="primary" onClick={seeWhatsNew}><ArrowRight width={14} height={14} aria-hidden="true" /> See what’s new</ControlButton>
            <ControlButton variant="secondary" onClick={surprise}><Shuffle width={14} height={14} aria-hidden="true" /> Surprise me</ControlButton>
          </>}
          chartTitle="Sets added per day"
          chartLabel="Sets added each day over the last seven days"
          values={fresh.perDay}
          ticks={fresh.dayLabels}
        />
      )}
      {group === 'pick' && pick && (
        <DiscoveryHeroGroup
          groupId="pick"
          label={pick.reason}
          title="Picked for you"
          figures={[
            [pick.artist.name, 'Artist'],
            [details ? details.totalSets.toLocaleString() : '—', 'Sets in the catalog'],
            [details?.topGenre?.name ?? '—', details?.topGenre ? `Top genre · ${details.topGenre.artists} artists` : 'Top genre'],
          ]}
          actions={<>
            <ControlButton
              variant="primary"
              onClick={() => onSelectArtist({ id: pick.artist.id, name: pick.artist.name, normalized_name: pick.artist.normalized_name, matched_alias: null, profile_image_url: pick.artist.profile_image_url })}
            >
              <ArrowRight width={14} height={14} aria-hidden="true" /> Open artist
            </ControlButton>
            {candidates.length > 1 && <ControlButton variant="secondary" onClick={() => setPickIndex((n) => n + 1)}><Refresh width={14} height={14} aria-hidden="true" /> Another pick</ControlButton>}
          </>}
          chartTitle={`${pick.artist.name} sets per year`}
          chartLabel={`Sets by ${pick.artist.name} each year`}
          values={details?.years.values ?? [0, 0, 0, 0, 0, 0]}
          ticks={details?.years.labels ?? ['', '', '', '', '', '']}
        />
      )}

      {groups.length > 1 && (
        <div className="discovery-hero-tabs" role="tablist" aria-label="Highlights">
          {groups.map((id, i) => (
            <button key={id} type="button" role="tab" aria-selected={i === current} aria-label={names[id]} onClick={() => setActive(i)} />
          ))}
        </div>
      )}
    </section>
  );
}
