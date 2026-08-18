import type { InputHTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

function inputClass(error?: boolean) {
  return cn('dd-text-control', error && 'dd-text-control--error');
}

export function TextControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return <input className={cn(inputClass(invalid), className)} {...props} />;
}
