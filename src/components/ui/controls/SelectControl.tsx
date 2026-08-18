import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function SelectControl({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="dd-control-wrap">
      <select className={cn('dd-text-control dd-select-control', className)} {...props}>{children}</select>
      <ChevronDown size={17} className="dd-control-end-icon" aria-hidden="true" />
    </div>
  );
}
