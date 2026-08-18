import { useId, useMemo, useState } from 'react';
import { Close, Waveform } from '@carbon/icons-react';
import '../dropdex-controls.css';

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
