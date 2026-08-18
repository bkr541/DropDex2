import { Close } from '@carbon/icons-react';
import '../dropdex-feedback.css';
import { CircularProgress } from './CircularProgress';

export interface ProgressMetric {
  label: string;
  value: string | number;
}

export function ProgressStatusPanel({
  title,
  value,
  metrics,
  remaining,
  onCancel,
}: {
  title: string;
  value: number;
  metrics: ProgressMetric[];
  remaining?: string;
  onCancel?: () => void;
}) {
  return (
    <section className="dd-progress-panel" aria-label={title}>
      <header><strong>{title}</strong><Close size={14} aria-hidden="true" /></header>
      <div className="dd-progress-panel__body">
        <CircularProgress value={value} size={104} strokeWidth={7} tone="purple" label={`${title} progress`} />
        <dl>
          {metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
          {remaining && <div><dt>Estimated Time Remaining</dt><dd>{remaining}</dd></div>}
        </dl>
      </div>
      {onCancel && <footer><button type="button" className="dd-feedback-button dd-feedback-button--ghost" onClick={onCancel}>CANCEL</button></footer>}
    </section>
  );
}
