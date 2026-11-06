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
  return (
    <section className="discovery-shelf discovery-row" aria-label={title} data-testid={testId}>
      <div className="discovery-section-head">
        <h3 className="studio-title">{title}</h3>
        <span className="discovery-section-meta">
          {caption && <span className="studio-label">{caption}</span>}
          {action && <button type="button" className="studio-link" onClick={action.onClick}>{action.label}</button>}
        </span>
      </div>
      <HorizontalScroller ariaLabel={title}>{children}</HorizontalScroller>
    </section>
  );
}
