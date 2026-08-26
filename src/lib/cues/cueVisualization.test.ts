import { describe, expect, it } from 'vitest';
import type { WorkingCue } from '../music/cueEditorState';
import { cueLoopRangeGeometry, resolveCueDisplayColor, summarizeCueProvenance } from './cueVisualization';

function cue(overrides: Partial<WorkingCue> = {}): WorkingCue {
  return {
    editorId: 'cue-1',
    trackId: 'track-1',
    importId: 'import-1',
    importedCueId: 'imported-1',
    rekordboxCueId: 'rb-1',
    dedupeKey: 'db:1',
    family: 'hot',
    hotCueSlot: 8,
    pointType: 'cue',
    startMs: 1000,
    endMs: null,
    colorTableIndex: null,
    colorHex: null,
    colorName: null,
    comment: 'Peak',
    isActiveLoop: false,
    beatLoopNumerator: null,
    beatLoopDenominator: null,
    sourceDbPresent: true,
    sourceAnlzPresent: true,
    sourceConflict: false,
    sourceKind: 'PCO2',
    cueFamilyAuthority: 'anlz',
    sourcePayload: null,
    rekordboxKind: 9,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'imported',
    ...overrides,
  };
}

describe('cue visualization contract', () => {
  it('keeps point cues as points and renders exact loop spans', () => {
    expect(cueLoopRangeGeometry(cue(), 0, 10_000)).toBeNull();

    expect(cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: 1000, endMs: 3000 }), 0, 10_000)).toEqual({
      visible: true,
      leftPercent: 10,
      widthPercent: 20,
      startClipped: false,
      endClipped: false,
    });
  });

  it('updates the rendered range directly from draft start/end edits', () => {
    const before = cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: 1000, endMs: 3000 }), 0, 10_000);
    const after = cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: 2000, endMs: 5000 }), 0, 10_000);

    expect(before).toMatchObject({ leftPercent: 10, widthPercent: 20 });
    expect(after).toMatchObject({ leftPercent: 20, widthPercent: 30 });
  });

  it('handles very short, clipped, boundary, and long loops without changing canonical timing', () => {
    const short = cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: 4999, endMs: 5000 }), 0, 10_000);
    expect(short).toMatchObject({ visible: true, leftPercent: 49.99, widthPercent: 0.01 });

    expect(cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: -500, endMs: 2500 }), 0, 10_000)).toEqual({
      visible: true,
      leftPercent: 0,
      widthPercent: 25,
      startClipped: true,
      endClipped: false,
    });

    expect(cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: 7500, endMs: 15_000 }), 0, 10_000)).toEqual({
      visible: true,
      leftPercent: 75,
      widthPercent: 25,
      startClipped: false,
      endClipped: true,
    });

    expect(cueLoopRangeGeometry(cue({ pointType: 'loop', startMs: 0, endMs: 10_000 }), 0, 10_000)).toEqual({
      visible: true,
      leftPercent: 0,
      widthPercent: 100,
      startClipped: false,
      endClipped: false,
    });
  });

  it('keeps overlapping loop geometry independent across viewport changes', () => {
    const first = cueLoopRangeGeometry(cue({ editorId: 'loop-a', pointType: 'loop', startMs: 1000, endMs: 5000 }), 0, 10_000);
    const second = cueLoopRangeGeometry(cue({ editorId: 'loop-b', pointType: 'loop', startMs: 3000, endMs: 7000 }), 0, 10_000);
    const zoomed = cueLoopRangeGeometry(cue({ editorId: 'loop-b', pointType: 'loop', startMs: 3000, endMs: 7000 }), 4000, 6000);

    expect(first).toMatchObject({ leftPercent: 10, widthPercent: 40 });
    expect(second).toMatchObject({ leftPercent: 30, widthPercent: 40 });
    expect(zoomed).toEqual({
      visible: true,
      leftPercent: 0,
      widthPercent: 100,
      startClipped: true,
      endClipped: true,
    });
  });

  it('uses authoritative normalized color before family fallback', () => {
    expect(resolveCueDisplayColor(cue({ colorHex: '#0cf', colorName: 'Imported Cyan' }))).toEqual({
      hex: '#00CCFF',
      label: 'Imported Cyan',
      source: 'canonical-hex',
    });
    expect(resolveCueDisplayColor(cue({ colorName: 'Purple' }))).toMatchObject({ hex: '#a855f7', source: 'canonical-name' });
    expect(resolveCueDisplayColor(cue({ family: 'memory', hotCueSlot: null, rekordboxColor: 5, colorTableIndex: null }))).toEqual({
      hex: '#06b6d4',
      label: 'Aqua',
      source: 'canonical-index',
    });
  });

  it('keeps unsupported imported color metadata distinguishable instead of silently using a family color', () => {
    const unknownIndex = resolveCueDisplayColor(cue({ colorTableIndex: 42 }));
    expect(unknownIndex).toMatchObject({ source: 'unknown', label: 'Rekordbox color index 42' });
    expect(unknownIndex.hex).not.toBe('#238df2');

    expect(resolveCueDisplayColor(cue())).toMatchObject({ source: 'fallback', hex: '#238df2' });
  });

  it('summarizes canonical DB/ANLZ provenance and conflict reason from the reconciler payload', () => {
    const summary = summarizeCueProvenance(cue({
      sourceConflict: true,
      sourcePayload: {
        _dropdex_cue_reconciliation: {
          authority: 'anlz',
          conflict: { reason: 'ambiguous_db_timing_match', candidate_ids: ['a', 'b'] },
        },
      },
    }));

    expect(summary.sources).toBe('DB + ANLZ');
    expect(summary.resolution).toMatch(/did not accept a destructive resolution/i);
    expect(summary.conflict).toMatch(/could not be matched to one unique cue/i);
    expect(summary.blocking).toBe(true);
  });

  it('reports non-conflicting ANLZ authority as the canonical resolution', () => {
    expect(summarizeCueProvenance(cue())).toEqual({
      sources: 'DB + ANLZ',
      resolution: 'ANLZ cue semantics are the canonical resolution.',
      conflict: null,
      blocking: false,
    });
  });
});
