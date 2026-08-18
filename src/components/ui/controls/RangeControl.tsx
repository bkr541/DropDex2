import type { CSSProperties } from 'react';
import '../dropdex-controls.css';

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
