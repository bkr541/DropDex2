import type { SelectHTMLAttributes } from 'react';
import { NavArrowDown } from 'iconoir-react/regular';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function SelectControl({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="dd-control-wrap">
      <select className={cn('dd-text-control dd-select-control', className)} {...props}>{children}</select>
      <NavArrowDown width={17} height={17} className="dd-control-end-icon" aria-hidden="true" />
    </div>
  );
}
