import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CuePointsView.tsx', import.meta.url), 'utf8');

describe('Cue Points production editor wiring', () => {
  it('keeps Stage 2 manual editing on the canonical working cue set and exact Rekordbox beat-grid path', () => {
    expect(source).toContain('cues={workingCues}');
    expect(source).toContain('onContextMenu={handleWaveformContextMenu}');
    expect(source).toContain("onAddCue('hot', contextMenu.requestedMs)");
    expect(source).toContain("onAddCue('memory', contextMenu.requestedMs)");
    expect(source).toContain('onMoveCue(drag.cueId, requestedMs)');
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

  it('enters Stage 4 Save through the production Cue Points action and complete-document RPC path', () => {
    expect(source).toContain('onSave={handleSave}');
    expect(source).toContain('void onSave().then(setEditorMessage)');
    expect(source).toContain('createCueDraftDocument({');
    expect(source).toContain('fingerprintCueDraftDocument(document)');
    expect(source).toContain('saveCueDraft({');
    expect(source).toContain('expectedRevision');
    expect(source).toContain('setSavedCueBaseline(hydrated)');
    expect(source).toContain("{saving ? 'Saving…' : 'Save changes'}");
  });

  it('hydrates a saved draft for the explicit selected track and Discard restores saved-first/imported-second', () => {
    expect(source).toContain('fetchCueDraft(requestedUserId, requestedTrackId)');
    expect(source).toContain('hydrateCueDraftDocument(draft.desiredDocument)');
    expect(source).toContain('const discardBaseline = savedCueBaseline ?? importedCueBaseline;');
    expect(source).toContain('setWorkingCues(savedCueBaseline ?? importedCueBaseline)');
    expect(source).toContain("if (!savedCueBaseline) return 'Original'");
    expect(source).toContain("? 'Saved' : 'Needs Apply'");
  });

  it('guards cue/draft responses against stale track or user ownership', () => {
    expect(source).toContain('cueDraftLoadRequestRef.current === requestId');
    expect(source).toContain('selectedTrackIdRef.current, requestedTrackId');
    expect(source).toContain('selectedUserIdRef.current === requestedUserId');
    expect(source).toContain('cueDraftSaveRequestRef.current === requestId');
    expect(source).toContain('workingCueSetsEqual(workingCuesRef.current, workingSnapshot)');
  });

  it('keeps track loading scoped to explicit row selection instead of table filters', () => {
    expect(source).toContain('onClick={() => setSelectedTrack(track)}');
    expect(source).not.toContain('setSelectedTrack(filteredTracks[0])');
    expect(source).not.toMatch(/useEffect\([\s\S]{0,600}\[filteredTracks\]/);
  });

  it('keeps Rekordbox export disabled in Stage 4', () => {
    expect(source).toContain('variant="primary" disabled title="Cue export will be enabled');
  });
});
