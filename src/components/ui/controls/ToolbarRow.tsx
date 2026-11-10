import type { HTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import { ToolbarIconGroup } from './ToolbarIconButton';
import './toolbar-row.css';

/**
 * The one icon toolbar row: a full-width band, 16px side padding and a hairline, with its icon buttons right-justified. Put
 * ToolbarIconButtons (or other toolbar controls) inside. Cue Points and Audition both use it, so the two always match.
 */
export function ToolbarRow({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('toolbar-row cue-workstation__toolbar', className)} {...props}>
      <ToolbarIconGroup>{children}</ToolbarIconGroup>
    </div>
  );
}
