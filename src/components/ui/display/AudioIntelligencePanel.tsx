import { useEffect, useState, type ReactNode } from 'react';
import { SineWave } from 'iconoir-react/regular';
import { useOptionalAudioPlayer } from '../../../contexts/AudioPlayerContext';
import { formatTime } from '../../../lib/music/trackTiming';
import { buildAudioIntelligence, intelligenceAt, type AudioIntelligence } from '../../../lib/music/audioIntelligence';
import { BAND_NAMES, barAtTime, indexAt, type AudioFeatureAnalysis } from '../../../lib/audioIntelligence/audioFeatures';
import type { TrackAudioAnalysisState } from '../../../hooks/useTrackAudioAnalysis';
import { ControlButton } from '../controls/ControlButton';
import type { BeatGridRow, CueRow, PhraseRow } from '../../../lib/queries/analysisData';
import './track-details.css';

/**
 * Where the playhead is, in milliseconds, for one track: it follows the audio dock while that track plays or is paused partway, and is
 * null when the track is not the one loaded in the player (or there is no player, as in Layout Lab's standalone window).
 */
export function usePlayheadMs(trackId: string): number | null {
  const player = useOptionalAudioPlayer();
  const isActive = Boolean(player && player.activeTrack?.id === trackId);
  const playing = isActive && Boolean(player?.playIntent);
  const getAudio = player?.getAudioElement;
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!isActive || !getAudio) { setMs(null); return; }
    const read = () => { const audio = getAudio(); setMs(audio ? audio.currentTime * 1000 : null); };
    read();
    if (!playing) return;
    let frame = 0;
    const loop = () => { read(); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [isActive, playing, getAudio]);
  return ms;
}

const UNAVAILABLE = 'Not in the Rekordbox data. It needs the audio analysis.';
const dash = '—';
const seconds = (ms: number | null | undefined) => (ms == null ? dash : `${(ms / 1000).toFixed(3)} s`);

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="td-row"><dt>{label}</dt><dd>{value}</dd></div>;
}
function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="ai-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)}>
      <span>{label}</span><i><b style={{ width: `${Math.round((value ?? 0) * 100)}%` }} /></i><em>{value == null ? dash : `${Math.round(value * 100)}%`}</em>
    </div>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="td-section"><h3 className="td-heading">{title}</h3>{children}</section>;
}
const Unavailable = ({ reason = UNAVAILABLE }: { reason?: string }) => <p className="td-empty">{reason}</p>;

/** Bars for 0-to-1 values; a missing value shows a dash. */
function Bars({ rows }: { rows: Array<[string, number | undefined]> }) {
  return <div className="ai-bars">{rows.map(([label, value]) => <Bar key={label} label={label} value={value == null ? null : value} />)}</div>;
}
const NEEDS_AUDIO = 'Press Analyze audio above to measure this from the track\'s audio.';

function AnalysisControl({ audio }: { audio: NonNullable<AudioIntelligencePanelProps['audio']> }) {
  const { state, onAnalyze } = audio;
  return (
    <div className="ai-analyze">
      {state.status === 'idle' && <><p className="td-empty">Measure the track&apos;s audio to fill Audio Bands, Energy, Measurements and the detected key. It reads the file from your USB.</p><ControlButton variant="secondary" onClick={onAnalyze}>Analyze audio</ControlButton></>}
      {state.status === 'running' && <Bar label={state.step} value={state.progress} />}
      {state.status === 'error' && <><p className="td-error" role="alert">{state.message}</p><ControlButton variant="secondary" onClick={onAnalyze}>Try again</ControlButton></>}
      {state.status === 'ready' && <p className="td-empty">Audio analysed: {state.analysis.bars.length.toLocaleString()} bars measured.</p>}
    </div>
  );
}

export interface AudioIntelligencePanelProps {
  track: { id: string; title: string; artist?: string | null } & Record<string, unknown>;
  beatGrid: BeatGridRow | null;
  phrases: readonly PhraseRow[];
  cues: readonly CueRow[];
  durationMs: number | null;
  /** Where the playhead is. Null shows the track at its start, with no live values. */
  playheadMs: number | null;
  /** The audio measurements and the button that makes them. Left out where the audio cannot be read. */
  audio?: { state: TrackAudioAnalysisState; onAnalyze: () => void };
}

/** The Audio Intelligence window's sections, in DRMVYZ's order, filled from the Rekordbox beat grid, phrases and cues. */
export function AudioIntelligencePanel({ track, beatGrid, phrases, cues, durationMs, playheadMs, audio }: AudioIntelligencePanelProps) {
  const model: AudioIntelligence = buildAudioIntelligence({ beatGrid, phrases, durationMs, trackBpm: typeof track.bpm === 'number' ? track.bpm : null });
  const live = playheadMs != null;
  const at = intelligenceAt(model, playheadMs ?? 0);
  const beat = live ? at.beat : null;
  const period = model.bpm ? 60000 / model.bpm : null;
  const key = (track.musical_key as string | null) || null;
  const camelot = (track.camelot_key as string | null) || null;
  const mode = (track.key_mode as string | null) || null;
  const tonic = (track.key_tonic as string | null) || null;
  const sampleRate = typeof track.sample_rate_hz === 'number' ? track.sample_rate_hz : null;
  const recurrence = at.section ? at.sectionRecurrence : 0;
  const timeSignature = `${model.beatsPerBar}/4`;
  const features: AudioFeatureAnalysis | null = audio?.state.status === 'ready' ? audio.state.analysis : null;
  const sec = (playheadMs ?? 0) / 1000;
  const fi = features ? indexAt(features, sec) : -1;
  const pick = (values: Float32Array | undefined) => (features && fi >= 0 ? values?.[fi] : undefined);
  const bar = features ? barAtTime(features, sec) : null;

  return (
    <div className="ai" data-testid="audio-intelligence">
      <header className="ai-header"><SineWave width={20} height={20} aria-hidden="true" /><span>Audio Intelligence</span></header>
      {!live && <p className="td-empty ai-note">Press play on this track to follow the playhead. The live rows below show the track at its start.</p>}
      {audio && <AnalysisControl audio={audio} />}

      <Group title="Track">
        <dl className="td-rows">
          <Metric label="Track Title" value={track.title} />
          <Metric label="Artist Name" value={track.artist || dash} />
          <Metric label="Length" value={durationMs != null ? formatTime(durationMs) : dash} />
          <Metric label="BPM" value={model.bpm ? String(Math.round(model.bpm)) : dash} />
          <Metric label="Time Signature" value={model.beats.length > 0 ? timeSignature : dash} />
          <Metric label="Key" value={camelot || key || dash} />
          <Metric label="Beats" value={model.beats.length.toLocaleString()} />
          <Metric label="Sections" value={String(model.sections.length)} />
          <Metric label="Sample Rate" value={sampleRate ? `${Math.round(sampleRate).toLocaleString()} Hz` : dash} />
          <Metric label="Position" value={`${formatTime(playheadMs ?? 0)} / ${durationMs != null ? formatTime(durationMs) : dash}`} />
        </dl>
      </Group>

      <Group title="Audio Bands">
        {features ? (
          <>
            <Bars rows={BAND_NAMES.map((name, i) => [name, pick(features.bands[i])])} />
            <p className="ai-sub">Normalized</p>
            <Bars rows={BAND_NAMES.map((name, i) => [name, pick(features.bandsNormalized[i])])} />
          </>
        ) : <Unavailable reason={audio ? NEEDS_AUDIO : UNAVAILABLE} />}
      </Group>

      <Group title="Rhythm">
        <dl className="td-rows">
          <Metric label="BPM" value={(beat?.bpm || model.bpm) ? (beat?.bpm || model.bpm)!.toFixed(2) : dash} />
          <Metric label="Beat" value={beat ? beat.beatInBar : dash} />
          <Metric label="Bar" value={beat ? beat.bar : dash} />
          <Metric label="BPM Source" value="Rekordbox" />
          <Metric label="Beat Index" value={beat ? beat.seq : dash} />
          <Metric label="Beat Event ID" value={beat ? `beat-${beat.seq}` : dash} />
          <Metric label="Beat Event Time" value={beat ? seconds(beat.ms) : dash} />
        </dl>
        <Bar label="Beat Phase" value={beat ? at.beatPhase : null} />
      </Group>

      <Group title="Beat Grid">
        <dl className="td-rows">
          <Metric label="Offset" value={seconds(beatGrid?.first_beat_ms)} />
          <Metric label="Source" value={beatGrid?.source_tag ?? dash} />
          <Metric label="Authority" value={beatGrid ? 'Rekordbox' : dash} />
          <Metric label="Downbeat Phase" value={beatGrid?.first_downbeat_ms != null && beatGrid.first_beat_ms != null && period ? `${Math.round(((beatGrid.first_downbeat_ms - beatGrid.first_beat_ms) / period) % model.beatsPerBar)} beats` : dash} />
          <Metric label="Beat Period" value={period ? `${period.toFixed(1)} ms` : dash} />
          <Metric label="Fallback Reason" value={dash} />
          <Metric label="Stale After BPM Override" value="No" />
          <Metric label="Downbeats" value={beatGrid?.downbeat_count?.toLocaleString() ?? dash} />
          <Metric label="Bars" value={model.barCount ? model.barCount.toLocaleString() : dash} />
          <Metric label="BPM Range" value={beatGrid?.minimum_bpm != null && beatGrid.maximum_bpm != null ? `${beatGrid.minimum_bpm.toFixed(2)} – ${beatGrid.maximum_bpm.toFixed(2)}` : dash} />
          <Metric label="Variable Tempo" value={beatGrid?.is_variable_tempo == null ? dash : beatGrid.is_variable_tempo ? 'Yes' : 'No'} />
        </dl>
      </Group>

      <Group title="Musical Phrases">
        <dl className="td-rows">
          <Metric label="Length" value={at.phrase?.bars != null ? `${at.phrase.bars} bars` : dash} />
          <Metric label="Timestamp" value={at.phrase ? `${formatTime(at.phrase.startMs)} – ${formatTime(at.phrase.endMs)}` : dash} />
          <Metric label="Bar Index" value={at.phrase?.startBar ?? dash} />
          <Metric label="Source" value={at.phrase ? 'Rekordbox' : dash} />
          <Metric label="Structurally Detected" value={at.phrase ? 'No, read from Rekordbox' : dash} />
          <Metric label="Related Section" value={at.section?.label ?? dash} />
          <Metric label="Hierarchy Level" value={at.phrase ? 'Phrase' : dash} />
          <Metric label="Supporting Evidence" value={at.phrase ? [at.phrase.phrase.source_mood, at.phrase.phrase.source_kind, at.phrase.phrase.source_bank].filter(Boolean).join(' · ') || dash : dash} />
        </dl>
        <Bar label="Phrase Progress" value={at.phrase ? at.phraseProgress : null} />
      </Group>

      <Group title="Energy">
        {features ? (
          <>
            <Bars rows={[['Instant', pick(features.energy)], ['Short Term', pick(features.shortTerm)], ['Long Term', pick(features.longTerm)], ['RMS', pick(features.rms)], ['Peak', pick(features.peak)], ['Crest', pick(features.crest)],
              ['Flux', pick(features.flux)], ['Delta', pick(features.delta)], ['Percentile', pick(features.percentile)], ['Complexity', pick(features.complexity)],
              ['Spectral Centroid', pick(features.centroid)], ['Spectral Spread', pick(features.spread)], ['Spectral Rolloff', pick(features.rolloff)], ['Spectral Flatness', pick(features.flatness)]]} />
            <p className="td-empty">Build, Drop and Tension need DRMVYZ&apos;s semantic analysis, which is not part of this panel yet.</p>
          </>
        ) : <Unavailable reason={audio ? NEEDS_AUDIO : UNAVAILABLE} />}
      </Group>
      <Group title="Measurements">
        {features && bar ? (
          <>
            <p className="ai-sub">Bar {bar.barIndex}</p>
            <Bars rows={[['Mean Energy', bar.meanEnergy], ['Peak Energy', bar.peakEnergy], ['Energy Slope', (bar.energySlope + 1) / 2], ['Dynamic Range', bar.dynamicRange], ['Average Bass', bar.bassAverage], ['Average Mid', bar.midAverage],
              ['Average High', bar.highAverage], ['Spectral Flux', bar.spectralFlux], ['Spectral Centroid', bar.spectralCentroid], ['Spectral Complexity', bar.spectralComplexity], ['Overall Transient Density', bar.overallTransientDensity],
              ['Low-frequency Onset Density', bar.lowFrequencyOnsetDensity], ['Mid-frequency Onset Density', bar.midFrequencyOnsetDensity], ['High-frequency Onset Density', bar.highFrequencyOnsetDensity],
              ['Silence Ratio', bar.silenceRatio], ['Harmonic Change', bar.harmonicChange]]} />
            <p className="ai-sub">Chroma Summary</p>
            <Bars rows={['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((name, i): [string, number | undefined] => [name, bar.chromaSummary[i] != null ? Math.min(1, bar.chromaSummary[i] * 3) : undefined])} />
          </>
        ) : <Unavailable reason={audio ? NEEDS_AUDIO : UNAVAILABLE} />}
      </Group>

      <Group title="Section">
        <dl className="td-rows">
          <Metric label="Type" value={at.section ? at.section.sourceLabel || at.section.label : dash} />
          <Metric label="Label" value={at.section?.label ?? dash} />
          <Metric label="Start" value={seconds(at.section?.startMs)} />
          <Metric label="End" value={seconds(at.section?.endMs)} />
          <Metric label="Source" value={at.section ? 'Rekordbox' : dash} />
        </dl>
        <Bar label="Section Progress" value={at.section ? at.sectionProgress : null} />
      </Group>

      <Group title="Section & Structure">
        <dl className="td-rows">
          <Metric label="Section Family" value={at.section?.label ?? dash} />
          <Metric label="Recurrence" value={recurrence ? `${recurrence} in this track` : dash} />
        </dl>
        {model.sections.length === 0 ? <p className="td-empty">No sections.</p> : (
          <ul className="td-list ai-structure">
            {model.sections.map((section) => (
              <li key={section.id} data-current={at.section?.id === section.id ? 'true' : undefined}>
                <span className="td-swatch" style={{ background: section.waveformColor }} aria-hidden="true" />
                <strong>{section.label}</strong>
                <span>{formatTime(section.startMs)} – {formatTime(section.endMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Event Markers">
        {cues.length === 0 && model.fills.length === 0 ? <p className="td-empty">No markers.</p> : (
          <ul className="td-list">
            {[...cues.filter((cue) => cue.start_ms != null).map((cue) => ({ id: cue.id, ms: cue.start_ms as number, label: cue.cue_family === 'hot' ? `Hot cue ${cue.hot_cue_slot != null ? String.fromCharCode(65 + cue.hot_cue_slot) : ''}`.trim() : 'Memory cue', color: cue.color_hex })),
              ...model.fills.map((fill) => ({ ...fill, color: null }))]
              .sort((a, b) => a.ms - b.ms)
              .map((marker) => (
                <li key={marker.id}>
                  <span className="td-swatch" style={{ background: marker.color ?? '#8997AE' }} aria-hidden="true" />
                  <strong>{marker.label}</strong><span>{formatTime(marker.ms)}</span>
                </li>
              ))}
          </ul>
        )}
      </Group>

      <Group title="Harmonic">
        <dl className="td-rows">
          <Metric label="Key" value={key || dash} />
          <Metric label="Camelot" value={camelot || dash} />
          <Metric label="Mode" value={mode || dash} />
          <Metric label="Tonic" value={tonic || dash} />
          <Metric label="Detected Key" value={features?.key.tonic ? `${features.key.tonic} ${features.key.mode}` : dash} />
          <Metric label="Key Confidence" value={features?.key.tonic ? `${Math.round(features.key.confidence * 100)}%` : dash} />
        </dl>
      </Group>

      <Group title="Stems"><Unavailable reason="Needs stem separation, which DropDex runs in Flip Lab, not here." /></Group>
      <Group title="Lyrics"><Unavailable reason="Needs a lyrics transcription, which DropDex does not have." /></Group>
      <Group title="Semantic"><Unavailable reason="Needs DRMVYZ's semantic analysis, which is not part of this panel yet." /></Group>
    </div>
  );
}
