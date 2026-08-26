import { describe, expect, it } from 'vitest';
import type { WorkingCue } from '../music/cueEditorState';
import { createCueDraftDocument } from './cueDraftDocument';
import {
  createImportedLocalCueBaselinePayload,
  fingerprintImportedLocalCueBaseline,
} from './localCueBaseline';

function cue(overrides: Partial<WorkingCue> = {}): WorkingCue {
  return {
    editorId: 'runtime',
    trackId: 'track-1',
    importId: 'import-1',
    importedCueId: 'cue-1',
    rekordboxCueId: 'rb-1',
    dedupeKey: 'db:1',
    family: 'memory',
    hotCueSlot: null,
    pointType: 'cue',
    startMs: 1000,
    endMs: null,
    colorTableIndex: null,
    colorHex: null,
    colorName: null,
    rekordboxColor: -1,
    comment: 'Memory',
    isActiveLoop: null,
    beatLoopNumerator: null,
    beatLoopDenominator: null,
    sourceDbPresent: true,
    sourceAnlzPresent: true,
    sourceConflict: false,
    sourceKind: '0',
    rekordboxKind: null,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'imported',
    ...overrides,
  };
}

function document(cues: WorkingCue[]) {
  return createCueDraftDocument({
    importId: 'import-1',
    trackId: 'track-1',
    rekordboxContentId: 'usb-content-9',
    cues,
  });
}

describe('local Rekordbox cue baseline fingerprint', () => {
  it('is deterministic when equivalent imported DB cues arrive in a different order', async () => {
    const first = document([
      cue({ editorId: 'a', startMs: 2000, comment: 'Two' }),
      cue({ editorId: 'b', importedCueId: 'cue-2', rekordboxCueId: 'rb-2', startMs: 1000, comment: 'One' }),
    ]);
    const second = document([
      cue({ editorId: 'x', importedCueId: 'cue-2', rekordboxCueId: 'rb-2', startMs: 1000, comment: 'One' }),
      cue({ editorId: 'y', startMs: 2000, comment: 'Two' }),
    ]);
    expect(await fingerprintImportedLocalCueBaseline(first))
      .toBe(await fingerprintImportedLocalCueBaseline(second));
  });

  it('uses writer-equivalent DjmdCue values for database-anchored imported cue truth', () => {
    const payload = createImportedLocalCueBaselinePayload(document([
      cue({
        family: 'hot', hotCueSlot: 4, pointType: 'loop', startMs: 1000.9, endMs: 5000.9,
        colorTableIndex: 8, isActiveLoop: true, comment: 'Loop',
      }),
    ]));
    expect(payload?.cues).toEqual([expect.objectContaining({
      InMsec: 1000,
      OutMsec: 5000,
      Kind: 5,
      Color: 255,
      ActiveLoop: 1,
      Comment: 'Loop',
    })]);
  });

  it('uses the preserved canonical Memory Cue Color rather than reconstructing it during apply', () => {
    const payload = createImportedLocalCueBaselinePayload(document([
      cue({ colorTableIndex: 5, colorName: 'Aqua', rekordboxColor: 7 }),
    ]));
    expect(payload?.cues[0]).toMatchObject({ Kind: 0, Color: 7, ColorTableIndex: 5 });
  });

  it('blocks comparison for legacy or unsupported imported Memory Cues missing canonical Color metadata', async () => {
    const legacy = document([cue({ rekordboxColor: null })]);
    expect(createImportedLocalCueBaselinePayload(legacy)).toBeNull();
    expect(await fingerprintImportedLocalCueBaseline(legacy)).toBeNull();
  });

  it('blocks comparison when the imported snapshot contains an ANLZ-only cue', async () => {
    const imported = document([
      cue({ importedCueId: 'anlz-only', sourceDbPresent: false, sourceAnlzPresent: true, startMs: 9000 }),
    ]);
    expect(createImportedLocalCueBaselinePayload(imported)).toBeNull();
    expect(await fingerprintImportedLocalCueBaseline(imported)).toBeNull();
  });

  it('changes when a material cue property changes', async () => {
    const base = document([cue()]);
    const moved = document([cue({ startMs: 1001 })]);
    const renamed = document([cue({ comment: 'Renamed' })]);
    expect(await fingerprintImportedLocalCueBaseline(base))
      .not.toBe(await fingerprintImportedLocalCueBaseline(moved));
    expect(await fingerprintImportedLocalCueBaseline(base))
      .not.toBe(await fingerprintImportedLocalCueBaseline(renamed));
  });

  it('returns no comparable baseline when imported DB cue truth conflicts', async () => {
    expect(await fingerprintImportedLocalCueBaseline(document([cue({ sourceConflict: true })]))).toBeNull();
  });

  it('represents a proven zero-cue database snapshot deterministically', async () => {
    const empty = document([]);
    expect(createImportedLocalCueBaselinePayload(empty)).toEqual({ schemaVersion: 1, cues: [] });
    expect(await fingerprintImportedLocalCueBaseline(empty)).toMatch(/^[0-9a-f]{64}$/);
  });
});
