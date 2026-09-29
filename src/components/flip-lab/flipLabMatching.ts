import { rankRouletteCandidates, type RouletteCandidateAnalysis, type RouletteSourceRole } from '../../features/roulette/rouletteMatching';

export interface FlipLabSelectionIds {
  vocalId: string | null;
  instrumentalId: string | null;
}

export function rankFlipLabSuggestions(
  candidates: RouletteCandidateAnalysis[],
  opposite: RouletteCandidateAnalysis | null,
  role: RouletteSourceRole,
): RouletteCandidateAnalysis[] {
  if (!opposite) return [];
  return rankRouletteCandidates(
    candidates,
    { track: opposite.track, beatGrid: opposite.beatGrid },
    role,
  ).map((entry) => entry.candidate);
}

export function applyFlipLabSelection(
  role: RouletteSourceRole,
  trackId: string,
  currentVocalId: string | null,
  currentInstrumentalId: string | null,
): FlipLabSelectionIds {
  if (role === 'vocal') {
    return {
      vocalId: trackId,
      instrumentalId: currentInstrumentalId === trackId ? null : currentInstrumentalId,
    };
  }
  return {
    vocalId: currentVocalId === trackId ? null : currentVocalId,
    instrumentalId: trackId,
  };
}
