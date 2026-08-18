import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function TextareaControl({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('dd-text-control dd-textarea-control', className)} {...props} />;
}
