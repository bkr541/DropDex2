import { classifyCamelotRelationship } from '../../lib/music/camelot';
import { classifyTempoRelationship, scoreCandidate } from '../../lib/music/similarVibes';
import type { SetLabCandidate, SetLabRecommendation } from './candidateProvider';
import type { ResolvedSetLabSection } from './sectionResolver';

function tempoGap(a: number | null, b: number | null): number | null {
  if (a == null || b == null || !(a > 0 && b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ratio = Math.max(a, b) / Math.min(a, b);
  return Math.min(ratio - 1, Math.abs(ratio / 2 - 1));
}

type ScoringTrack = Pick<SetLabCandidate, 'bpm' | 'camelot_key' | 'genre' | 'label'>;

export function reverseSetLabRecommendation(edge?: SetLabRecommendation): SetLabRecommendation | undefined {
  if (!edge || edge.direction === 'reciprocal') return edge;
  return { ...edge, direction: edge.direction === 'incoming' ? 'outgoing' : 'incoming' };
}

export function scoreSetLabTrackPair(
  parent: ScoringTrack, candidate: ScoringTrack, bpmTolerance: number, edge?: SetLabRecommendation,
) {
  const similar = scoreCandidate({ selected: parent, candidate, bpmTolerance, edge });
  const harmonic = classifyCamelotRelationship(parent.camelot_key, candidate.camelot_key);
  const keyMismatch = harmonic === 'incompatible';
  const tempoMatch = classifyTempoRelationship(parent.bpm, candidate.bpm, bpmTolerance).relationship !== 'none';
  const gap = tempoGap(parent.bpm, candidate.bpm);
  return {
    eligible: !!edge || tempoMatch || (harmonic !== 'unknown' && !keyMismatch),
    keyMismatch,
    severe: gap != null && (gap > 0.12 || (keyMismatch && gap > 0.07)),
    score: similar.recommendationScore - (keyMismatch ? 8 : 0)
      + (gap == null ? 0 : Math.max(-24, 8 - gap * 120)),
    reasons: similar.reasons.map((reason) => reason.label),
  };
}

export type SetLabPairScore = ReturnType<typeof scoreSetLabTrackPair>;

export function setLabWindowWeight(window: ResolvedSetLabSection): number {
  if (window.quality === 'mixed') return -4;
  if (window.cueEvidence) return 10;
  return window.section.phraseType ? 4 : 0;
}

function phraseEnergy(type: string): number {
  if (type === 'Intro' || type === 'Outro') return 0;
  if (type === 'Drop' || type === 'Chorus') return 2;
  return 1;
}

export function scoreSetLabWindowPair(
  left: { endDownbeat: { bpm: number | null }; section: ResolvedSetLabSection['section'] },
  right: { startDownbeat: { bpm: number | null }; section: ResolvedSetLabSection['section'] },
  keyMismatch: boolean,
) {
  const gap = tempoGap(left.endDownbeat.bpm, right.startDownbeat.bpm);
  const a = left.section.phraseType;
  const b = right.section.phraseType;
  const contrast = !!a && !!b && Math.abs(phraseEnergy(a) - phraseEnergy(b)) === 2;
  const phraseScore = a && b ? a === b ? 5 : contrast ? -5 : 1 : 0;
  return {
    score: phraseScore + (gap == null ? 0 : Math.max(-22, 9 - gap * 130)),
    severe: gap != null && (gap > 0.12 || (keyMismatch && gap > 0.07)),
    contrast,
  };
}
