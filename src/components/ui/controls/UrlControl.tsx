import type { InputHTMLAttributes } from 'react';
import { Link } from '@carbon/icons-react';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export function UrlControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <TextControl type="url" icon={<Link size={18} />} className={className} {...props} />;
}
