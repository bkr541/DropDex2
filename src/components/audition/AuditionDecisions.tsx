import { Check, QuestionMark, Xmark } from 'iconoir-react/regular';
import { ToolbarIconButton, ToolbarRow } from '../ui/controls';

// Keep / Maybe / Remove are shown so the layout is final, but they are not connected to anything yet. They look like the other toolbar
// icons, do nothing when pressed, and say so on hover.
const DECISIONS = [
  { id: 'keep', label: 'Keep', Icon: Check },
  { id: 'maybe', label: 'Maybe', Icon: QuestionMark },
  { id: 'remove', label: 'Remove', Icon: Xmark },
] as const;

/** Keep, Maybe and Remove for the selected track: icon-only, in the shared toolbar row above the timeline. */
export function AuditionDecisions() {
  return (
    <ToolbarRow className="audition-song-toolbar" role="group" aria-label="Track decision" data-testid="audition-song-toolbar">
      {DECISIONS.map(({ id, label, Icon }) => (
        <span key={id} title="Coming soon" className="inline-flex">
          <ToolbarIconButton className={`audition-decision--${id}`} label={`${label} (coming soon)`} title={`${label} (coming soon)`} aria-disabled="true" onClick={(event) => event.preventDefault()} data-label={label} data-testid={`audition-decision-${id}`}>
            <Icon width={20} height={20} aria-hidden="true" />
          </ToolbarIconButton>
        </span>
      ))}
    </ToolbarRow>
  );
}
