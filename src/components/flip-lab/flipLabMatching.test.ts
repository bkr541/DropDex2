import { describe, expect, it } from 'vitest';
import { applyFlipLabSelection, rankFlipLabSuggestions } from './flipLabMatching';
import { fixtureCandidate } from './flipLabTestFixtures';

describe('Flip Lab suggestions', () => {
  it('has no suggestions until the opposite side has a selection', () => {
    expect(rankFlipLabSuggestions([fixtureCandidate('a')], null, 'vocal')).toEqual([]);
  });

  it('suggests compatible tracks and drops ones more than 5 BPM apart', () => {
    const instrumental = fixtureCandidate('instrumental', { bpm: 140 });
    const suggestions = rankFlipLabSuggestions([
      fixtureCandidate('close', { bpm: 142 }),
      fixtureCandidate('far', { bpm: 150 }),
      fixtureCandidate('clash', { bpm: 140, camelot: '2A' }),
    ], instrumental, 'vocal');
    expect(suggestions.map((c) => c.track.id)).toEqual(['close']);
  });
});

describe('Flip Lab selection', () => {
  it('keeps the opposite side unless the same track is picked for both roles', () => {
    expect(applyFlipLabSelection('vocal', 'a', null, 'b')).toEqual({ vocalId: 'a', instrumentalId: 'b' });
    expect(applyFlipLabSelection('vocal', 'b', null, 'b')).toEqual({ vocalId: 'b', instrumentalId: null });
    expect(applyFlipLabSelection('instrumental', 'a', 'a', null)).toEqual({ vocalId: null, instrumentalId: 'a' });
  });
});
