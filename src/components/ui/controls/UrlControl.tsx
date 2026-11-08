import type { InputHTMLAttributes } from 'react';
import { Link } from 'iconoir-react/regular';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export function UrlControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <TextControl type="url" icon={<Link aria-hidden="true" width={18} height={18} />} className={className} {...props} />;
}
