import type { InputHTMLAttributes, ReactNode } from 'react';
import { Xmark } from 'iconoir-react/regular';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export function ClearableTextInput({
  value,
  onValueChange,
  clearLabel = 'Clear text',
  icon,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
  icon: ReactNode;
}) {
  return (
    <TextControl
      icon={icon}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      endAdornment={value ? (
        <button type="button" aria-label={clearLabel} className="dd-control-end-action" onClick={() => onValueChange('')}>
          <Xmark aria-hidden="true" width={16} height={16} />
        </button>
      ) : null}
      {...props}
    />
  );
}
