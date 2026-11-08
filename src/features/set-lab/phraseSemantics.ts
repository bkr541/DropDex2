import { mapRawPssiCueSemantic } from '../../lib/music/autoCueStrategy';
import type { PhraseRow } from '../../lib/queries/analysisData';

export type SetLabPhraseType = 'Intro' | 'Build' | 'Drop' | 'Chorus' | 'Verse' | 'Bridge' | 'Outro';

export function setLabPhraseType(label: string | null): SetLabPhraseType | null {
  switch (label?.trim().toLowerCase()) {
    case 'intro': return 'Intro';
    case 'up':
    case 'build': return 'Build';
    case 'down':
    case 'drop': return 'Drop';
    case 'chorus': return 'Chorus';
    case 'bridge': return 'Bridge';
    case 'outro': return 'Outro';
    default: return /^verse(?:[ _-]?[1-6])?$/i.test(label?.trim() ?? '') ? 'Verse' : null;
  }
}

export type SetLabPhraseSemantic =
  | { type: SetLabPhraseType; evidence: 'agrees' | 'imported-label' | 'raw-pssi' }
  | { type: null; evidence: 'pssi-conflict' | 'unmapped' };

/**
 * Importer fixtures (test_phrase_parser.py) and Auto Cue's DJCues fixtures
 * describe different contracts. Withhold semantics for audited disagreements,
 * even when only one representation survives in an older import. Mid/low
 * kind 4 agrees at the coarse Verse level. Verse occurrences are counted
 * from the timeline, independently of PSSI's numbered verse variants.
 */
export function resolveSetLabPhraseSemantic(
  row: Pick<PhraseRow, 'normalized_label' | 'source_mood' | 'source_kind'>,
): SetLabPhraseSemantic {
  const mood = Number(row.source_mood);
  const kind = Number(row.source_kind);
  const label = setLabPhraseType(row.normalized_label);
  const raw = setLabPhraseType(mapRawPssiCueSemantic(row.source_mood, row.source_kind));
  const disputedCode = (mood === 1 && [4, 5, 6, 7].includes(kind))
    || ((mood === 2 || mood === 3) && [3, 5, 6].includes(kind));
  if (disputedCode || (label && raw && label !== raw)) return { type: null, evidence: 'pssi-conflict' };
  if (raw) return { type: raw, evidence: label ? 'agrees' : 'raw-pssi' };
  if (label) return { type: label, evidence: 'imported-label' };
  return { type: null, evidence: 'unmapped' };
}
