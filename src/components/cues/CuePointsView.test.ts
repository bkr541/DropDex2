import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CuePointsView.tsx', import.meta.url), 'utf8');

describe('Cue Points production editor wiring', () => {
  it('keeps Stage 2 manual editing on the canonical working cue set and exact Rekordbox beat-grid path', () => {
    expect(source).toContain('cues={workingCues}');
    expect(source).toContain('onContextMenu={handleWaveformContextMenu}');
    expect(source).toContain("onAddCue('hot', contextMenu.requestedMs, timingMode)");
    expect(source).toContain("onAddCue('memory', contextMenu.requestedMs, timingMode)");
    expect(source).toContain('onMoveCue(drag.cueId, requestedMs, timingMode)');
    expect(source).toContain('onDeleteCue(contextMenu.cueId)');
    expect(source).toContain('beats: beatGrid?.beats ?? []');
  });

  it('keeps Stage 3 Auto Cue feeding the same working set', () => {
    expect(source).toContain('applyAutoCueStrategy({');
    expect(source).toContain('currentCues: workingCues');
    expect(source).toContain('setWorkingCues(result.cues)');
    expect(source).toContain('onClick={() => setEditorMessage(onAutoCue())}');
    expect(source).toContain('disabled={!autoCueReady}');
    expect(source).toContain("beatGrid.track_id !== selectedTrackId");
    expect(source).toContain("phrase.track_id !== selectedTrackId");
  });

  it('exposes the Stage 5 selected-cue inspector through canonical editor actions', () => {
    expect(source).toContain('data-testid="selected-cue-inspector"');
    expect(source).toContain('editWorkingCue(workingCues, cueId, action, beatGrid?.beats ?? [])');
    expect(source).toContain("kind: 'family', family: 'memory'");
    expect(source).toContain("kind: 'family', family: 'hot', hotCueSlot: slot");
    expect(source).toContain("kind: 'hot-slot', hotCueSlot: slot");
    expect(source).toContain("kind: 'point-type'");
    expect(source).toContain("kind: 'end-ms', requestedMs: value, timingMode");
    expect(source).toContain("kind: 'loop-length-ms', requestedMs: value, timingMode");
    expect(source).toContain("kind: 'hot-color-table'");
    expect(source).toContain("kind: 'memory-color'");
    expect(source).toContain("kind: 'comment'");
    expect(source).toContain("kind: 'active-loop'");
  });

  it('keeps snap timing default and makes exact-millisecond editing deliberate', () => {
    expect(source).toContain("useState<CueTimingMode>('snap')");
    expect(source).toContain("{ value: 'snap', label: 'Snap' }");
    expect(source).toContain("{ value: 'exact', label: 'Exact ms' }");
    expect(source).toContain("timingMode === 'snap' && beatGridLoading");
    expect(source).toContain('timingMode,');
    expect(source).toContain("title={timingMode === 'snap' ? 'Right-click to add a beat-snapped cue' : 'Right-click to add an exact millisecond cue'}");
  });

  it('enters Save through the production Cue Points action and complete-document RPC path', () => {
    expect(source).toContain('onSave={handleSave}');
    expect(source).toContain('void onSave().then(setEditorMessage)');
    expect(source).toContain('createCueDraftDocument({');
    expect(source).toContain('fingerprintCueDraftDocument(document)');
    expect(source).toContain('saveCueDraft({');
    expect(source).toContain('expectedRevision');
    expect(source).toContain('setSavedCueBaseline(hydrated)');
    expect(source).toContain('disabled={!dirty || !cueEditingAllowed || saving}');
  });

  it('loads imported cues plus saved draft through the canonical baseline loader and Discard restores saved-first/imported-second', () => {
    expect(source).toContain('loadCueEditorBaseline(requestedTrack, requestedUserId)');
    expect(source).toContain('setSavedCueBaseline(result.savedCues)');
    expect(source).toContain('setWorkingCues(result.workingCues)');
    expect(source).toContain('const discardBaseline = savedCueBaseline ?? importedCueBaseline;');
    expect(source).toContain('setWorkingCues(savedCueBaseline ?? importedCueBaseline)');
    expect(source).toContain("if (!savedCueBaseline) return 'Original'");
    expect(source).toContain("return 'Needs Apply';");
  });

  it('guards cue/draft responses against stale track or user ownership', () => {
    expect(source).toContain('cueDraftLoadRequestRef.current === requestId');
    expect(source).toContain('cueLoadOwnerMatches(requestedOwner, selectedTrackIdRef.current, selectedUserIdRef.current)');
    expect(source).toContain('selectedCueLoadOwnedBySelection = cueLoadOwnerMatches(');
    expect(source).toContain('cueDraftSaveRequestRef.current === requestId');
    expect(source).toContain('workingCueSetsEqual(workingCuesRef.current, workingSnapshot)');
  });

  it('keeps track loading scoped to explicit row selection instead of table filters', () => {
    expect(source).toContain('onClick={() => setSelectedTrack(track)}');
    expect(source).not.toContain('setSelectedTrack(filteredTracks[0])');
    expect(source).not.toMatch(/useEffect\([\s\S]{0,600}\[filteredTracks\]/);
  });

  it('keeps Apply Track distinct from Apply All and sends the exact persisted scope through preflight/apply', () => {
    expect(source).toContain('<span>Apply Track</span>');
    expect(source).toContain('<span>Apply All ({applyAllCount})</span>');
    expect(source).toContain("handleApplyPreflight('track')");
    expect(source).toContain("handleApplyPreflight('all')");
    expect(source).toContain("resolveCueApplySelection(rows, scope)");
    expect(source).toContain('desktop.cueApplyPreflight(scope, desktopDrafts(selection.rows))');
    expect(source).toContain('desktop.cueApply(preflight.token, scope, desktopDrafts(applySnapshot))');
    expect(source).toContain("scope.kind === 'track' && selectedTrackId !== scope.trackId");
    expect(source).toContain('applyDrafts.some((row) => row.trackId === selectedTrackId)');
  });

  it('shows the canonical per-track current-vs-desired diff and complete-set replacement semantics before confirmation', () => {
    expect(source).toContain("diff.current_count} current → ${diff.desired_count} desired");
    expect(source).toContain("change.changes.includes('moved')");
    expect(source).toContain("change.changes.includes('family')");
    expect(source).toContain("change.changes.includes('slot')");
    expect(source).toContain("change.changes.includes('point-type')");
    expect(source).toContain("change.changes.includes('loop-extent')");
    expect(source).toContain('cueDiffChangeLabel(change)');
    expect(source).toContain('replaces the complete Rekordbox cue set');
  });

  it('surfaces Stage 4 cue integrity and blocks mutation/apply while malformed cues remain inspectable', () => {
    expect(source).toContain('return hotCueSlotLabel(cue.hotCueSlot)');
    expect(source).toContain('setSelectedCueIntegrity(result.integrity)');
    expect(source).toContain("selectedCueIntegrity?.status === 'valid'");
    expect(source).toContain("cueIntegrity.status === 'unresolved' ? 'Cue ownership unresolved' : 'Cue baseline invalid'");
    expect(source).toContain("if (!selectedCueBaselineEditable) return selectedCueBlockReason");
    expect(source).toContain('if (!selectedCueBaselineEditable) return;');
    expect(source).toContain('if (result.blockedReason) return result.blockedReason;');
    expect(source).toContain('workingCues={result.workingCues}').toBe(false);
    expect(source).toContain('setWorkingCues(result.workingCues)');
    expect(source).toContain('Retry baseline');
  });

  it('persists the imported local DjmdCue baseline and strong track identity for desktop apply', () => {
    expect(source).toContain('fingerprintImportedLocalCueBaseline(importedDocument)');
    expect(source).toContain('importedBaselineLocalCueFingerprint,');
    expect(source).toContain('masterDbId: row.masterDbId');
    expect(source).toContain('masterContentId: row.masterContentId');
  });

  it('keeps selected cue-load and saved-draft failures distinct from an editable zero-cue baseline', () => {
    expect(source).toContain("setSelectedCueLoadStatus('failed')");
    expect(source).toContain('setSelectedCueLoadError(result.error)');
    expect(source).toContain("cueLoadStatus === 'failed'");
    expect(source).toContain("cueLoadError ?? 'Cue points could not be loaded.'");
    expect(source).toContain('onClick={onRetryCues}');
    expect(source).toContain('if (!selectedCueBaselineComplete) return;');
    expect(source).toContain('persistenceMessage={draftPersistenceMessage}');
  });

  it('uses explicit library cue load states so failed tracks are not classified as No cues', () => {
    expect(source).toContain('fetchTracksCueStates(trackIds)');
    expect(source).toContain('cueFilterMatches(cueSummaryStates.get(track.id), cueFilter)');
    expect(source).toContain("status: 'failed'");
    expect(source).toContain('Those tracks are excluded from Has cues / No cues results until the request succeeds.');
    expect(source).toContain('setCueSummaryRetryNonce((value) => value + 1)');
  });

  it('keeps Stage 9 imported truth, desired color semantics, and verified post-Apply rebase separate', () => {
    expect(source).toContain('fingerprintImportedLocalCueBaseline(importedDocument)');
    expect(source).toContain("kind: 'hot-color-table'");
    expect(source).toContain("kind: 'memory-color'");
    expect(source).toContain('track.local_cue_fingerprint');
    expect(source).toContain('postApplyLocalCueFingerprint');
    expect(source).toContain('setDraftImportedBaselineFingerprint(updated.value.importedBaselineFingerprint)');
    expect(source).toContain('setDraftImportedBaselineLocalCueFingerprint(updated.value.importedBaselineLocalCueFingerprint)');
    expect(source).toContain('existingImportedBaselineLocalCueFingerprint');
  });

  it('surfaces Apply draft-loading failure instead of turning it into an empty successful draft set', () => {
    expect(source).toContain('setApplyDraftLoadError(');
    expect(source).toContain('Saved cue drafts could not be loaded for Apply:');
    expect(source).toContain('{applyDraftLoadError && <p className="text-red-300">{applyDraftLoadError}</p>}');
    expect(source).not.toContain('.catch(() => setApplyDrafts([]))');
  });
  it('renders Stage 6 loop ranges, canonical colors, metadata, and conflict provenance in the production Cue Points path', () => {
    expect(source).toContain('REKORDBOX_MEMORY_CUE_COLORS');
    expect(source).toContain('cueLoopRangeGeometry');
    expect(source).toContain("data-testid={cue.pointType === 'loop' ? 'cue-loop-start-marker' : 'cue-point-marker'}");
    expect(source).toContain('data-testid="cue-loop-range"');
    expect(source).toContain('data-testid="waveform-loop-range"');
    expect(source).toContain('data-testid="cue-metadata-summary"');
    expect(source).toContain('const displayColor = resolveCueDisplayColor(cue);');
    expect(source).toContain('const provenance = summarizeCueProvenance(cue);');
    expect(source).toContain("provenance.blocking ? 'Blocking conflict' : 'No blocking conflict'");
    expect(source).toContain('editable={cueEditingAllowed}');
    expect(source).toContain('onFocus={() => setSelectedCueId(cue.editorId)}');
    expect(source).toContain('if (selectedCueId && !cues.some((cue) => cue.editorId === selectedCueId)) setSelectedCueId(null);');
    expect(source).toContain("if (cueEditingAllowed && (event.key === 'Delete' || event.key === 'Backspace'))");
  });

});
