import { Checkmark, Close, Renew } from '@carbon/icons-react';
import { cn } from '../../lib/utils';

// Keep / Maybe / Remove are shown so the layout is final, but they are not
// connected to anything yet. They stay disabled and say so on hover.
const DECISIONS = [
  { id: 'keep', label: 'Keep', Icon: Checkmark },
  { id: 'maybe', label: 'Maybe', Icon: Renew },
  { id: 'remove', label: 'Remove', Icon: Close },
] as const;

/** Keep, Maybe and Remove for the selected track. Sits at the end of the transport row, after the volume slider. */
export function AuditionDecisions() {
  return (
    <div className="audition-decisions" role="group" aria-label="Track decision">
      {DECISIONS.map(({ id, label, Icon }) => (
        <span key={id} title="Coming soon">
          <button type="button" disabled aria-label={`${label} (coming soon)`} data-testid={`audition-decision-${id}`} className={cn('audition-decision', `audition-decision--${id}`)}><Icon size={14} />{label}</button>
        </span>
      ))}
    </div>
  );
}
