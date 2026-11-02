import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';
import { ControlButton } from './ControlButton';

/** A row of icon-only header buttons with no background, as at the top right of Cue Points. */
export function ToolbarIconGroup({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('cue-workstation__actions flex shrink-0 items-center gap-0.5', className)} {...props}>
      {children}
    </div>
  );
}

export function ToolbarIconButton({
  label, children, className, ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string; children: ReactNode }) {
  return (
    <ControlButton className={cn('cue-action-icon', className)} variant="ghost" aria-label={label} title={props.title ?? label} {...props}>
      {children}
    </ControlButton>
  );
}
