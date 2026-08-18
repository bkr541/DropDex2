import '../dropdex-feedback.css';
import { SkeletonBlock } from './SkeletonBlock';

export function SkeletonCard() {
  return <div className="dd-skeleton-card" role="status" aria-busy="true" aria-label="Loading card"><SkeletonBlock className="dd-skeleton-card__image" /><SkeletonBlock /><SkeletonBlock className="dd-skeleton-card__short" /><div><SkeletonBlock className="dd-skeleton-card__chip" /><SkeletonBlock className="dd-skeleton-card__dot" /></div></div>;
}
