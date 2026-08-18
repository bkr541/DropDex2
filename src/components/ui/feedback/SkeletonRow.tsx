import '../dropdex-feedback.css';
import { SkeletonBlock } from './SkeletonBlock';

export function SkeletonRow() {
  return <div className="dd-skeleton-row" role="status" aria-busy="true" aria-label="Loading row"><SkeletonBlock className="dd-skeleton-row__lead" /><div><SkeletonBlock /><SkeletonBlock /></div><SkeletonBlock className="dd-skeleton-row__mini" /><SkeletonBlock className="dd-skeleton-row__mini" /><SkeletonBlock className="dd-skeleton-row__tail" /></div>;
}
