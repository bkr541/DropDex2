import '../dropdex-controls.css';

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
