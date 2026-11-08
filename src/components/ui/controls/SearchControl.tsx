import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search } from 'iconoir-react/regular';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export const SearchControl = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  /** @deprecated Search controls now always use the canonical Cue Points underline style. */
  underline?: boolean;
}>(function SearchControl({ className, icon, underline: _underline, ...props }, ref) {
  return <TextControl ref={ref} type="search" icon={icon ?? <Search aria-hidden="true" width={18} height={18} />} className={className} {...props} />;
});
