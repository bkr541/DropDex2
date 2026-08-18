import type { InputHTMLAttributes } from 'react';
import { Search } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function SearchControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="dd-control-wrap">
      <Search size={18} className="dd-control-start-icon" aria-hidden="true" />
      <input type="search" className={cn('dd-text-control dd-text-control--with-start-icon', className)} {...props} />
    </div>
  );
}
