import { describe, expect, it } from 'vitest';
import type { WorkingCue } from '../music/cueEditorState';
import { createCueDraftDocument } from './cueDraftDocument';
import {
  createImportedLocalCueBaselinePayload,
  fingerprintImportedLocalCueBaseline,
  inspectImportedLocalCueBaseline,
} from './localCueBaseline';

function dbEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provisional_cue_family: 'hot',
    point_type: 'cue',
    start_ms: 1000,
    end_ms: null,
    is_active_loop: false,
    color_table_index: 3,
    color_hex: '#112233',
    color_name: 'Blue',
    comment: 'DB comment',
    beat_loop_numerator: null,
    beat_loop_denominator: null,
    ...overrides,
  };
}

function cue(overrides: Partial<WorkingCue> = {}): WorkingCue {
  const sourcePayload = overrides.sourcePayload ?? {
    _dropdex_cue_reconciliation: {
      db: dbEvidence(),
      anlz: { cue_family: 'hot', hot_cue_slot: 1 },
      authority: 'anlz',
      conflict: null,
    },
  };
  return {
    editorId: 'runtime',
    trackId: 'track-1',
    importId: 'import-1',
    importedCueId: 'cue-1',
    rekordboxCueId: 'rb-1',
    dedupeKey: 'db:1',
    family: 'hot',
    hotCueSlot: 1,
    pointType: 'cue',
    startMs: 1000,
    endMs: null,
    colorTableIndex: 3,
    colorHex: '#112233',
    colorName: 'Blue',
    rekordboxColor: null,
    comment: 'DB comment',
    isActiveLoop: false,
    beatLoopNumerator: null,
    beatLoopDenominator: null,
    sourceDbPresent: true,
    sourceAnlzPresent: true,
    sourceConflict: false,
    sourceKind: 'PCO2',
    cueFamilyAuthority: 'anlz',
    sourcePayload,
    rekordboxKind: null,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'imported',
    ...overrides,
    sourcePayload,
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
    const one = dbEvidence({ start_ms: 1000, comment: 'One' });
    const two = dbEvidence({ start_ms: 2000, comment: 'Two' });
    const first = document([
      cue({ editorId: 'a', hotCueSlot: 2, startMs: 9999, sourcePayload: { _dropdex_cue_reconciliation: { db: two } } }),
      cue({ editorId: 'b', importedCueId: 'cue-2', rekordboxCueId: 'rb-2', sourcePayload: { _dropdex_cue_reconciliation: { db: one } } }),
    ]);
    const second = document([
      cue({ editorId: 'x', importedCueId: 'cue-2', rekordboxCueId: 'rb-2', sourcePayload: { _dropdex_cue_reconciliation: { db: one } } }),
      cue({ editorId: 'y', hotCueSlot: 2, startMs: 7777, sourcePayload: { _dropdex_cue_reconciliation: { db: two } } }),
    ]);
    expect(await fingerprintImportedLocalCueBaseline(first))
      .toBe(await fingerprintImportedLocalCueBaseline(second));
  });

  it('uses preserved DB-owned values even when reconciled editor values disagree', () => {
    const payload = createImportedLocalCueBaselinePayload(document([
      cue({
        family: 'hot', hotCueSlot: 4, pointType: 'loop', startMs: 1000, endMs: 5000,
        colorTableIndex: 99, isActiveLoop: true, comment: 'ANLZ/editor value',
        sourcePayload: { _dropdex_cue_reconciliation: { db: dbEvidence({
          point_type: 'loop', start_ms: 1002.9, end_ms: 5002.9, color_table_index: 8,
          is_active_loop: false, comment: 'DB truth',
        }) } },
      }),
    ]));
    expect(payload?.cues).toEqual([{
      InMsec: 1002,
      OutMsec: 5002,
      Kind: 5,
      Color: 255,
      ColorTableIndex: 8,
      ActiveLoop: 0,
      Comment: 'DB truth',
    }]);
  });

  it('preserves imported DB active-loop true separately from loop existence', () => {
    const payload = createImportedLocalCueBaselinePayload(document([
      cue({
        pointType: 'loop', endMs: 3000, isActiveLoop: false,
        sourcePayload: { _dropdex_cue_reconciliation: { db: dbEvidence({
          point_type: 'loop', end_ms: 3000, is_active_loop: true,
        }) } },
      }),
    ]));
    expect(payload?.cues[0]).toMatchObject({ OutMsec: 3000, ActiveLoop: 1 });
  });

  it('keeps Memory DjmdCue.Color separate from ColorTableIndex when raw local Color is proven', () => {
    const payload = createImportedLocalCueBaselinePayload(document([
      cue({
        family: 'memory', hotCueSlot: null, rekordboxColor: 7, colorTableIndex: 99,
        sourcePayload: { _dropdex_cue_reconciliation: { db: dbEvidence({
          provisional_cue_family: 'memory', color_table_index: 5, rekordbox_color: 7,
        }) } },
      }),
    ]));
    expect(payload?.cues[0]).toMatchObject({ Kind: 0, Color: 7, ColorTableIndex: 5 });
  });

  it('blocks comparison when local Memory DjmdCue.Color is not proven by DB evidence', async () => {
    const unresolved = document([cue({
      family: 'memory', hotCueSlot: null, rekordboxColor: 5,
      colorHex: '#00FFFF', colorName: 'Aqua',
      sourcePayload: { _dropdex_cue_reconciliation: { db: dbEvidence({ provisional_cue_family: 'memory' }) } },
    })]);
    expect(createImportedLocalCueBaselinePayload(unresolved)).toBeNull();
    expect(await fingerprintImportedLocalCueBaseline(unresolved)).toBeNull();
  });

  it('blocks comparison for legacy reconciled state that lacks preserved DB evidence', async () => {
    const legacy = document([cue({ sourcePayload: { point_type: 'cue', start_ms: 1000 } })]);
    expect(createImportedLocalCueBaselinePayload(legacy)).toBeNull();
    expect(await fingerprintImportedLocalCueBaseline(legacy)).toBeNull();
  });

  it('blocks comparison when the imported snapshot contains an ANLZ-only or conflicting cue', async () => {
    const anlzOnly = document([cue({ sourceDbPresent: false })]);
    expect(await fingerprintImportedLocalCueBaseline(anlzOnly)).toBeNull();
    expect(await fingerprintImportedLocalCueBaseline(document([cue({ sourceConflict: true })]))).toBeNull();
  });


  it('reports why a provisional cue makes the local baseline non-comparable', () => {
    const result = inspectImportedLocalCueBaseline(document([cue({
      cueFamilyAuthority: 'provisional',
      sourceAnlzPresent: false,
    })]));
    expect(result.payload).toBeNull();
    expect(result.blockingReason).toMatch(/authority is provisional.*ANLZ reconciliation/i);
  });

  it('reports unproven Memory Color instead of collapsing the blocker to null', () => {
    const result = inspectImportedLocalCueBaseline(document([cue({
      family: 'memory', hotCueSlot: null,
      sourcePayload: { _dropdex_cue_reconciliation: { db: dbEvidence({ provisional_cue_family: 'memory' }) } },
    })]));
    expect(result.payload).toBeNull();
    expect(result.blockingReason).toMatch(/Memory Cue Color.*not proven/i);
  });

  it('does not change when only reconciled/editor values change while DB evidence is unchanged', async () => {
    const baseline = document([cue()]);
    const edited = document([cue({ startMs: 2222, comment: 'editor changed', colorTableIndex: 77 })]);
    expect(await fingerprintImportedLocalCueBaseline(baseline))
      .toBe(await fingerprintImportedLocalCueBaseline(edited));
  });

  it('changes when preserved DB-owned evidence changes', async () => {
    const base = document([cue()]);
    const changed = document([cue({
      sourcePayload: { _dropdex_cue_reconciliation: { db: dbEvidence({ comment: 'external DB change' }) } },
    })]);
    expect(await fingerprintImportedLocalCueBaseline(base))
      .not.toBe(await fingerprintImportedLocalCueBaseline(changed));
  });

  it('represents a proven zero-cue database snapshot deterministically', async () => {
    const empty = document([]);
    expect(createImportedLocalCueBaselinePayload(empty)).toEqual({ schemaVersion: 1, cues: [] });
    expect(await fingerprintImportedLocalCueBaseline(empty)).toMatch(/^[0-9a-f]{64}$/);
  });
});
