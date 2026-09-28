import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import {
  getRoulettePairHardFilterReason,
  rankRouletteCandidates,
  rankRoulettePairsBounded,
  ROULETTE_DIRECT_BPM_TOLERANCE,
  type RouletteCandidateAnalysis,
  type RouletteHardFilterReason,
} from '../../features/roulette/rouletteMatching';

export interface FlipLabPairSelection {
  vocal: RouletteCandidateAnalysis;
  instrumental: RouletteCandidateAnalysis;
}

export interface FlipLabSelectionIds {
  vocalId: string | null;
  instrumentalId: string | null;
}

export function chooseInitialFlipLabPair(
  vocals: RouletteCandidateAnalysis[],
  instrumentals: RouletteCandidateAnalysis[],
): FlipLabPairSelection | null {
  const pair = rankRoulettePairsBounded(vocals, instrumentals)[0] ?? null;
  return pair ? { vocal: pair.vocal, instrumental: pair.instrumental } : null;
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

export function getFlipLabPairRejectionReason(
  vocal: RouletteCandidateAnalysis | null,
  instrumental: RouletteCandidateAnalysis | null,
): RouletteHardFilterReason | null {
  if (!vocal || !instrumental) return null;
  return getRoulettePairHardFilterReason(vocal, instrumental);
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

export function flipLabRejectionReasonLabel(reason: RouletteHardFilterReason | null): string | null {
  switch (reason) {
    case null: return null;
    case 'same-parent-track': return 'The same track cannot fill both roles.';
    case 'key-mismatch': return 'Keys are not compatible with Roulette matching rules.';
    case 'missing-key': return 'One or both tracks are missing usable key data.';
    case 'tempo-mismatch': return `BPM difference is outside the ±${ROULETTE_DIRECT_BPM_TOLERANCE} BPM range.`;
    case 'missing-bpm': return 'One or both tracks are missing usable BPM data.';
    case 'source-unavailable': return 'Source media is unavailable for one or both tracks.';
    case 'variable-tempo': return 'Variable-tempo tracks are not eligible for this pairing.';
    case 'missing-beat-grid': return 'One or both tracks are missing a usable beat grid.';
    case 'wrong-stem-type': return 'The prepared stem does not match the selected role.';
    case 'invalid-parent-track': return 'Track identity data is incomplete.';
    case 'excluded-parent-track': return 'This track is unavailable for the selected role.';
  }
}
