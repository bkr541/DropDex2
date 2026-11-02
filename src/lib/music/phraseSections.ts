/**
 * Shared phrase-section naming, colors and timeline positioning.
 *
 * Cue Points and Audition both show Rekordbox phrases as named, colored
 * sections. They must use these functions so a section is called, and colored,
 * the same everywhere in the app.
 */

import type { BeatGridRow, PhraseRow } from '../queries/analysisData';

export interface TimelineSection {
  id: string;
  label: string;
  sourceLabel: string;
  startMs: number;
  endMs: number;
  panelColor: string;
  waveformColor: string;
}

function phraseBeatMs(beatGrid: BeatGridRow | null, beatNumber: number | null): number | null {
  if (beatNumber == null) return null;
  const beat = beatGrid?.beats.find((entry) => entry.seq === beatNumber);
  return beat?.ms ?? null;
}

export function sectionDisplayLabel(sourceLabel: string | null, index: number): string {
  switch ((sourceLabel ?? '').toLowerCase()) {
    case 'up': return 'Build';
    case 'down': return 'Drop';
    case 'verse2': return 'Verse 2';
    case 'intro': return 'Intro';
    case 'verse': return 'Verse';
    case 'chorus': return 'Chorus';
    case 'bridge': return 'Bridge';
    case 'outro': return 'Outro';
    default: return sourceLabel
      ? sourceLabel.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
      : `Section ${index + 1}`;
  }
}

export function sectionTone(label: string): { panelColor: string; waveformColor: string } {
  const normalized = label.toLowerCase();
  if (normalized.includes('intro')) return { panelColor: '#16477a', waveformColor: '#2997ff' };
  if (normalized.includes('verse')) return { panelColor: '#503477', waveformColor: '#a868f4' };
  if (normalized.includes('build') || normalized.includes('up')) return { panelColor: '#8d480d', waveformColor: '#ff8614' };
  if (normalized.includes('drop') || normalized.includes('down')) return { panelColor: '#8f2d2f', waveformColor: '#ff514b' };
  if (normalized.includes('chorus')) return { panelColor: '#8a2d61', waveformColor: '#f151a6' };
  if (normalized.includes('bridge')) return { panelColor: '#23656c', waveformColor: '#32c2c8' };
  if (normalized.includes('outro')) return { panelColor: '#3d526a', waveformColor: '#72a1cf' };
  return { panelColor: '#39434f', waveformColor: '#8d9aaa' };
}

export function buildTimelineSections(
  phrases: PhraseRow[],
  beatGrid: BeatGridRow | null,
  durationMs: number | null,
): TimelineSection[] {
  if (durationMs == null || durationMs <= 0) return [];
  const positioned = phrases
    .map((phrase) => ({
      phrase,
      startMs: phrase.start_ms ?? phraseBeatMs(beatGrid, phrase.start_beat),
      endMs: phrase.end_ms ?? phraseBeatMs(beatGrid, phrase.end_beat),
    }))
    .filter((item): item is typeof item & { startMs: number } => item.startMs != null && Number.isFinite(item.startMs))
    .sort((a, b) => a.startMs - b.startMs);

  return positioned.flatMap((item, index) => {
    const nextStart = positioned[index + 1]?.startMs ?? null;
    const startMs = Math.max(0, Math.min(durationMs, item.startMs));
    const rawEnd = item.endMs ?? nextStart ?? durationMs;
    const endMs = Math.max(startMs, Math.min(durationMs, rawEnd));
    if (endMs <= startMs) return [];
    const sourceLabel = item.phrase.normalized_label ?? '';
    const label = sectionDisplayLabel(sourceLabel || null, index);
    const tone = sectionTone(label);
    return [{
      id: item.phrase.id,
      label,
      sourceLabel: sourceLabel || 'unmapped Rekordbox phrase',
      startMs,
      endMs,
      ...tone,
    }];
  });
}
