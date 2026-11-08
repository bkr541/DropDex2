import '../../components/ui/studio-surface.css';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { RouteLoadErrorState, RouteLoadingState } from '../../components/RouteStates';
import { ControlButton, SearchControl } from '../../components/ui/controls';
import { NoticeCard } from '../../components/ui/feedback';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { fetchTrackPhrases } from '../../lib/queries/analysisData';
import type { RekordboxTrack } from '../../types';
import { loadSetLabCandidatePool } from './candidateProvider';
import { generateSetLab } from './generateSet';
import { verifySetLabCandidate } from './mediaEligibility';
import { prepareSetLabSwap } from './prepareSetLabSwap';
import { commitSetLabEdit } from './setLabEditCommit';
import { SetLabEditDialog } from './SetLabEditDialog';
import { SetLabRepositionEditor } from './SetLabRepositionEditor';
import type { SetLabRepositionTarget } from './repositionSetLab';
import type { SetLabAction } from './sessionReducer';
import type { SetLabSwapContext } from './swapCandidates';
import { nearestSetLabWindow } from './sectionResolver';
import type { SetLabRecoveryChoice } from './draftAutosave';
import { fetchSetLabSavedSet } from './sessionRepository';
import { restoreSetLabSavedSet } from './savedSetRestore';
import { SetLabSavedSets } from './SetLabSavedSets';
import { SetLabSaveSet } from './SetLabSaveSet';
import { SetLabTimeline, type SetLabClipAnalysis } from './SetLabTimeline';
import { SetLabTrackBrowser } from './SetLabTrackBrowser';
import type { SetLabBarCount, SetLabFilters, SetLabPosition, SetLabScope, SetLabSlot } from './session';
import { useSetLabSession } from './useSetLabSession';
import { useSetLabPreview } from './useSetLabPreview';

type WorkKind = 'generate' | 'bars' | 'swap' | 'load';

interface PendingEdit {
  action: SetLabAction;
  title: string;
  confirmLabel: string;
  details?: string;
  message?: string;
  alwaysConfirm?: boolean;
  notice: string;
}

export function SetLabView({ scope, importDeviceName, onReturnToLibrary }: {
  scope: SetLabScope;
  importDeviceName: string | null;
  onReturnToLibrary: () => void;
}) {
  const { hydration, saveStatus, dispatch, retryRestore, retrySave, resolveRecovery } = useSetLabSession(scope);
  const usb = useUsbConnection();
  const slots = hydration.kind === 'ready' && hydration.state.draft.slots.length === 5 ? hydration.state.draft.slots : null;
  const preview = useSetLabPreview({ scope, slots, importDeviceName });
  const active = useRef<{ controller: AbortController; kind: WorkKind } | null>(null);
  const pending = useRef<PendingEdit | null>(null);
  const [editor, setEditor] = useState<{ target: SetLabRepositionTarget; trigger: HTMLElement } | null>(null);
  const [work, setWork] = useState<WorkKind | null>(null);
  const [dialog, setDialog] = useState<PendingEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedRefresh, setSavedRefresh] = useState(0);
  const [filterReset, setFilterReset] = useState(0);
  const [recovery, setRecovery] = useState<SetLabRecoveryChoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    setWork(null);
    setDialog(null);
    setRecovery(null);
    if (editor) {
      setEditor(null);
      setError('The audio connection or import changed. Reopen Reposition Track to check the source again.');
    }
    return () => {
      active.current?.controller.abort();
      active.current = null;
      pending.current = null;
    };
  }, [scope.userId, scope.sourceImportId, importDeviceName, usb.status, usb.volumeName, usb.handle, usb.connectedAt, usb.resolveTrackSource]);

  if (hydration.kind === 'loading') return <RouteLoadingState label="Restoring Set Lab draft…" />;
  if (hydration.kind === 'error') {
    return <RouteLoadErrorState message={hydration.message} onRetry={retryRestore} onReturnToLibrary={onReturnToLibrary} />;
  }

  const { draft, canUndoSwap, canUndoReposition } = hydration.state;
  const draftConflict = saveStatus.kind === 'conflict';
  const busy = work != null || dialog != null || draftConflict;
  const playbackActive = preview.status === 'playing' || preview.status === 'preparing';
  const editDisabled = busy || playbackActive;
  const empty = draft.slots.length === 0;
  const allLocked = !empty && draft.slots.every((slot) => slot.locked);
  const selected = draft.selectedSlot == null ? null : draft.slots[draft.selectedSlot - 1];

  async function runWork(kind: WorkKind, run: (signal: AbortSignal) => Promise<void>) {
    const playback = preview.getSnapshot().status;
    if (active.current || pending.current || draftConflict || (kind === 'generate' && (playback === 'playing' || playback === 'preparing'))) return;
    const controller = new AbortController();
    const request = { controller, kind };
    active.current = request;
    const { signal } = controller;
    setError(null);
    setNotice(null);
    setWork(kind);
    try {
      await run(signal);
    } catch (reason) {
      if (!signal.aborted && active.current === request) {
        setError(reason instanceof Error ? reason.message : 'Could not update the Set Lab arrangement.');
      }
    } finally {
      if (active.current === request) {
        active.current = null;
        setWork(null);
      }
    }
  }

  function generate(filters: SetLabFilters, reroll?: SetLabPosition) {
    return runWork('generate', async (signal) => {
      const fixedIds = draft.slots.filter((slot) => reroll ? slot.position !== reroll : slot.locked).map((slot) => slot.trackId);
      const seed = crypto.randomUUID();
      const pool = await loadSetLabCandidatePool({ scope, filters, fixedIds, usb, importDeviceName, signal });
      const result = await generateSetLab({ draft, seed, pool, reroll, signal });
      signal.throwIfAborted();
      if (result.ok === false) throw new Error(result.explanation);
      dispatch({ type: 'generate-commit', base: draft, seed, filters, reroll, slots: result.slots, transitions: result.transitions }, preview.stopAndReset);
    });
  }

  function changeBars(slot: SetLabSlot, barCount: SetLabBarCount, { track, grid, cues }: SetLabClipAnalysis) {
    return runWork('bars', async (signal) => {
      const phrases = await fetchTrackPhrases(track.id, signal).catch(() => []);
      signal.throwIfAborted();
      const result = await verifySetLabCandidate({
        scope, track, analysis: { beatGrid: grid, cues, phrases }, barCount, importDeviceName, signal,
      }, { usb });
      signal.throwIfAborted();
      if (result.ok === false) {
        throw new Error([result.explanation, ...(result.attempts ?? []).map((attempt) => attempt.explanation)].join(' '));
      }
      const window = nearestSetLabWindow(result.windows, slot.section.startMs);
      if (!window) throw new Error('No playable window fits that bar count.');
      applyEdit({
        action: { type: 'set-bar-count', base: draft, position: slot.position, barCount, section: window.section },
        title: `Change slot ${slot.position} to ${barCount} bars?`,
        confirmLabel: 'Confirm',
        notice: `Slot ${slot.position} now uses ${barCount} bars.`,
      });
    });
  }

  function applyEdit(edit: PendingEdit, confirmed = false) {
    const result = !confirmed && edit.alwaysConfirm ? 'confirm' : commitSetLabEdit(edit.action, preview, dispatch, confirmed);
    if (result === 'confirm') {
      pending.current = edit;
      setDialog(edit);
    } else if (result === 'committed') {
      if (edit.action.type === 'load-saved') setFilterReset((value) => value + 1);
      setNotice(edit.notice);
    }
  }

  function swap(track: RekordboxTrack, context: SetLabSwapContext | null) {
    return runWork('swap', async (signal) => {
      const prepared = await prepareSetLabSwap({ draft, track, context, importDeviceName, signal }, { usb });
      signal.throwIfAborted();
      applyEdit({
        action: prepared.action,
        title: `Swap into slot ${prepared.action.position}?`,
        confirmLabel: 'Swap',
        details: `${prepared.title} · ${prepared.notice}`,
        notice: `Swapped ${prepared.title} into slot ${prepared.action.position}. ${prepared.notice}`,
      });
    });
  }

  function loadSavedSet(id: string) {
    return runWork('load', async (signal) => {
      const saved = await fetchSetLabSavedSet(scope.userId, id, signal);
      signal.throwIfAborted();
      if (!saved) {
        setSavedRefresh((value) => value + 1);
        throw new Error('This saved set is no longer available. Choose another set from Saved Sets.');
      }
      const restored = await restoreSetLabSavedSet({ saved, scope, importDeviceName, signal }, { usb });
      signal.throwIfAborted();
      const playing = preview.getSnapshot().status === 'playing';
      applyEdit({
        action: { type: 'load-saved', base: draft, draft: restored },
        title: `Load “${saved.session.name}”?`,
        message: 'Replace the current working draft with this saved set. The named snapshot stays saved.'
          + (playing ? ' Playback will stop and reset to the beginning.' : ''),
        confirmLabel: 'Load working copy',
        alwaysConfirm: true,
        notice: `Loaded “${saved.session.name}” as the working draft.`,
      });
    });
  }

  function dismissDialog() {
    pending.current = null;
    setDialog(null);
  }

  function confirmEdit() {
    const edit = pending.current;
    if (!edit) return;
    dismissDialog();
    try {
      applyEdit(edit, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not commit the Set Lab edit.');
    }
  }

  function undoEdit(kind: 'swap' | 'reposition') {
    if (active.current || pending.current || (kind === 'swap' ? !canUndoSwap : !canUndoReposition)) return;
    setError(null);
    setNotice(null);
    applyEdit(kind === 'swap'
      ? { action: { type: 'undo', swapOnly: true }, title: 'Undo the last swap?', confirmLabel: 'Undo swap', notice: 'Swap undone.' }
      : { action: { type: 'undo', repositionOnly: true }, title: 'Undo repositioning?', confirmLabel: 'Undo reposition', notice: 'Reposition undone.' });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const applyFilters = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'apply-filters';
    if (busy || (!applyFilters && (allLocked || editDisabled))) return;
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? '').trim();
    const minBpm = read('minBpm') ? Number(read('minBpm')) : null;
    const maxBpm = read('maxBpm') ? Number(read('maxBpm')) : null;
    if ((minBpm != null && (!Number.isFinite(minBpm) || minBpm <= 0))
      || (maxBpm != null && (!Number.isFinite(maxBpm) || maxBpm <= 0))
      || (minBpm != null && maxBpm != null && minBpm > maxBpm)) {
      setError('Enter a valid BPM range with the minimum at or below the maximum.');
      return;
    }
    const genres = [...new Set(read('genres').split(',').map((genre) => genre.trim()).filter(Boolean))];
    const filters = { search: read('search'), genres, minBpm, maxBpm };
    if (applyFilters) {
      if (dispatch({ type: 'set-options', filters, settings: draft.settings })) {
        setError(null);
        setNotice('Generation filters updated.');
      }
    } else void generate(filters);
  }

  function cancel() {
    active.current?.controller.abort();
    active.current = null;
    setWork(null);
  }

  return (
    <section className="studio-surface set-lab-studio" aria-label="Set Lab draft">
      <div className="min-w-0 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-black">{empty ? 'Start a five-track set' : 'Your five-track set'}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {empty ? 'Generate from your active Rekordbox library. Set Lab needs five unique tracks with playable audio and exact beat grids.'
                : 'Select a slot to make it the swap target. Reroll uses the saved generation filters.'}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <SetLabSaveSet draft={draft} disabled={busy} onSaved={() => setSavedRefresh((value) => value + 1)} />
            <SetLabSavedSets userId={scope.userId} sourceImportId={scope.sourceImportId} refresh={savedRefresh}
              disabled={busy} onLoad={(id) => { void loadSavedSet(id); }} />
          </div>
        </div>

        {draft.loadedFrom && <p className="mt-2 break-words text-xs text-muted-foreground">
          Working copy of “{draft.loadedFrom.name}”
        </p>}
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <details>
            <summary className="cursor-pointer text-xs font-bold focus-visible:outline-primary">Generation filters</summary>
            <fieldset key={filterReset} disabled={busy} className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SearchControl name="search" aria-label="Generation search" placeholder="Track, artist, or genre" defaultValue={draft.filters.search} />
              <input className="dd-text-control dd-text-input" name="genres" aria-label="Generation genres, comma-separated"
                placeholder="Genres, comma-separated" defaultValue={draft.filters.genres.join(', ')} />
              <input className="dd-text-control dd-text-input" type="number" step="any" min="0.01" name="minBpm"
                aria-label="Generation minimum BPM" placeholder="Minimum BPM" defaultValue={draft.filters.minBpm ?? ''} />
              <input className="dd-text-control dd-text-input" type="number" step="any" min="0.01" name="maxBpm"
                aria-label="Generation maximum BPM" placeholder="Maximum BPM" defaultValue={draft.filters.maxBpm ?? ''} />
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
                <p className="text-[11px] text-muted-foreground">Leave blank to generate from the full library.</p>
                <ControlButton type="submit" value="apply-filters" variant="ghost">Apply filters</ControlButton>
              </div>
            </fieldset>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <ControlButton type="submit" variant="primary" disabled={editDisabled || allLocked}>{empty ? 'Generate Set' : 'Regenerate Set'}</ControlButton>
            {work && <ControlButton variant="neutral" onClick={cancel}>Cancel</ControlButton>}
            {canUndoSwap && <ControlButton variant="neutral" disabled={busy} onClick={() => undoEdit('swap')}>Undo swap</ControlButton>}
            {canUndoReposition && <ControlButton variant="neutral" disabled={busy} onClick={() => undoEdit('reposition')}>Undo reposition</ControlButton>}
            {playbackActive && <span className="text-xs text-muted-foreground">Pause or stop to regenerate or reroll.</span>}
            {allLocked && <span className="text-xs text-muted-foreground">Unlock a slot to regenerate.</span>}
            {work && <span role="status" className="text-xs text-muted-foreground">
              {work === 'swap' ? 'Checking replacement audio and section…'
                : work === 'bars' ? 'Checking section length and audio…'
                  : work === 'load' ? 'Checking the saved set against this import and its audio sources…'
                    : 'Finding compatible tracks and checking audio…'}
            </span>}
            {saveStatus.kind === 'pending' && <span role="status" className="text-xs text-muted-foreground">Saving draft…</span>}
          </div>
        </form>
        {draftConflict && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <p>The server draft differs from the unsaved draft on this device.</p>
          <ControlButton variant="neutral" onClick={() => setRecovery('local')}>Recover local draft</ControlButton>
          <ControlButton variant="neutral" onClick={() => setRecovery('server')}>Keep server draft</ControlButton>
        </div>}
        {saveStatus.kind === 'error' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="alert">
            <p>{saveStatus.message}</p>
            <ControlButton variant="neutral" onClick={retrySave} disabled={busy}>Retry draft save</ControlButton>
          </div>
        )}
      </div>

      {draft.slots.length === 5 && (
        <SetLabTimeline scope={scope} slots={draft.slots} selectedSlot={draft.selectedSlot} busy={busy} selectionDisabled={busy && work !== 'swap'} editDisabled={editDisabled} playback={preview}
          onSelect={(position) => {
            if (position !== draft.selectedSlot && active.current?.kind === 'swap') cancel();
            dispatch({ type: 'select', position });
          }}
          onLock={(slot) => { setError(null); dispatch({ type: 'set-locked', position: slot.position, locked: !slot.locked }); }}
          onReroll={(position) => { void generate(draft.filters, position); }}
          onBars={(slot, bars, analysis) => { void changeBars(slot, bars, analysis); }}
          onReposition={(slot, analysis, trigger) => {
            if (editor || active.current || pending.current) return;
            setError(null);
            setNotice(null);
            setEditor({ target: { ...analysis, base: draft, slot, importDeviceName }, trigger });
          }}
          renderReposition={(position, waveform) => editor?.target.slot.position === position && (
            <SetLabRepositionEditor target={editor.target} trigger={editor.trigger} usb={usb} waveform={waveform}
              onClose={() => setEditor(null)}
              onCommit={(action, confirmed) => {
                const status = commitSetLabEdit(action, preview, dispatch, confirmed);
                if (status === 'committed') setNotice(`Slot ${position} repositioned. ${action.selection?.reason ?? ''}`.trim());
                return status;
              }} />
          )} />
      )}
      {selected && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-t border-[var(--color-border-faint)] px-4 py-3 text-xs text-muted-foreground">
          {selected.selection && <p><strong>Slot {selected.position}</strong> · {selected.selection.reason}</p>}
          {draft.transitions ? (
            <details className="max-w-full">
              <summary className="cursor-pointer font-bold text-foreground">Transition compatibility</summary>
              <ol className="mt-2 space-y-1">
                {draft.transitions.map((transition) => (
                  <li key={transition.from}>
                    <strong>{transition.from} → {transition.from + 1}</strong> · {transition.score}
                    {transition.caution && ' · Use caution'} · {transition.explanation}
                  </li>
                ))}
              </ol>
            </details>
          ) : <p>Transition scores are available after generation or reroll.</p>}
        </div>
      )}
      <SetLabTrackBrowser draft={draft} busy={busy} onSwap={(track, context) => { void swap(track, context); }}
        onSimilarOnly={(similarOnly) => { if (work === 'load') cancel(); dispatch({ type: 'set-options', filters: draft.filters, settings: { ...draft.settings, similarOnly } }); }} />
      {(error || notice) && (
        <NoticeCard tone={error ? 'error' : 'success'} title="Set Lab"
          className="fixed inset-x-4 bottom-20 z-[60] sm:left-auto sm:max-w-md"
          onDismiss={() => { setError(null); setNotice(null); }}>
          {error ?? notice}
        </NoticeCard>
      )}
      {recovery && <SetLabEditDialog
        title={recovery === 'local' ? 'Recover the local draft?' : 'Keep the server draft?'}
        confirmLabel={recovery === 'local' ? 'Recover local draft' : 'Keep server draft'}
        message={recovery === 'local'
          ? 'Use the unsaved changes from this device as the working draft and replace the current server draft. The preview will reset.'
          : 'Keep the current server draft and discard the unsaved changes on this device.'}
        onCancel={() => setRecovery(null)}
        onConfirm={() => {
          resolveRecovery(recovery, preview.stopAndReset);
          if (recovery === 'local') setFilterReset((value) => value + 1);
          setRecovery(null);
        }} />}
      {dialog && <SetLabEditDialog title={dialog.title} confirmLabel={dialog.confirmLabel} details={dialog.details} message={dialog.message}
        onCancel={dismissDialog} onConfirm={confirmEdit} />}
    </section>
  );
}
