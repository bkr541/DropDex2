import type { KeyboardEvent } from 'react';
import { DatabaseExport, FloppyDisk, Refresh, Undo } from 'iconoir-react/regular';

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** The Cue Points Save / Apply / Discard menu. The screen and Layout Lab render this same component. */
export function CueApplyMenu({
  onKeyDown, saving, saveDisabled, saveTitle, applyTrackDisabled, applyTrackTitle, applyAllDisabled, applyAllCount, applyAllTitle, discardDisabled,
  onSave, onApplyTrack, onApplyAll, onDiscard,
}: {
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  saving: boolean;
  saveDisabled: boolean;
  saveTitle: string;
  applyTrackDisabled: boolean;
  applyTrackTitle: string;
  applyAllDisabled: boolean;
  applyAllCount: number;
  applyAllTitle: string;
  discardDisabled: boolean;
  onSave: () => void;
  onApplyTrack: () => void;
  onApplyAll: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Cue draft and Apply actions"
      onKeyDown={onKeyDown}
      className="absolute right-0 top-[calc(100%+6px)] z-[90] min-w-[220px] overflow-hidden dd-popup-surface p-1.5"
    >
      <button type="button" role="menuitem" disabled={saveDisabled} title={saveTitle} className={`${ITEM} text-foreground hover:bg-white/[0.06]`} onClick={onSave}>
        {saving ? <Refresh width={15} height={15} aria-hidden="true" className="animate-spin" /> : <FloppyDisk width={15} height={15} aria-hidden="true" />}
        <span>Save Draft</span>
      </button>
      <button type="button" role="menuitem" disabled={applyTrackDisabled} title={applyTrackTitle} className={`${ITEM} text-foreground hover:bg-white/[0.06]`} onClick={onApplyTrack}>
        <DatabaseExport width={15} height={15} aria-hidden="true" />
        <span>Apply Track</span>
      </button>
      <button type="button" role="menuitem" disabled={applyAllDisabled} title={applyAllTitle} className={`${ITEM} text-foreground hover:bg-white/[0.06]`} onClick={onApplyAll}>
        <DatabaseExport width={15} height={15} aria-hidden="true" />
        <span>Apply All ({applyAllCount})</span>
      </button>
      <div className="my-1 border-t border-white/[0.07]" />
      <button type="button" role="menuitem" disabled={discardDisabled} title="Discard unsaved cue changes and restore the saved/imported baseline" className={`${ITEM} text-amber-100 hover:bg-amber-300/[0.06]`} onClick={onDiscard}>
        <Undo width={15} height={15} aria-hidden="true" />
        <span>Discard Changes</span>
      </button>
    </div>
  );
}
