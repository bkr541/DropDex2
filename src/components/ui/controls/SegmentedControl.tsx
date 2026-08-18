import { cn } from '../../../lib/utils';
import '../dropdex-controls.css';

export function SegmentedControl({
  options,
  value,
  onChange,
  tone = 'blue',
  ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  tone?: 'blue' | 'green';
  ariaLabel: string;
}) {
  return (
    <div className={cn('dd-segmented', `dd-segmented--${tone}`)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="dd-segmented__item"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
