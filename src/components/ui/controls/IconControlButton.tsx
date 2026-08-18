import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';
import type { AccentTone } from './types';

export function IconControlButton({
  label,
  tone = 'blue',
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: AccentTone; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('dd-icon-button', `dd-icon-button--${tone}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}
