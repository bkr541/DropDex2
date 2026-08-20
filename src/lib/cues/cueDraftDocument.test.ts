import { describe, expect, it } from 'vitest';
import type { WorkingCue } from '../music/cueEditorState';
import {
  createCueDraftDocument,
  cueDraftStrategySummary,
  fingerprintCueDraftDocument,
  hydrateCueDraftDocument,
  stableStringify,
} from './cueDraftDocument';

function cue(overrides: Partial<WorkingCue> = {}): WorkingCue {
  return {
    editorId: 'runtime-only',
    trackId: 'track-1',
    importId: 'import-1',
    importedCueId: null,
    rekordboxCueId: null,
    dedupeKey: null,
    family: 'memory',
    hotCueSlot: null,
    pointType: 'cue',
    startMs: 1000,
    endMs: null,
    colorTableIndex: null,
    colorHex: null,
    colorName: null,
    comment: null,
    isActiveLoop: null,
    beatLoopNumerator: null,
    beatLoopDenominator: null,
    sourceDbPresent: false,
    sourceAnlzPresent: false,
    sourceConflict: false,
    sourceKind: 'manual',
    rekordboxKind: null,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'manual',
    ...overrides,
  };
}

const identity = {
  importId: 'import-1',
  trackId: 'track-1',
  rekordboxContentId: 'content-42',
};

describe('cue draft canonical document', () => {
  it('serializes a complete desired set deterministically without runtime editor ids', async () => {
    const first = createCueDraftDocument({
      ...identity,
      cues: [
        cue({ editorId: 'manual-z', startMs: 32000, comment: 'Drop' }),
        cue({
          editorId: 'auto-a',
          family: 'hot',
          hotCueSlot: 1,
          startMs: 8000.0004,
          source: 'auto',
          sourceKind: 'auto',
          semantic: 'intro',
          strategyVersion: 'djcues-stage3-v1',
          strategySettings: { z: 2, a: 1 },
        }),
      ],
    });
    const second = createCueDraftDocument({
      ...identity,
      cues: [
        cue({
          editorId: 'different-runtime-id',
          family: 'hot',
          hotCueSlot: 1,
          startMs: 8000.0004,
          source: 'auto',
          sourceKind: 'auto',
          semantic: 'intro',
          strategyVersion: 'djcues-stage3-v1',
          strategySettings: { a: 1, z: 2 },
        }),
        cue({ editorId: 'another-runtime-id', startMs: 32000, comment: 'Drop' }),
      ],
    });

    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(JSON.stringify(first)).not.toContain('editorId');
    expect(first.cues[0].startMs).toBe(8000);
    expect(await fingerprintCueDraftDocument(first)).toBe(await fingerprintCueDraftDocument(second));
  });

  it('round-trips imported/manual/auto writer-facing fields into working state', () => {
    const document = createCueDraftDocument({
      ...identity,
      cues: [
        cue({
          editorId: 'imported:abc',
          importedCueId: 'abc',
          rekordboxCueId: 'rb-7',
          dedupeKey: 'dedupe',
          family: 'hot',
          hotCueSlot: 2,
          pointType: 'loop',
          startMs: 16000,
          endMs: 20000,
          colorTableIndex: 5,
          colorHex: '#00AEEF',
          colorName: 'Blue',
          comment: 'Loop',
          isActiveLoop: true,
          beatLoopNumerator: 4,
          beatLoopDenominator: 1,
          sourceDbPresent: true,
          sourceAnlzPresent: true,
          sourceConflict: false,
          sourceKind: 'db+anlz',
          rekordboxKind: 0,
          semantic: 'build',
          pairedHotCueSlot: 3,
          strategyVersion: 'v1',
          strategySettings: { mode: 'fill-empty' },
          source: 'auto',
        }),
      ],
    });

    const [hydrated] = hydrateCueDraftDocument(document);
    expect(hydrated).toMatchObject({
      trackId: 'track-1',
      importId: 'import-1',
      importedCueId: 'abc',
      rekordboxCueId: 'rb-7',
      dedupeKey: 'dedupe',
      family: 'hot',
      hotCueSlot: 2,
      pointType: 'loop',
      startMs: 16000,
      endMs: 20000,
      colorTableIndex: 5,
      isActiveLoop: true,
      beatLoopNumerator: 4,
      beatLoopDenominator: 1,
      sourceDbPresent: true,
      sourceAnlzPresent: true,
      sourceKind: 'db+anlz',
      rekordboxKind: 0,
      semantic: 'build',
      pairedHotCueSlot: 3,
      strategyVersion: 'v1',
      strategySettings: { mode: 'fill-empty' },
      source: 'auto',
    });
  });

  it('rejects duplicate Hot Cue ownership and malformed loops', () => {
    expect(() => createCueDraftDocument({
      ...identity,
      cues: [
        cue({ family: 'hot', hotCueSlot: 1 }),
        cue({ family: 'hot', hotCueSlot: 1, startMs: 2000 }),
      ],
    })).toThrow(/Duplicate Hot Cue slot A/);

    expect(() => createCueDraftDocument({
      ...identity,
      cues: [cue({ pointType: 'loop', startMs: 4000, endMs: 3000 })],
    })).toThrow(/Loop cues require/);
  });

  it('summarizes Auto Cue strategy metadata without changing manual/imported cues', () => {
    const document = createCueDraftDocument({
      ...identity,
      cues: [
        cue({ source: 'manual' }),
        cue({
          family: 'hot',
          hotCueSlot: 4,
          source: 'auto',
          strategyVersion: 'stage3-v1',
          strategySettings: { fillEmpty: true },
        }),
      ],
    });
    expect(cueDraftStrategySummary(document)).toEqual({
      version: 'stage3-v1',
      settings: { fillEmpty: true },
    });
  });
});
