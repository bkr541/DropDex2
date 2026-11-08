import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search } from 'iconoir-react/regular';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export const SearchControl = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  /** @deprecated Search controls now always use the canonical Cue Points underline style. */
  underline?: boolean;
}>(function SearchControl({ className, icon, id, underline: _underline, ...props }, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return <div className="dd-search-control flex min-w-0 flex-col justify-between">
    <label htmlFor={inputId} className="dd-search-control__label mb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Search</label>
    <TextControl ref={ref} id={inputId} type="search" icon={icon ?? <Search aria-hidden="true" width={18} height={18} />} className={className} {...props} />
  </div>;
});
