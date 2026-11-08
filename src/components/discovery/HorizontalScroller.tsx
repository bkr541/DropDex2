import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavArrowLeft, NavArrowRight } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';

interface HorizontalScrollerProps {
  children: ReactNode;
  ariaLabel: string;
  /** `band` fades the edges into a flat strip (the genre row); `shelf` floats round arrows over cards. */
  variant?: 'band' | 'shelf';
  /** Turn the mouse wheel (up and down) into sideways scrolling. Only for a row that is not inside a scrolling page. */
  wheel?: boolean;
  /** When this changes, the element matching `revealSelector` is scrolled into view. */
  revealKey?: unknown;
  revealSelector?: string;
  className?: string;
  testId?: string;
}

/** How far one arrow press moves the row. */
const SCROLL_STEP = 360;

/**
 * One row that scrolls sideways. Arrows appear at an edge only when more is hidden there; trackpad swipes,
 * shift + wheel and (with `wheel`) the plain mouse wheel all work.
 */
export function HorizontalScroller({
  children, ariaLabel, variant = 'shelf', wheel = false, revealKey, revealSelector, className, testId,
}: HorizontalScrollerProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateEdges = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setCanScrollLeft(row.scrollLeft > 1);
    setCanScrollRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    updateEdges();
    const onWheel = (event: WheelEvent) => {
      if (!wheel || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    row.addEventListener('scroll', updateEdges, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges);
    observer?.observe(row);
    return () => {
      row.removeEventListener('wheel', onWheel);
      row.removeEventListener('scroll', updateEdges);
      observer?.disconnect();
    };
  }, [wheel, updateEdges]);

  // The content can change size (cards load in), which moves the edges.
  useEffect(() => { updateEdges(); });

  useEffect(() => {
    if (revealKey == null || !revealSelector) return;
    rowRef.current?.querySelector(revealSelector)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [revealKey, revealSelector]);

  const scrollBy = (distance: number) => rowRef.current?.scrollBy({ left: distance, behavior: 'smooth' });

  return (
    <div className={cn('discovery-scroller', `discovery-scroller--${variant}`, className)} data-testid={testId}>
      {canScrollLeft && (
        <button type="button" className="discovery-scroll-arrow discovery-scroll-arrow--left" aria-label="Scroll left" onClick={() => scrollBy(-SCROLL_STEP)}>
          <NavArrowLeft width={16} height={16} aria-hidden="true" />
        </button>
      )}
      <div ref={rowRef} className="discovery-scroller-row" role="group" aria-label={ariaLabel}>
        {children}
      </div>
      {canScrollRight && (
        <button type="button" className="discovery-scroll-arrow discovery-scroll-arrow--right" aria-label="Scroll right" onClick={() => scrollBy(SCROLL_STEP)}>
          <NavArrowRight width={16} height={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
