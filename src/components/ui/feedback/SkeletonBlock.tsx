import { cn } from '../../../lib/utils';
import '../dropdex-feedback.css';

export function SkeletonBlock({ className }: { className?: string }) {
  return <span className={cn('dd-skeleton', className)} aria-hidden="true" />;
}
