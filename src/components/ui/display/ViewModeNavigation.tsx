import { cn } from '../../../lib/utils';
import '../dropdex-display.css';
import { focusNavigationPeer, getNextNavigationIndex } from './navigation';
import type { NavigationOption } from './types';

export interface ViewModeNavigationProps {
  value: string;
  options: NavigationOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

export function ViewModeNavigation({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: ViewModeNavigationProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('dd-view-mode-nav', className)}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="dd-view-mode-nav__item"
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const next = getNextNavigationIndex(event.key, index, options.length);
              if (next == null) return;
              event.preventDefault();
              onChange(options[next].id);
              focusNavigationPeer(event, '[role="radio"]', next);
            }}
          >
            <span className="dd-view-mode-nav__icon" aria-hidden="true">{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
