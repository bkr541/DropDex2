import type { HTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-media.css';

/** The full-width audio dock band: faint top and bottom borders and a subtle raised fill. */
export function AudioDock({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="region" className={cn('cue-audio-dock flex min-w-0 flex-1 gap-2 px-2.5 py-2', className)} {...props}>
      {children}
    </div>
  );
}
