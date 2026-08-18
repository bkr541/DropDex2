import type { ReactNode } from 'react';
import '../dropdex-controls.css';

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
