import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-media.css';

export type TransportButtonTone = 'neutral' | 'play' | 'stop' | 'mute';
export type TransportButtonSize = 'compact' | 'standard' | 'hero';

export interface TransportButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  tone?: TransportButtonTone;
  size?: TransportButtonSize;
  active?: boolean;
  children: ReactNode;
}

export function TransportButton({
  label,
  tone = 'neutral',
  size = 'standard',
  active = false,
  className,
  type = 'button',
  children,
  ...props
}: TransportButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'dd-media-button',
        `dd-media-button--${tone}`,
        `dd-media-button--${size}`,
        className,
      )}
      {...props}
    >
      <span className="dd-media-button__bezel" aria-hidden="true" />
      <span className="dd-media-button__content">{children}</span>
    </button>
  );
}
