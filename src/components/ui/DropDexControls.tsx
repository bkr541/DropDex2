import {
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/utils';
import './dropdex-controls.css';
import { Add, ChevronDown, ChevronLeft, ChevronRight, Close, Link, Search, Settings, WarningAlt, Waveform } from '@carbon/icons-react';

export type ControlButtonVariant = 'primary' | 'surface' | 'secondary' | 'danger' | 'danger-outline' | 'ghost';
export type AccentTone = 'blue' | 'orange' | 'purple' | 'green' | 'red';

export function ControlButton({
  variant = 'surface',
  accent = 'blue',
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ControlButtonVariant; accent?: AccentTone }) {
  return (
    <button
      type={type}
      className={cn('dd-control-button', `dd-control-button--${variant}`, `dd-accent--${accent}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconControlButton({
  label,
  tone = 'blue',
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: AccentTone; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('dd-icon-button', `dd-icon-button--${tone}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}

export interface ActionRowItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export function ActionRow({
  items,
  value,
  onChange,
  ariaLabel = 'View mode',
}: {
  items: ActionRowItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="dd-action-row" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
          className="dd-action-row__item"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function BreadcrumbControl({
  items,
  onBack,
}: {
  items: string[];
  onBack?: () => void;
}) {
  return (
    <nav className="dd-breadcrumb" aria-label="Breadcrumb">
      <button type="button" onClick={onBack} aria-label="Go back" className="dd-breadcrumb__back">
        <ChevronLeft size={18} />
      </button>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="dd-breadcrumb__part">
          {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
          <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item}</span>
        </span>
      ))}
    </nav>
  );
}

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

export function SettingsRow() {
  return (
    <div className="dd-settings-row" role="group" aria-label="Track display settings">
      {['BPM', 'KEY', 'GRID'].map((label) => (
        <button type="button" key={label} className="dd-settings-row__button">
          <span>{label}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      ))}
      <IconControlButton label="Open settings" tone="blue" className="dd-settings-row__settings">
        <Settings size={19} />
      </IconControlButton>
    </div>
  );
}

function inputClass(error?: boolean) {
  return cn('dd-text-control', error && 'dd-text-control--error');
}

export function TextControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return <input className={cn(inputClass(invalid), className)} {...props} />;
}

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

export function SearchControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="dd-control-wrap">
      <Search size={18} className="dd-control-start-icon" aria-hidden="true" />
      <input type="search" className={cn('dd-text-control dd-text-control--with-start-icon', className)} {...props} />
    </div>
  );
}

export function TextareaControl({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('dd-text-control dd-textarea-control', className)} {...props} />;
}

export function UrlControl({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="dd-control-wrap">
      <Link size={18} className="dd-control-start-icon" aria-hidden="true" />
      <input type="url" className={cn('dd-text-control dd-text-control--with-start-icon', className)} {...props} />
    </div>
  );
}

export function SelectControl({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="dd-control-wrap">
      <select className={cn('dd-text-control dd-select-control', className)} {...props}>{children}</select>
      <ChevronDown size={17} className="dd-control-end-icon" aria-hidden="true" />
    </div>
  );
}

export interface AutocompleteOption {
  value: string;
  label: string;
}

export function AutocompleteControl({
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  options: AutocompleteOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, value]);

  const commit = (option: AutocompleteOption | undefined) => {
    if (!option) return;
    onChange(option.label);
    setOpen(false);
  };

  return (
    <div className="dd-autocomplete">
      <div className="dd-control-wrap">
        <Waveform size={18} className="dd-control-start-icon dd-control-start-icon--active" aria-hidden="true" />
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[activeIndex] ? `${id}-${activeIndex}` : undefined}
          value={value}
          placeholder={placeholder}
          className="dd-text-control dd-text-control--with-start-icon dd-text-control--focus-demo"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              commit(filtered[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {value && (
          <button type="button" aria-label="Clear autocomplete" className="dd-control-end-action" onClick={() => { onChange(''); setOpen(true); }}>
            <Close size={16} />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div id={`${id}-listbox`} role="listbox" className="dd-autocomplete__list">
          {filtered.map((option, index) => (
            <button
              type="button"
              id={`${id}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              key={option.value}
              className="dd-autocomplete__option"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(option)}
            >
              <Waveform size={16} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

export function NumberControl({
  value,
  onChange,
  label = 'BPM',
  min,
  max,
}: {
  value: number | '';
  onChange: (value: number | '') => void;
  label?: string;
  min?: number;
  max?: number;
}) {
  const clamp = (next: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
  const step = (delta: number) => onChange(clamp((value === '' ? 0 : value) + delta));
  return (
    <div className="dd-number-control">
      <div className="dd-control-wrap dd-number-control__input-wrap">
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          value={value}
          className="dd-text-control dd-number-control__input"
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
        <div className="dd-number-control__steppers">
          <button type="button" aria-label={`Increase ${label}`} onClick={() => step(1)}>⌃</button>
          <button type="button" aria-label={`Decrease ${label}`} onClick={() => step(-1)}>⌄</button>
        </div>
      </div>
      <span className="dd-number-control__unit">{label}</span>
    </div>
  );
}

export function RangeControl({
  value,
  onChange,
  min = 0,
  max = 200,
  label = 'Range value',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="dd-range-control">
      <span className="dd-range-control__bound">{min}</span>
      <div className="dd-range-control__rail">
        <output className="dd-range-control__value" style={{ left: `${percent}%` }}>{value}</output>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ '--dd-range-progress': `${percent}%` } as CSSProperties}
        />
      </div>
      <span className="dd-range-control__bound">{max}</span>
    </div>
  );
}

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
          {error && <WarningAlt size={15} aria-hidden="true" />}
          {error ?? helperText}
        </p>
      )}
    </div>
  );
}
