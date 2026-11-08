import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { FloppyDisk } from 'iconoir-react/regular';
import { ControlButton } from '../../components/ui/controls';
import type { SetLabDraft } from './session';
import { prepareSetLabSnapshot } from './savedSetRestore';
import { createSetLabSavedSet } from './sessionRepository';

export function SetLabSaveSet({ draft, disabled, onSaved }: { draft: SetLabDraft; disabled: boolean; onSaved?: () => void }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const attempt = useRef<{ draft: SetLabDraft; name: string; id: string; snapshot?: SetLabDraft } | null>(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  useEffect(() => () => { request.current?.abort(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (disabled || !trimmed || draft.slots.length !== 5 || inFlight.current) return;
    const current = new AbortController();
    request.current = current;
    if (attempt.current?.draft !== draft || attempt.current.name !== trimmed) {
      attempt.current = { draft, name: trimmed, id: crypto.randomUUID() };
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const saveAttempt = attempt.current;
      saveAttempt.snapshot ??= await prepareSetLabSnapshot(draft, current.signal);
      current.signal.throwIfAborted();
      const saved = await createSetLabSavedSet(saveAttempt.snapshot, trimmed, saveAttempt.id);
      if (current.signal.aborted) return;
      onSaved?.();
      setSavedName(saved.session.name);
      attempt.current = null;
      setName('');
      setOpen(false);
    } catch (error) {
      if (!current.signal.aborted) setError(error instanceof Error ? error.message : 'Could not save the set.');
    } finally {
      if (!current.signal.aborted) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <div className="min-w-0">
      {!open && (
        <div className="flex flex-wrap items-center gap-2">
          <ControlButton variant="neutral" disabled={disabled || draft.slots.length !== 5}
            title={draft.slots.length !== 5 ? 'Generate a complete set before saving' : 'Save a named copy'}
            onClick={() => { setOpen(true); setSavedName(null); }}>
            <FloppyDisk width={16} height={16} aria-hidden="true" /> Save Set
          </ControlButton>
          {savedName && <p role="status" className="break-words text-xs text-muted-foreground">Saved “{savedName}”.</p>}
        </div>
      )}
      {open && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { void save(event); }}>
          <label className="sr-only" htmlFor={inputId}>Set name</label>
          <input id={inputId} autoFocus required value={name} disabled={disabled || saving}
            className="dd-text-control dd-text-input" placeholder="Set name"
            onChange={(event) => setName(event.target.value)} />
          <ControlButton type="submit" variant="primary" disabled={disabled || saving || !name.trim()}>
            {saving ? 'Saving set…' : 'Save named set'}
          </ControlButton>
          <ControlButton variant="ghost" disabled={saving} onClick={() => { setOpen(false); setError(null); }}>Cancel</ControlButton>
          {error && <p role="alert" className="basis-full text-xs text-muted-foreground">{error}</p>}
        </form>
      )}
    </div>
  );
}
