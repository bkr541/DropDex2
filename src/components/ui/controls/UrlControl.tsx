import type { InputHTMLAttributes } from 'react';
import { Link } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function UrlControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="dd-control-wrap">
      <Link size={18} className="dd-control-start-icon" aria-hidden="true" />
      <input type="url" className={cn('dd-text-control dd-text-control--with-start-icon', className)} {...props} />
    </div>
  );
}
