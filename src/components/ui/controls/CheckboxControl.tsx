import { Checkmark, Subtract } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';

/** A square checkbox in the app's style. `indeterminate` shows a dash, for "some of them are selected". */
export function CheckboxControl({
  checked, indeterminate = false, onChange, disabled = false, className, ...aria
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'border-primary bg-primary text-[var(--color-background)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:border-primary/60',
        className,
      )}
      {...aria}
    >
      {indeterminate ? <Subtract size={14} aria-hidden="true" /> : checked ? <Checkmark size={14} aria-hidden="true" /> : null}
    </button>
  );
}
