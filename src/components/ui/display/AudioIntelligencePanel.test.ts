import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BeatEntry, BeatGridRow, PhraseRow } from '../../../lib/queries/analysisData';
import { analyzeAudioFeatures } from '../../../lib/audioIntelligence/audioFeatures';
import { AudioIntelligencePanel } from './AudioIntelligencePanel';

const beats: BeatEntry[] = Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, srcIdx: i, beatInBar: (i % 4) + 1, bar: Math.floor(i / 4) + 1, ms: 1000 + i * 500, bpm: 120, isDownbeat: i % 4 === 0 }));
const grid = { id: 'g', import_id: 'i', track_id: 't', source_tag: 'PQTZ', beats, beat_count: 8, downbeat_count: 2, bar_count: 2, first_beat_ms: 1000, first_downbeat_ms: 1000, minimum_bpm: 120, maximum_bpm: 120, is_variable_tempo: false, parser_version: '1' } as BeatGridRow;
const phrases = [{ id: 'p', import_id: 'i', track_id: 't', phrase_index: 0, source_mood: 'high', source_kind: 'down', source_bank: null, normalized_label: 'down', start_beat: null, end_beat: null, start_ms: 1000, end_ms: 5000, fill_start_beat: null, fill_start_ms: null, source_flags: {}, source_payload: {}, parser_version: '1' }] as PhraseRow[];
const track = { id: 't', title: 'Pop Lock', artist: 'Sidequest', bpm: 120, camelot_key: '8A', musical_key: 'Am', key_mode: 'minor', key_tonic: 'A' };

describe('Audio Intelligence panel', () => {
  const render = (playheadMs: number | null) => renderToStaticMarkup(createElement(AudioIntelligencePanel, { track, beatGrid: grid, phrases, cues: [], durationMs: 5000, playheadMs }));

  it('has every section of the DRMVYZ panel, in order', () => {
    const html = render(null);
    const titles = ['Track', 'Audio Bands', 'Rhythm', 'Beat Grid', 'Musical Phrases', 'Energy', 'Measurements', 'Section', 'Section &amp; Structure', 'Event Markers', 'Harmonic', 'Stems', 'Lyrics', 'Semantic'];
    let last = -1;
    for (const title of titles) {
      const at = html.indexOf(`>${title}<`);
      expect(at, title).toBeGreaterThan(last);
      last = at;
    }
  });

  it('follows the playhead through the beat, bar, phrase and section', () => {
    const html = render(3250);
    expect(html).toContain('Drop');
    expect(html).toContain('beat-5');
    expect(html).toContain('Rekordbox');
  });

  it('says plainly which sections need the audio itself', () => {
    expect(render(null)).toContain('Not in the Rekordbox data');
  });

  it('offers to analyse the audio, and fills Audio Bands, Energy, Measurements and the key once it has', async () => {
    const idle = renderToStaticMarkup(createElement(AudioIntelligencePanel, { track, beatGrid: grid, phrases, cues: [], durationMs: 5000, playheadMs: null, audio: { state: { status: 'idle' }, onAnalyze: () => undefined } }));
    expect(idle).toContain('Analyze audio');
    expect(idle).toContain('Press Analyze audio above');
    const rate = 22050;
    const tone = Float32Array.from({ length: rate * 3 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 220 * i / rate));
    const analysis = await analyzeAudioFeatures(tone, rate, { bars: [{ barIndex: 1, startSec: 1, endSec: 3 }] });
    const done = renderToStaticMarkup(createElement(AudioIntelligencePanel, { track, beatGrid: grid, phrases, cues: [], durationMs: 5000, playheadMs: 1500, audio: { state: { status: 'ready', analysis }, onAnalyze: () => undefined } }));
    for (const label of ['Sub', 'Instant', 'Spectral Rolloff', 'Mean Energy', 'Chroma Summary', 'Detected Key']) expect(done).toContain(label);
    expect(done).not.toContain('Press Analyze audio above');
  });
});
