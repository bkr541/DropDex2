import { describe, expect, it } from 'vitest';
import { resolveSetLabPhraseSemantic } from './phraseSemantics';
import {
  listSetLabSections, resolveInitialSetLabSection, resolveSetLabReplacementSection, snapSetLabSection,
} from './sectionResolver';
import { cue, grid, phrase } from './sectionResolver.testFixtures';

const input = () => ({ beats: grid(), durationMs: 55_000, sourceTag: 'PQTZ' });

describe('Set Lab PSSI semantics', () => {
  // Contrasts importer/tests/test_phrase_parser.py and autoCueStrategy.test.ts.
  it.each([
    ['1', '4', 'chorus'], ['1', '5', 'verse'], ['1', '6', 'bridge'], ['1', '7', 'outro'],
    ['2', '3', 'chorus'], ['2', '5', 'bridge'], ['2', '6', 'outro'],
    ['3', '3', 'chorus'], ['3', '5', 'bridge'], ['3', '6', 'outro'],
  ])('flags disputed raw mood %s kind %s, even without its importer label', (mood, kind, label) => {
    const raw = { source_mood: mood, source_kind: kind };
    const expected = { type: null, evidence: 'pssi-conflict' };
    expect(resolveSetLabPhraseSemantic({ ...raw, normalized_label: label })).toEqual(expected);
    expect(resolveSetLabPhraseSemantic({ ...raw, normalized_label: null })).toEqual(expected);
  });

  it('canonicalizes agreed evidence, legacy labels and raw-only codes', () => {
    expect(resolveSetLabPhraseSemantic({ source_mood: '1', source_kind: '3', normalized_label: 'down' }))
      .toEqual({ type: 'Drop', evidence: 'agrees' });
    expect(resolveSetLabPhraseSemantic({ source_mood: '3', source_kind: '4', normalized_label: 'verse2' }))
      .toEqual({ type: 'Verse', evidence: 'agrees' });
    expect(resolveSetLabPhraseSemantic({ source_mood: '1', source_kind: '2', normalized_label: 'drop' }))
      .toEqual({ type: null, evidence: 'pssi-conflict' });
    expect(resolveSetLabPhraseSemantic({ source_mood: '2', source_kind: '9', normalized_label: null }))
      .toEqual({ type: 'Chorus', evidence: 'raw-pssi' });
    expect(resolveSetLabPhraseSemantic({ source_mood: null, source_kind: null, normalized_label: 'up' }))
      .toEqual({ type: 'Build', evidence: 'imported-label' });
    expect(resolveSetLabPhraseSemantic({ source_mood: null, source_kind: null, normalized_label: 'unknown' }))
      .toEqual({ type: null, evidence: 'unmapped' });
  });
});

describe('Set Lab section windows', () => {
  it.each([[4, 17, 8000], [8, 33, 16000], [16, 65, 28800]] as const)(
    'resolves %i bars with one-based downbeats and actual variable-tempo timestamps',
    (bars, exclusiveBeat, endMs) => {
      const result = snapSetLabSection(input(), 0, bars);
      expect(result).toMatchObject({ ok: true, window: {
        barCount: bars, startDownbeat: { seq: 1, ms: 0 }, endDownbeat: { seq: exclusiveBeat, ms: endMs },
        section: { startBeat: 1, endBeatExclusive: exclusiveBeat, startMs: 0, endMs },
      } });
    },
  );

  it('ignores pickup beats and handles bars defined by actual markers', () => {
    const beats = Array.from({ length: 16 }, (_, i) => ({
      seq: i + 1, srcIdx: i, beatInBar: i % 3 + 1, bar: Math.floor(i / 3) + 1,
      ms: i * 300, bpm: 200, isDownbeat: i % 3 === 0,
    })).slice(1);
    expect(snapSetLabSection({ beats, durationMs: 5000 }, 0, 4)).toMatchObject({
      ok: true, window: { section: { startBeat: 4, endBeatExclusive: 16 } },
    });
  });

  it('requires a stored end downbeat and respects both source and track end limits', () => {
    expect(listSetLabSections({ ...input(), durationMs: 8000 }, 4)).toMatchObject({
      ok: true, windows: [{ section: { endMs: 8000 } }],
    });
    expect(listSetLabSections({ ...input(), durationMs: 7999 }, 4)).toMatchObject({ ok: false, reason: 'no-window' });
    expect(listSetLabSections({ ...input(), mediaDurationMs: 7999 }, 4)).toMatchObject({ ok: false, reason: 'no-window' });
    expect(listSetLabSections({ ...input(), beats: grid(4).slice(0, -1) }, 4))
      .toMatchObject({ ok: false, reason: 'no-window' });
  });

  it('distinguishes absent, estimated and malformed grids', () => {
    expect(listSetLabSections({ ...input(), beats: null })).toMatchObject({ ok: false, reason: 'missing-grid' });
    expect(listSetLabSections({ ...input(), sourceTag: 'PQT2' })).toMatchObject({ ok: false, reason: 'estimated-grid' });
    for (const patch of [{ seq: 0 }, { ms: 0 }, { beatInBar: 1 }, { bar: 0 }, { isDownbeat: true }]) {
      const beats = grid();
      beats[1] = { ...beats[1], ...patch };
      expect(listSetLabSections({ ...input(), beats })).toMatchObject({ ok: false, reason: 'invalid-grid' });
    }
    expect(listSetLabSections({ ...input(), durationMs: null })).toMatchObject({ ok: false, reason: 'invalid-duration' });
    expect(listSetLabSections(input(), 2 as 4)).toMatchObject({ ok: false, reason: 'invalid-bar-count' });
  });

  it('prefers suitable hot or memory cues, keeps exact snap times, and accepts a repeatable RNG', () => {
    const data = {
      ...input(), phrases: [phrase(0, 'verse', 1, 129)],
      cues: [cue('too-far', 'hot', 250), cue('hot', 'hot', 2015), cue('memory', 'memory', 4000),
        { ...cue('conflict', 'hot', 6000), source_conflict: true }],
    };
    expect(resolveInitialSetLabSection(data, 8, () => 0)).toMatchObject({ ok: true, window: {
      section: { startMs: 2000 }, cueEvidence: { id: 'hot', offsetMs: 15 }, quality: 'cue-aligned',
    } });
    expect(resolveInitialSetLabSection(data, 8, () => 0.99)).toMatchObject({
      ok: true, window: { section: { startMs: 4000 }, cueEvidence: { family: 'memory' } },
    });
    expect(() => resolveInitialSetLabSection(data, 8, () => 1)).toThrow(RangeError);
    expect(resolveInitialSetLabSection({ ...data, cues: [] }, 8, () => 0))
      .toMatchObject({ ok: true, window: { quality: 'phrase-aligned' } });
    expect(resolveInitialSetLabSection(input(), undefined, () => 0))
      .toMatchObject({ ok: true, window: { barCount: 8, quality: 'grid-only', phraseId: null, cueEvidence: null } });
  });

  it('resolves phrase sequence before denormalized ms and treats a shared end/start as exclusive', () => {
    const data = { ...input(), phrases: [
      { ...phrase(0, 'down', 1, 33), end_ms: 500 },
      phrase(1, 'up', 33, 65),
    ] };
    expect(snapSetLabSection(data, 0)).toMatchObject({ ok: true, window: {
      phraseId: 'phrase-0', section: { endBeatExclusive: 33, phraseType: 'Drop', phraseOccurrence: 1 },
    } });
    expect(snapSetLabSection(data, 16_000)).toMatchObject({ ok: true, window: {
      phraseId: 'phrase-1', section: { startBeat: 33, phraseType: 'Build', phraseOccurrence: 1 },
    } });
    expect(snapSetLabSection(data, 9100)).toMatchObject({ ok: true, window: {
      quality: 'mixed', phraseId: null, section: { startMs: 10_000, phraseType: null, phraseOccurrence: null },
    } });
    expect(snapSetLabSection(data, 1000)).toMatchObject({ ok: true, window: { section: { startMs: 0 } } });
    expect(snapSetLabSection(data, NaN)).toMatchObject({ ok: false, reason: 'invalid-position' });
  });

  it('keeps contradictory PSSI windows usable and explains the absent semantic identity', () => {
    const data = { ...input(), phrases: [{
      ...phrase(0, 'bridge', 1, 65), source_mood: '1', source_kind: '6',
    }] };
    expect(snapSetLabSection(data, 0)).toMatchObject({ ok: true, window: {
      quality: 'pssi-conflict', explanation: expect.stringContaining('PSSI'), section: { phraseType: null, phraseOccurrence: null },
    } });
  });

  it('uses the known next phrase boundary and handles a terminal PSSI end beyond the stored grid', () => {
    const data = { ...input(), phrases: [
      { ...phrase(0, 'up', 1, 33), end_beat: null },
      phrase(1, 'down', 33, 145),
    ] };
    expect(snapSetLabSection(data, 0)).toMatchObject({ ok: true, window: { section: { phraseType: 'Build' } } });
    expect(snapSetLabSection(data, 55_000)).toMatchObject({ ok: true, window: {
      section: { endBeatExclusive: 129, phraseType: 'Drop' },
    } });
  });
});

describe('Set Lab replacement windows', () => {
  const reference = { phraseType: 'Drop', phraseOccurrence: 2, barCount: 8, relativePosition: 0 } as const;
  const data = () => ({ ...input(), phrases: [phrase(1, 'drop', 65, 129), phrase(0, 'down', 1, 33)] });

  it('preserves the same type and chronological occurrence at the new track’s actual timestamp', () => {
    expect(resolveSetLabReplacementSection(data(), reference)).toMatchObject({ ok: true, match: 'same-occurrence',
      window: { barCount: 8, section: { startBeat: 65, startMs: 28_800, phraseType: 'Drop', phraseOccurrence: 2 } },
    });
  });

  it('falls back to the same type if the target occurrence cannot fit the original bars', () => {
    const target = { ...data(), phrases: [phrase(0, 'down', 1, 65), phrase(1, 'drop', 65, 81)] };
    expect(resolveSetLabReplacementSection(target, reference)).toMatchObject({ ok: true, match: 'same-type',
      explanation: expect.stringContaining('Drop 2 could not fit'), window: { barCount: 8, section: { phraseOccurrence: 1 } },
    });
  });

  it('uses the nearest valid relative location with an explicit fallback when the type is unavailable', () => {
    expect(resolveSetLabReplacementSection(input(), { ...reference, barCount: 4, relativePosition: 0.5 }))
      .toMatchObject({ ok: true, match: 'nearest-window', explanation: expect.stringContaining('No Drop window fits'),
        window: { barCount: 4, section: { startMs: 27_200, phraseType: null } },
      });
  });
});
