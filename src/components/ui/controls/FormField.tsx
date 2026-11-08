import { useId, type ReactNode } from 'react';
import { WarningTriangle } from 'iconoir-react/regular';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function FormField({
  label,
  required,
  helperText,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  helperText?: string;
  error?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = helperText || error ? `${id}-description` : undefined;
  return (
    <div className="dd-form-field">
      <label htmlFor={id} className="dd-form-field__label">
        {label}{required && <span aria-hidden="true" className="dd-form-field__required"> *</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {(error || helperText) && (
        <p id={describedBy} className={cn('dd-form-field__message', error && 'dd-form-field__message--error')}>
          {error && <WarningTriangle width={15} height={15} aria-hidden="true" />}
          {error ?? helperText}
        </p>
      )}
    </div>
  );
}
