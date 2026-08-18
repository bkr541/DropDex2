import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';
import { SkeletonBlock } from './SkeletonBlock';

export function SkeletonChip({ wide = false }: { wide?: boolean }) {
  return <span className={cn('dd-skeleton-chip', wide && 'dd-skeleton-chip--wide')} role="status" aria-busy="true" aria-label="Loading chip"><SkeletonBlock /></span>;
}
