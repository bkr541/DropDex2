import { Add, Close } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

const CHIP_TONES = ['blue', 'purple', 'teal', 'orange'] as const;

export function ChipMultiSelect({
  values,
  onChange,
  addLabel = 'Add Genre',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  addLabel?: string;
}) {
  return (
    <div className="dd-chip-list" aria-label="Selected genres">
      {values.map((value, index) => (
        <span key={value} className={cn('dd-chip', `dd-chip--${CHIP_TONES[index % CHIP_TONES.length]}`)}>
          {value}
          <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
            <Close size={14} />
          </button>
        </span>
      ))}
      <button type="button" className="dd-chip-add"><Add size={14} /> {addLabel}</button>
    </div>
  );
}
