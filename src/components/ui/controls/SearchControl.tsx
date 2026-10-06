import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Search } from '@carbon/icons-react';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export const SearchControl = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  /** @deprecated Search controls now always use the canonical Cue Points underline style. */
  underline?: boolean;
}>(function SearchControl({ className, icon, underline: _underline, ...props }, ref) {
  return <TextControl ref={ref} type="search" icon={icon ?? <Search size={18} />} className={className} {...props} />;
});
