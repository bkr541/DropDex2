import type { BeatEntry, BeatGridRow, PhraseRow } from '../queries/analysisData';
import { buildTimelineSections, sectionDisplayLabel, type TimelineSection } from './phraseSections';

/**
 * The "Audio Intelligence" view of one track, built from what the Rekordbox import already stores: its beat grid, phrases and cues.
 * It mirrors the sections of DRMVYZ's Audio Intelligence panel. Sections that need the audio itself (bands, energy, chroma, stems,
 * lyrics, semantics) are not in the Rekordbox data, so they are reported as unavailable instead of being invented.
 */

export interface PositionedPhrase {
  phrase: PhraseRow;
  label: string;
  startMs: number;
  endMs: number;
  startBar: number | null;
  bars: number | null;
}

export interface AudioIntelligence {
  durationMs: number | null;
  beats: BeatEntry[];
  bpm: number | null;
  beatsPerBar: number;
  barCount: number;
  sections: TimelineSection[];
  phrases: PositionedPhrase[];
  fills: Array<{ id: string; ms: number; label: string }>;
}

function beatMs(beatGrid: BeatGridRow | null, seq: number | null): number | null {
  if (seq == null) return null;
  return beatGrid?.beats.find((beat) => beat.seq === seq)?.ms ?? null;
}

function barAt(beatGrid: BeatGridRow | null, ms: number): number | null {
  const beat = beatAt(beatGrid?.beats ?? [], ms);
  return beat?.bar ?? null;
}

/** The last beat at or before this time, or null before the first beat. Beats are in time order. */
export function beatAt(beats: readonly BeatEntry[], ms: number): BeatEntry | null {
  let low = 0;
  let high = beats.length - 1;
  let found: BeatEntry | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (beats[mid].ms <= ms) { found = beats[mid]; low = mid + 1; } else high = mid - 1;
  }
  return found;
}

export function buildAudioIntelligence(input: {
  beatGrid: BeatGridRow | null;
  phrases: readonly PhraseRow[];
  durationMs: number | null;
  trackBpm: number | null;
}): AudioIntelligence {
  const { beatGrid, phrases, durationMs, trackBpm } = input;
  const beats = beatGrid?.beats ?? [];
  const sections = buildTimelineSections([...phrases], beatGrid, durationMs);
  const positioned: PositionedPhrase[] = [];
  phrases.forEach((phrase, index) => {
    const startMs = phrase.start_ms ?? beatMs(beatGrid, phrase.start_beat);
    const endMs = phrase.end_ms ?? beatMs(beatGrid, phrase.end_beat) ?? durationMs;
    if (startMs == null || endMs == null) return;
    const startBeat = beatAt(beats, startMs);
    const endBeat = beatAt(beats, Math.max(startMs, endMs - 1));
    positioned.push({
      phrase,
      label: sectionDisplayLabel(phrase.normalized_label ?? phrase.source_kind, index),
      startMs,
      endMs,
      startBar: startBeat?.bar ?? null,
      bars: startBeat && endBeat ? endBeat.bar - startBeat.bar + 1 : null,
    });
  });
  positioned.sort((a, b) => a.startMs - b.startMs);
  const fills = phrases.flatMap((phrase, index) => {
    const ms = phrase.fill_start_ms ?? beatMs(beatGrid, phrase.fill_start_beat);
    return ms == null ? [] : [{ id: phrase.id, ms, label: `Fill before ${sectionDisplayLabel(phrase.normalized_label ?? phrase.source_kind, index)}` }];
  });
  return {
    durationMs,
    beats,
    bpm: beats.find((beat) => beat.bpm > 0)?.bpm ?? trackBpm,
    beatsPerBar: beats.reduce((most, beat) => Math.max(most, beat.beatInBar), 0) || 4,
    barCount: beatGrid?.bar_count ?? beats.reduce((most, beat) => Math.max(most, beat.bar), 0),
    sections,
    phrases: positioned,
    fills,
  };
}

export interface IntelligenceAt {
  beat: BeatEntry | null;
  /** 0 to 1 through the current beat. */
  beatPhase: number;
  phrase: PositionedPhrase | null;
  phraseProgress: number;
  section: TimelineSection | null;
  sectionProgress: number;
  /** How many sections in the track carry the same name as the current one. */
  sectionRecurrence: number;
}

/** What the track is doing at one moment: its beat, bar, phrase and section. */
export function intelligenceAt(model: AudioIntelligence, ms: number): IntelligenceAt {
  const beat = beatAt(model.beats, ms);
  const next = beat ? model.beats[model.beats.indexOf(beat) + 1] : null;
  const beatPhase = beat && next && next.ms > beat.ms ? Math.min(1, Math.max(0, (ms - beat.ms) / (next.ms - beat.ms))) : 0;
  const phrase = model.phrases.find((item) => ms >= item.startMs && ms < item.endMs) ?? null;
  const section = model.sections.find((item) => ms >= item.startMs && ms < item.endMs) ?? null;
  const progress = (start: number, end: number) => (end > start ? Math.min(1, Math.max(0, (ms - start) / (end - start))) : 0);
  return {
    beat,
    beatPhase,
    phrase,
    phraseProgress: phrase ? progress(phrase.startMs, phrase.endMs) : 0,
    section,
    sectionProgress: section ? progress(section.startMs, section.endMs) : 0,
    sectionRecurrence: section ? model.sections.filter((item) => item.label === section.label).length : 0,
  };
}

export { barAt };

/** One window per bar, from each downbeat to the next, for measuring the audio bar by bar. */
export function barWindows(beats: readonly BeatEntry[], durationMs: number | null): Array<{ barIndex: number; startSec: number; endSec: number }> {
  const downbeats = beats.filter((beat) => beat.isDownbeat || beat.beatInBar === 1);
  const end = durationMs != null ? durationMs / 1000 : (beats[beats.length - 1]?.ms ?? 0) / 1000;
  return downbeats.map((beat, index) => ({
    barIndex: beat.bar || index + 1,
    startSec: beat.ms / 1000,
    endSec: (downbeats[index + 1]?.ms ?? end * 1000) / 1000,
  })).filter((window) => window.endSec > window.startSec);
}
