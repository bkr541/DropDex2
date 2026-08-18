import { cn } from '../../../lib/utils';
import '../dropdex-display.css';

export type DividerVariant = 'solid' | 'dotted' | 'dashed' | 'accent';

export function Divider({
  variant = 'solid',
  className,
}: {
  variant?: DividerVariant;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn('dd-divider', `dd-divider--${variant}`, className)}
    />
  );
}
