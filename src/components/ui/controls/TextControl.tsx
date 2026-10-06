import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

function inputClass(error?: boolean) {
  return cn('dd-text-control dd-text-input', error && 'dd-text-control--error');
}

export interface TextControlProps extends InputHTMLAttributes<HTMLInputElement> {
  icon: ReactNode;
  containerClassName?: string;
  endAdornment?: ReactNode;
}

export const TextControl = forwardRef<HTMLInputElement, TextControlProps>(function TextControl({
  className,
  containerClassName,
  endAdornment,
  icon,
  ...props
}, ref) {
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return (
    <div className={cn('dd-control-wrap', containerClassName)}>
      <span className="dd-control-start-icon" aria-hidden="true">{icon}</span>
      <input ref={ref} className={cn(inputClass(invalid), 'dd-text-control--with-start-icon', className)} {...props} />
      {endAdornment}
    </div>
  );
});
