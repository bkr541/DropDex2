import { cn } from '../../../lib/utils';
import './page-skeleton.css';
import { SkeletonBlock } from './SkeletonBlock';
import { SkeletonRow } from './SkeletonRow';

export type PageSkeletonVariant = 'home' | 'listing' | 'cards' | 'feed' | 'workspace';

const rows = (count: number) => Array.from({ length: count }, (_, index) => <SkeletonRow key={index} />);

/**
 * What a page looks like before its content arrives: grey blocks in the same places as the real page's header, tab row, filters and
 * rows, at the same sizes. The page keeps its shape while it loads, so nothing moves when the content appears.
 */
export function PageSkeleton({ variant = 'listing', label = 'Loading', className }: { variant?: PageSkeletonVariant; label?: string; className?: string }) {
  return (
    <div className={cn('dd-page-skeleton', `dd-page-skeleton--${variant}`, className)} role="status" aria-busy="true" aria-live="polite" aria-label={label} data-testid="page-skeleton">
      {variant === 'home' && (
        <>
          <SkeletonBlock className="dd-page-skeleton__hero" />
          <div className="dd-page-skeleton__tabs">{[96, 80, 110, 88].map((w) => <SkeletonBlock key={w} className="dd-page-skeleton__tab" />)}</div>
          <div className="dd-page-skeleton__grid">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__tile" />)}</div>
        </>
      )}
      {variant === 'listing' && (
        <>
          <div className="dd-page-skeleton__header">
            <SkeletonBlock className="dd-page-skeleton__cover" />
            <div className="dd-page-skeleton__lines"><SkeletonBlock className="dd-page-skeleton__title" /><SkeletonBlock className="dd-page-skeleton__subtitle" /></div>
            <div className="dd-page-skeleton__figures">{Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__figure" />)}</div>
          </div>
          <SkeletonBlock className="dd-page-skeleton__timeline" />
          <div className="dd-page-skeleton__tabs">{[96, 96].map((w, i) => <SkeletonBlock key={i} className="dd-page-skeleton__tab" />)}</div>
          <div className="dd-page-skeleton__filters">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__filter" />)}</div>
          <div className="dd-page-skeleton__rows">{rows(9)}</div>
        </>
      )}
      {variant === 'cards' && (
        <>
          <SkeletonBlock className="dd-page-skeleton__hero" />
          <SkeletonBlock className="dd-page-skeleton__section-title" />
          <div className="dd-page-skeleton__cards">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__card" />)}</div>
          <SkeletonBlock className="dd-page-skeleton__section-title" />
          <div className="dd-page-skeleton__cards">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__card" />)}</div>
        </>
      )}
      {variant === 'feed' && (
        <>
          <SkeletonBlock className="dd-page-skeleton__section-title" />
          <div className="dd-page-skeleton__cards">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__card" />)}</div>
          <SkeletonBlock className="dd-page-skeleton__section-title" />
          <div className="dd-page-skeleton__cards">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__card" />)}</div>
        </>
      )}
      {variant === 'workspace' && (
        <>
          <div className="dd-page-skeleton__header">
            <SkeletonBlock className="dd-page-skeleton__cover" />
            <div className="dd-page-skeleton__lines"><SkeletonBlock className="dd-page-skeleton__title" /><SkeletonBlock className="dd-page-skeleton__subtitle" /></div>
          </div>
          <div className="dd-page-skeleton__panels"><SkeletonBlock className="dd-page-skeleton__panel" /><SkeletonBlock className="dd-page-skeleton__panel" /></div>
          <div className="dd-page-skeleton__rows">{rows(4)}</div>
        </>
      )}
    </div>
  );
}

/** Placeholder rows for a track listing that is still loading, the height of the rows it will show. */
export function ListingSkeleton({ count = 10, label = 'Loading tracks' }: { count?: number; label?: string }) {
  return (
    <div className="dd-page-skeleton__rows" role="status" aria-busy="true" aria-live="polite" aria-label={label} data-testid="listing-skeleton">
      {rows(count)}
    </div>
  );
}

/** The selected track's header, toolbar and timeline before they load: the same height as the real panel, so the list below does not move. */
export function TrackPanelSkeleton({ label = 'Loading track', extraHeight = 0 }: { label?: string; /** Space for a row the real panel has below its timeline, such as Audition's track navigation. */ extraHeight?: number }) {
  return (
    <div className="dd-track-panel-skeleton" style={extraHeight > 0 ? { paddingBottom: 12 + extraHeight } : undefined} role="status" aria-busy="true" aria-live="polite" aria-label={label} data-testid="track-panel-skeleton">
      <div className="dd-page-skeleton__header">
        <SkeletonBlock className="dd-page-skeleton__cover" />
        <div className="dd-page-skeleton__lines"><SkeletonBlock className="dd-page-skeleton__title" /><SkeletonBlock className="dd-page-skeleton__subtitle" /></div>
        <div className="dd-page-skeleton__figures">{Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} className="dd-page-skeleton__figure" />)}</div>
      </div>
      <SkeletonBlock className="dd-track-panel-skeleton__band" />
      <SkeletonBlock className="dd-track-panel-skeleton__timeline" />
    </div>
  );
}

/** One Discovery-style row before it loads: its heading and a row of cards, the height the real row will be. */
export function ShelfSkeleton({ label = 'Loading', count = 6 }: { label?: string; count?: number }) {
  return (
    <section className="dd-shelf-skeleton" role="status" aria-busy="true" aria-live="polite" aria-label={label} data-testid="shelf-skeleton">
      <SkeletonBlock className="dd-shelf-skeleton__title" />
      <div className="dd-shelf-skeleton__cards">{Array.from({ length: count }, (_, i) => <SkeletonBlock key={i} className="dd-shelf-skeleton__card" />)}</div>
    </section>
  );
}
