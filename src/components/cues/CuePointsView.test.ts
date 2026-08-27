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
    expect(source).toContain('disabled={(!dirty && !baselineProofRefreshNeeded) || !cueEditingAllowed || saving}');
  });

  it('uses cue-feature truth for Ready and refreshes missing legacy baseline proof without trusting old applied bookkeeping', () => {
    expect(source).toContain('return cueAnalysisReady(track);');
    expect(source).toContain('return cueAnalysisLabel(track);');
    expect(source).toContain("if (draftCurrentBaselineLocalCueFingerprint == null) return 'Needs Verification';");
    expect(source).not.toContain("draftAppliedRevision === draftRevision && draftAppliedFingerprint === draftDesiredFingerprint) return 'Applied'");
    expect(source).toContain('existingImportedBaselineLocalCueFingerprint ?? freshImportedBaselineLocalCueFingerprint');
    expect(source).toContain('baselineProofRefreshNeeded={baselineProofRefreshNeeded}');
    expect(source).toContain('Refresh verified cue baseline proof for this legacy draft');
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

  it('sorts Duration from the persisted Rekordbox duration fields instead of the nonexistent total_time field', () => {
    expect(source).toContain("a.duration_ms ?? (a.duration_seconds != null ? a.duration_seconds * 1000 : -1)");
    expect(source).toContain("b.duration_ms ?? (b.duration_seconds != null ? b.duration_seconds * 1000 : -1)");
    expect(source).not.toContain("sortCol === 'duration') { av = a.total_time");
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

  it('durably records rejected, rolled-back, and recovery-unverified Apply outcomes before stale-renderer guards', () => {
    expect(source).toContain('markCueDraftApplyOutcome({');
    expect(source).toContain("if (result.state !== 'applied')");
    expect(source).toContain('const persisted = await Promise.allSettled(applySnapshot.map((row) => markCueDraftApplyOutcome({');
    const persistenceIndex = source.indexOf("if (result.state !== 'applied')");
    const staleGuardIndex = source.indexOf('if (generation !== applyGenerationRef.current', source.indexOf('const result = await desktop.cueApply'));
    expect(persistenceIndex).toBeGreaterThan(-1);
    expect(staleGuardIndex).toBeGreaterThan(persistenceIndex);
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

  it('keeps import provenance separate from the Stage 10 moving current baseline and verified rebase proof', () => {
    expect(source).toContain('fingerprintImportedLocalCueBaseline(importedDocument)');
    expect(source).toContain("kind: 'hot-color-table'");
    expect(source).toContain("kind: 'memory-color'");
    expect(source).toContain('track.local_cue_fingerprint');
    expect(source).toContain('postApplyLocalCueFingerprint');
    expect(source).toContain('currentBaselineFingerprint: row.currentBaselineFingerprint');
    expect(source).toContain('currentBaselineLocalCueFingerprint: row.currentBaselineLocalCueFingerprint');
    expect(source).toContain('setDraftCurrentBaselineFingerprint(updatedSelected.value.currentBaselineFingerprint)');
    expect(source).toContain('setDraftCurrentBaselineLocalCueFingerprint(updatedSelected.value.currentBaselineLocalCueFingerprint)');
    expect(source).toContain('row.masterContentId ?? row.rekordboxContentId');
    expect(source).toContain('Retry verified rebase');
    expect(source).toContain('applyBlockedByPendingRebase');
    expect(source).toContain('existingImportedBaselineLocalCueFingerprint');
  });

  it('surfaces Apply draft-loading failure and lets the user retry the guarded loader', () => {
    expect(source).toContain('setApplyDraftLoadError(');
    expect(source).toContain('Saved cue drafts could not be loaded for Apply:');
    expect(source).toContain('const [applyDraftRetryNonce, setApplyDraftRetryNonce] = useState(0);');
    expect(source).toContain('[applyDraftRetryNonce, draftRevision, importId, userId]');
    expect(source).toContain('onClick={() => setApplyDraftRetryNonce((value) => value + 1)}');
    expect(source).toContain('Retry loading drafts');
    expect(source).not.toContain('.catch(() => setApplyDrafts([]))');
  });

  it('wires inline Genre editing to the persisted metadata-draft production path without mutating canonical track Genre', () => {
    expect(source).toContain('fetchTrackMetadataDraftsForImport(userId, importId)');
    expect(source).toContain('new Map(rows.map((row) => [row.trackId, row]))');
    expect(source).toContain('const genreDraft = genreDraftsByTrackId.get(track.id) ?? null;');
    expect(source).toContain('const effectiveGenre = genreDraft ? genreDraft.pendingValue : track.genre;');
    expect(source).toContain('setEditingGenreValue(effectiveGenre ?? \'\')');
    expect(source).toContain('saveGenreMetadataDraft({');
    expect(source).toContain('expectedRevision: existingDraft?.revision ?? 0');
    expect(source).toContain('if (saved) next.set(track.id, saved);');
    expect(source).toContain('else next.delete(track.id);');
    expect(source).not.toContain('track.genre =');
    expect(source).not.toContain('TODO: wire save');
  });

  it('keeps Genre editor keyboard, retry, pending, and stale-revision behavior explicit and recoverable', () => {
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("event.key === 'Enter' && !event.repeat && genreEditingDirty && !genreSaving");
    expect(source).toContain('genreSaveInFlightRef.current.has(inFlightKey)');
    expect(source).toContain('error instanceof TrackMetadataDraftRevisionConflictError');
    expect(source).toContain('Reload pending Genre');
    expect(source).toContain('setMetadataDraftRetryNonce((value) => value + 1)');
    expect(source).toContain('Pending Genre change. Not yet applied to Rekordbox.');
    expect(source).toContain('Pending Genre changes could not be loaded:');
    expect(source).toContain('pending state is unknown until this succeeds');
    expect(source).toContain('maxLength={REKORDBOX_GENRE_MAX_LENGTH}');
    expect(source).toContain('onClick={(event) => event.stopPropagation()}');
  });

  it('loads Genre drafts by complete-set queries instead of issuing per-row metadata queries', () => {
    expect(source.match(/fetchTrackMetadataDraftsForImport\(userId, importId\)/g)).toHaveLength(2);
    expect(source).toContain('Re-fetch through the Stage 1 exact-count paginator immediately before');
    expect(source).not.toContain('fetchGenreMetadataDraft(');
    expect(source).toContain('[importId, metadataDraftRetryNonce, userId]');
    expect(source).toContain("metadataDraftLoadStatus !== 'loaded'");
  });

  it('wires Stage 5 metadata preflight and explicit bound apply through the desktop boundary', () => {
    expect(source).toContain('desktop.metadataApplyAvailability()');
    expect(source).toContain('result.metadataApplySupported === true');
    expect(source).toContain('desktop.metadataApplyPreflight(');
    expect(source).toContain('desktop.metadataApply(');
    expect(source).toContain("{ kind: 'all', importId, expectedDraftCount: pendingRows.length }");
    expect(source).toContain('freshIdentityKey !== pendingMetadataDraftIdentityKey');
    expect(source).toContain('Pending metadata changed before preflight.');
    expect(source).toContain('Pending metadata changed after preflight. No write was requested');
    expect(source).toContain('setMetadataApplyPreflight(null); // Stage 4 tokens are single-use even on rejection.');
    expect(source).toContain('validateVerifiedMetadataApplyResult({ drafts: pendingRows, preflight, result })');
    expect(source).toContain("applyState: 'cloud-finalization-pending'");
    expect(source).toContain('finalizeTrackMetadataApply({');
  });

  it('wires Stage 6B finalization, durable recovery hydration, and read-only retry without replaying the writer', () => {
    expect(source).toContain('.filter(metadataDraftNeedsReview)');
    expect(source).toContain('isTrackMetadataDraftRecoveryLocked(draft)');
    expect(source).toContain('buildMetadataRecoveryRequest(draft)');
    expect(source).toContain('desktop.metadataRecoveryVerify(request)');
    expect(source).toContain('validateMetadataRecoveryVerification(request, verification)');
    expect(source).toContain('refreshLibraryTracks();');
    expect(source).toContain('refreshLibraryStats();');
    expect(source).toContain("{genreRecoveryLocked ? 'Recovery' : 'Pending'}");

    const recoveryStart = source.indexOf('const handleMetadataRecovery = useCallback');
    const recoveryEnd = source.indexOf('const trackIdsKey = useMemo', recoveryStart);
    const recoverySource = source.slice(recoveryStart, recoveryEnd);
    expect(recoverySource).toContain('metadataRecoveryVerify(request)');
    expect(recoverySource).toContain('finalizeTrackMetadataApply({');
    expect(recoverySource).not.toContain('desktop.metadataApply(');
  });

  it('guards duplicate metadata apply/recovery actions and stale user/import completions', () => {
    expect(source).toContain('|| metadataApplyBusy) return;');
    expect(source).toContain('|| metadataRecoveryTrackId != null) return;');
    expect(source).toContain('const contextIsCurrent = () => selectedUserIdRef.current === requestedUserId');
    expect(source).toContain('selectedImportIdRef.current === requestedImportId');
    expect(source).toContain('const generation = ++metadataApplyGenerationRef.current;');
    expect(source).toContain('if (generation === metadataApplyGenerationRef.current) setMetadataApplyBusy(false);');
  });

  it('wires the Stage 3 Pending Changes review to the shared complete draft cache and revision-safe Discard path', () => {
    expect(source).toContain('<PendingMetadataChangesReview');
    expect(source).toContain('pendingCount={pendingMetadataCount}');
    expect(source).toContain('rows={pendingMetadataReviewRows}');
    expect(source).toContain('fetchTracksByIds(trackIds)');
    expect(source).toContain('.filter(metadataDraftNeedsApply).length');
    expect(source).toContain('.filter(metadataDraftNeedsReview).length');
    expect(source).toContain('recoveryCount={metadataRecoveryCount}');
    expect(source).toContain('draft.currentBaselineValue');
    expect(source).toContain('discardGenreMetadataDraft({');
    expect(source).toContain('expectedRevision: draft.revision');
    expect(source).toContain('next.delete(draft.trackId)');
    expect(source).toContain('if (editingGenreTrackId === draft.trackId)');
    expect(source).toContain('genreSaveInFlightRef.current.has(inFlightKey)');
    expect(source).toContain('setMetadataDraftRetryNonce((value) => value + 1)');
    expect(source).toContain('setPendingMetadataTrackRetryNonce((value) => value + 1)');
    expect(source).toContain('Pending Changes (${pendingMetadataCount})');
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
