import type { ReactNode } from 'react';
import { HorizontalScroller } from './HorizontalScroller';

interface DiscoveryShelfProps {
  title: string;
  /** A short supporting line at the right of the heading, such as a count. */
  caption?: string;
  /** Optional "See all" style button next to the caption. */
  action?: { label: string; onClick: () => void };
  children: ReactNode;
  testId?: string;
}

/** One Discovery row: a heading, a supporting line, and cards in a single row that scrolls sideways. */
export function DiscoveryShelf({ title, caption, action, children, testId = 'discovery-shelf' }: DiscoveryShelfProps) {
  const heading = title.charAt(0).toUpperCase() + title.slice(1);
  return (
    <section className="discovery-shelf discovery-row" aria-label={heading} data-testid={testId}>
      <div className="discovery-section-head discovery-shelf-heading">
        <h3 className="studio-title">{heading}</h3>
        {(caption || action) && (
          <span className="discovery-section-meta">
            {caption && <span className="discovery-shelf-caption">{caption}</span>}
            {action && <button type="button" className="studio-link" onClick={action.onClick}>{action.label}</button>}
          </span>
        )}
      </div>
      <HorizontalScroller ariaLabel={heading}>{children}</HorizontalScroller>
    </section>
  );
}
