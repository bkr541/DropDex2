import { describe, expect, it, vi } from 'vitest';
import { openSetLabAutosave } from './draftAutosave';
import { createSetLabDraft, type SetLabDraft } from './session';
import { populatedDraft, scope } from './session.testFixtures';

function journal() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
}
const draft = populatedDraft();
const empty = createSetLabDraft(scope);
const ack = (session: SetLabDraft, revision: number) => ({ id: 'draft-1', session, revision });

describe('Set Lab draft autosave', () => {
  it('debounces changes and writes only the latest snapshot', async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1));
      const onStatus = vi.fn();
      const writer = openSetLabAutosave({ scope, confirmed: null, storage: journal(), save, onStatus, delay: 100 });
      writer.enqueue(empty);
      await vi.advanceTimersByTimeAsync(75);
      writer.enqueue(draft);
      await vi.advanceTimersByTimeAsync(75);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(25);
      expect(save.mock.calls).toEqual([[draft, 0]]);
      expect(onStatus).toHaveBeenLastCalledWith({ kind: 'saved' });
      writer.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes writes and uses the confirmed revision for changes made during a write', async () => {
    let finish!: (row: ReturnType<typeof ack>) => void;
    const first = new Promise<ReturnType<typeof ack>>((resolve) => { finish = resolve; });
    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1))
      .mockReturnValueOnce(first);
    const writer = openSetLabAutosave({ scope, confirmed: null, storage: journal(), save, onStatus: vi.fn() });
    writer.enqueue(empty);
    const inFlight = writer.flush();
    writer.enqueue(draft);
    await writer.flush();
    expect(save.mock.calls).toEqual([[empty, 0]]);
    finish(ack(empty, 1));
    await inFlight;
    expect(save.mock.calls).toEqual([[empty, 0], [draft, 1]]);
    writer.close();
  });

  it('reports failures and retries using the same pending snapshot and revision', async () => {
    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1))
      .mockRejectedValueOnce(new Error('offline'));
    const onStatus = vi.fn();
    const writer = openSetLabAutosave({ scope, confirmed: null, storage: journal(), save, onStatus });
    writer.enqueue(draft);
    await writer.flush();
    expect(onStatus).toHaveBeenLastCalledWith({ kind: 'error', message: 'offline' });
    await writer.flush();
    expect(save.mock.calls).toEqual([[draft, 0], [draft, 0]]);
    expect(onStatus).toHaveBeenLastCalledWith({ kind: 'saved' });
    writer.close();
  });

  it('recovers scoped pending work after reopening and protects a newer confirmed draft', async () => {
    const storage = journal();
    const offlineSave = vi.fn().mockRejectedValue(new Error('offline'));
    const first = openSetLabAutosave({ scope, confirmed: null, storage, save: offlineSave, onStatus: vi.fn() });
    first.enqueue(draft);
    await first.flush();
    first.close();

    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1));
    for (const otherScope of [{ ...scope, userId: 'user-2' }, { ...scope, sourceImportId: 'import-2' }]) {
      const other = openSetLabAutosave({ scope: otherScope, confirmed: null, storage, save, onStatus: vi.fn() });
      expect(other.recovered).toBeNull();
      other.close();
    }

    const onStatus = vi.fn();
    const newer = openSetLabAutosave({ scope, confirmed: ack(empty, 2), storage, save, onStatus });
    expect(newer.recovered).toBeNull();
    expect(newer.blocked).toBe(true);
    expect(onStatus).toHaveBeenLastCalledWith({ kind: 'conflict' });
    await newer.flush();
    expect(save).not.toHaveBeenCalled();
    newer.close();

    const recovered = openSetLabAutosave({ scope, confirmed: null, storage, save, onStatus });
    expect(recovered.recovered).toEqual(draft);
    await recovered.flush();
    expect(save.mock.calls).toEqual([[draft, 0]]);
    recovered.close();
  });

  it('preserves a newer journal entry from another window while acknowledging a confirmed save', async () => {
    const storage = journal();
    let finish!: (row: ReturnType<typeof ack>) => void;
    const first = new Promise<ReturnType<typeof ack>>((resolve) => { finish = resolve; });
    const onStatus = vi.fn();
    const writer = openSetLabAutosave({ scope, confirmed: null, storage, save: () => first, onStatus });
    writer.enqueue(empty);
    const inFlight = writer.flush();

    const offlineSave = vi.fn().mockRejectedValue(new Error('offline'));
    const other = openSetLabAutosave({ scope, confirmed: null, storage, save: offlineSave, onStatus: vi.fn() });
    other.enqueue(draft);
    finish(ack(empty, 1));
    await inFlight;
    expect(onStatus).toHaveBeenLastCalledWith({ kind: 'saved' });
    writer.close();
    other.close();

    const reopened = openSetLabAutosave({ scope, confirmed: null, storage, save: offlineSave, onStatus: vi.fn() });
    expect(reopened.recovered).toEqual(draft);
    reopened.close();
  });


  it('replays a queued edit when a previous write was accepted before restart', async () => {
    const storage = journal();
    const lost = vi.fn().mockRejectedValue(new Error('lost response'));
    const old = openSetLabAutosave({ scope, confirmed: null, storage, save: lost, onStatus: vi.fn() });
    old.enqueue(empty);
    await old.flush();
    old.enqueue(draft);
    old.close();

    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1));
    const reopened = openSetLabAutosave({ scope, confirmed: ack(empty, 1), storage, save, onStatus: vi.fn() });
    expect(reopened.recovered).toEqual(draft);
    await reopened.flush();
    expect(save.mock.calls).toEqual([[draft, 1]]);
    reopened.close();
  });

  it('retries a lost predecessor before writing the latest edit in the same tab', async () => {
    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1))
      .mockRejectedValueOnce(new Error('lost response'));
    const writer = openSetLabAutosave({ scope, confirmed: null, storage: journal(), save, onStatus: vi.fn() });
    writer.enqueue(empty);
    await writer.flush();
    writer.enqueue(draft);
    await writer.flush();
    expect(save.mock.calls).toEqual([[empty, 0], [empty, 0], [draft, 1]]);
    writer.close();
  });

  it.each(['local', 'server'] as const)('keeps conflicting edits until explicitly choosing %s', async (choice) => {
    const storage = journal();
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const old = openSetLabAutosave({ scope, confirmed: null, storage, save: offline, onStatus: vi.fn() });
    old.enqueue(draft);
    old.close();

    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1));
    const writer = openSetLabAutosave({ scope, confirmed: ack(empty, 2), storage, save, onStatus: vi.fn() });
    expect(writer.blocked).toBe(true);
    expect(writer.recovered).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(writer.resolveConflict(choice)).toEqual(choice === 'local' ? draft : null);
    expect(writer.blocked).toBe(false);
    await writer.flush();
    expect(save.mock.calls).toEqual(choice === 'local' ? [[draft, 2]] : []);
    writer.close();
  });

  it('flushes the last queued draft on route unmount', async () => {
    const save = vi.fn(async (session: SetLabDraft, revision: number) => ack(session, revision + 1));
    const writer = openSetLabAutosave({ scope, confirmed: null, storage: journal(), save, onStatus: vi.fn() });
    writer.enqueue(draft);
    writer.close();
    expect(save.mock.calls).toEqual([[draft, 0]]);
  });

  it('clears pending data when the server already confirmed that snapshot', async () => {
    const storage = journal();
    const offlineSave = vi.fn().mockRejectedValue(new Error('lost response'));
    const first = openSetLabAutosave({ scope, confirmed: null, storage, save: offlineSave, onStatus: vi.fn() });
    first.enqueue(draft);
    await first.flush();
    first.close();

    const save = vi.fn();
    const reopened = openSetLabAutosave({ scope, confirmed: ack(draft, 1), storage, save, onStatus: vi.fn() });
    expect(reopened.recovered).toBeNull();
    expect(reopened.blocked).toBe(false);
    await reopened.flush();
    expect(save).not.toHaveBeenCalled();
    reopened.close();
  });
});
