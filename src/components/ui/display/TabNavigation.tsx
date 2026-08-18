import { cn } from '../../../lib/utils';
import '../dropdex-display.css';
import { focusNavigationPeer, getNextNavigationIndex } from './navigation';
import type { NavigationOption } from './types';

export interface TabNavigationProps {
  value: string;
  options: NavigationOption[];
  onChange: (value: string) => void;
  variant?: 'primary' | 'filter';
  ariaLabel: string;
  className?: string;
}

export function TabNavigation({
  value,
  options,
  onChange,
  variant = 'primary',
  ariaLabel,
  className,
}: TabNavigationProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('dd-tab-nav', `dd-tab-nav--${variant}`, className)}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="dd-tab-nav__item"
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const next = getNextNavigationIndex(event.key, index, options.length);
              if (next == null) return;
              event.preventDefault();
              onChange(options[next].id);
              focusNavigationPeer(event, '[role="tab"]', next);
            }}
          >
            {option.icon && <span aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
