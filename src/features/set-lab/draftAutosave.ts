import { parseSetLabSession, type SetLabDraft, type SetLabScope } from './session';
import { SetLabRevisionConflict, type StoredSetLabSession } from './sessionRepository';

export type SetLabSaveStatus =
  | { kind: 'idle' | 'pending' | 'saved' | 'conflict' }
  | { kind: 'error'; message: string };

interface PendingDraft {
  revision: number;
  draft: SetLabDraft;
  inFlight?: SetLabDraft;
}

export type SetLabRecoveryChoice = 'local' | 'server';

const keyFor = ({ userId, sourceImportId }: SetLabScope) =>
  `dropdex:set-lab:pending:${encodeURIComponent(userId)}:${encodeURIComponent(sourceImportId)}`;

const failureMessage = (error: unknown) => error instanceof Error ? error.message : 'Set Lab storage failed.';
const sameDraft = (a: SetLabDraft, b: SetLabDraft) => JSON.stringify(a) === JSON.stringify(b);

export function openSetLabAutosave({
  scope, confirmed, storage, save, onStatus, delay = 350,
}: {
  scope: SetLabScope;
  confirmed: StoredSetLabSession<SetLabDraft> | null;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  save: (draft: SetLabDraft, revision: number) => Promise<StoredSetLabSession<SetLabDraft>>;
  onStatus: (status: SetLabSaveStatus) => void;
  delay?: number;
}) {
  const key = keyFor(scope);
  let revision = confirmed?.revision ?? 0;
  let journal: string | null = null;
  let pending: SetLabDraft | null = null;
  let sent: SetLabDraft | undefined;
  let recovered: SetLabDraft | null = null;
  let conflict: SetLabDraft | null = null;
  let running = false;
  let closed = false;
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function report(status: SetLabSaveStatus) {
    if (!closed) onStatus(status);
  }

  // Acknowledging one write must never clear another window's local work.
  function updateJournal(entry: PendingDraft | null, requireMatch = entry !== null) {
    const next = entry ? JSON.stringify(entry) : null;
    if (storage.getItem(key) !== journal) {
      if (!requireMatch) return;
      blocked = true;
      throw new Error('Another window has pending Set Lab changes for this library. Retry draft save.');
    }
    if (next === null) storage.removeItem(key);
    else storage.setItem(key, next);
    journal = next;
  }

  function checkedDraft(value: unknown): SetLabDraft {
    const draft = parseSetLabSession(value, scope);
    if (draft.status !== 'draft') throw new Error('Only Set Lab drafts can be autosaved.');
    return draft;
  }

  try {
    journal = storage.getItem(key);
    if (journal !== null) {
      const entry = JSON.parse(journal) as PendingDraft;
      const draft = checkedDraft(entry.draft);
      const predecessor = entry.inFlight === undefined ? undefined : checkedDraft(entry.inFlight);
      if (!Number.isSafeInteger(entry.revision) || entry.revision < 0) throw new Error('Invalid Set Lab recovery data.');

      const serverDraft = confirmed ? checkedDraft(confirmed.session) : null;
      if (serverDraft && sameDraft(draft, serverDraft)) {
        updateJournal(null);
      } else if (entry.revision === revision) {
        recovered = pending = draft;
        sent = predecessor;
      } else if (serverDraft && predecessor && revision === entry.revision + 1 && sameDraft(predecessor, serverDraft)) {
        // The browser closed after the server accepted an older write. The
        // journal proves its successor was based on that same local edit.
        recovered = pending = draft;
      } else {
        blocked = true;
        conflict = draft;
        report({ kind: 'conflict' });
      }
    }
  } catch (error) {
    blocked = true;
    report({ kind: 'error', message: failureMessage(error) });
  }

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (blocked || running || !pending) return;

    const draft = sent ?? pending;
    running = true;
    let success = false;
    try {
      // Record the exact predecessor before starting a write, so both a lost
      // response and a restart can recover changes queued behind it.
      updateJournal({ draft: pending, revision, inFlight: draft });
      sent = draft;
      const saved = await save(draft, revision);
      revision = saved.revision;
      sent = undefined;
      if (pending && sameDraft(pending, draft)) pending = null;
      updateJournal(pending ? { draft: pending, revision } : null);
      success = true;
      report({ kind: pending ? 'pending' : 'saved' });
    } catch (error) {
      if (error instanceof SetLabRevisionConflict) blocked = true;
      report({ kind: 'error', message: failureMessage(error) });
    } finally {
      running = false;
    }
    if (success && pending) await flush();
  }

  function schedule() {
    report({ kind: 'pending' });
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, delay);
  }

  if (pending) schedule();
  return {
    recovered,
    get blocked() { return blocked; },
    resolveConflict(choice: SetLabRecoveryChoice): SetLabDraft | null {
      if (closed || !conflict) return null;
      const draft = choice === 'local' ? conflict : null;
      updateJournal(draft ? { draft, revision } : null, true);
      conflict = null;
      blocked = false;
      pending = draft;
      if (draft) schedule();
      else report({ kind: 'idle' });
      return draft;
    },
    enqueue(draft: SetLabDraft) {
      if (closed || blocked) throw new Error('Set Lab autosave is unavailable. Resolve the draft save issue first.');
      const checked = checkedDraft(draft);
      updateJournal({ draft: checked, revision, inFlight: sent });
      pending = checked;
      schedule();
    },
    flush,
    close() {
      closed = true;
      void flush();
    },
  };
}
