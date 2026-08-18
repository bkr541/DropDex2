import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';
import type { AccentTone } from './types';

export type ControlButtonVariant = 'primary' | 'neutral' | 'surface' | 'secondary' | 'danger' | 'danger-outline' | 'ghost';

export function ControlButton({
  variant = 'surface',
  accent = 'blue',
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ControlButtonVariant; accent?: AccentTone }) {
  return (
    <button
      type={type}
      className={cn('dd-control-button', `dd-control-button--${variant}`, `dd-accent--${accent}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}
