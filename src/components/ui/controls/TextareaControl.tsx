import type { ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function TextareaControl({ className, containerClassName, icon, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  icon: ReactNode;
  containerClassName?: string;
}) {
  return (
    <div className={cn('dd-control-wrap dd-control-wrap--textarea', containerClassName)}>
      <span className="dd-control-start-icon" aria-hidden="true">{icon}</span>
      <textarea className={cn('dd-text-control dd-text-input dd-text-control--with-start-icon dd-textarea-control', className)} {...props} />
    </div>
  );
}
