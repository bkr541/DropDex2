import type { InputHTMLAttributes } from 'react';
import { Close } from '@carbon/icons-react';
import '../dropdex-controls.css';
import { TextControl } from './TextControl';

export function ClearableTextInput({
  value,
  onValueChange,
  clearLabel = 'Clear text',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
}) {
  return (
    <div className="dd-control-wrap">
      <TextControl value={value} onChange={(event) => onValueChange(event.target.value)} {...props} />
      {value && (
        <button type="button" aria-label={clearLabel} className="dd-control-end-action" onClick={() => onValueChange('')}>
          <Close size={16} />
        </button>
      )}
    </div>
  );
}
