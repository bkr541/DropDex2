import { durationMsForTrack } from '../../lib/music/trackTiming';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { fetchTrackPhrases, type BeatGridRow, type CueRow, type PhraseRow } from '../../lib/queries/analysisData';
import type { RekordboxTrack } from '../../types';
import { verifySetLabCandidate } from './mediaEligibility';
import { decodeSetLabSource, queueSetLabAudioPreparation } from './prepareSetLabAudio';
import { sameSetLabWindow, type ResolvedSetLabSection } from './sectionResolver';
import type { SetLabDraft, SetLabSection, SetLabSlot } from './session';
import type { SetLabAction } from './sessionReducer';
import { SET_LAB_AUDIO_LIMITS, type SetLabSourceDependencies } from './setLabSources';

export interface SetLabRepositionTarget {
  base: SetLabDraft;
  slot: SetLabSlot;
  track: RekordboxTrack;
  grid: BeatGridRow;
  cues: CueRow[];
  importDeviceName: string | null;
}

export interface SetLabRepositionData {
  windows: ResolvedSetLabSection[];
  phrases: PhraseRow[];
  phraseError: boolean;
  trackDurationMs: number;
  waveformDurationMs: number | null;
  mediaDurationMs: number;
}

async function verify(
  { base, slot, track, grid, cues, importDeviceName }: SetLabRepositionTarget,
  phrases: PhraseRow[], sources: SetLabSourceDependencies, signal: AbortSignal, requiredSection?: SetLabSection,
) {
  signal.throwIfAborted();
  if (track.id !== slot.trackId || trackIdentityKey(track) !== slot.trackIdentityKey) {
    throw new Error('The saved slot no longer matches this Rekordbox track.');
  }
  const input = { scope: base, track, analysis: { beatGrid: grid, cues, phrases }, barCount: slot.barCount,
    importDeviceName, signal, requiredSection };
  const result = requiredSection
    ? await queueSetLabAudioPreparation(() => verifySetLabCandidate(input, {
      ...sources,
      async probe(media) {
        signal.throwIfAborted();
        const context = new OfflineAudioContext(2, 1, SET_LAB_AUDIO_LIMITS.sampleRate);
        const decoded = await decodeSetLabSource(context, media, signal, { requiredEndMs: requiredSection.endMs });
        return decoded.length / decoded.sampleRate * 1000;
      },
    }))
    : await verifySetLabCandidate(input, sources);
  signal.throwIfAborted();
  if (result.ok === false) {
    throw new Error([result.explanation, ...(result.attempts ?? []).map(({ source, explanation }) =>
      `${source === 'local' ? 'Local' : 'Cloud'}: ${explanation}`)].join(' '));
  }
  return result;
}

/** Load analysis and probe just this track. Moving the frame never decodes audio. */
export async function loadSetLabReposition(target: SetLabRepositionTarget, sources: SetLabSourceDependencies, signal: AbortSignal):
Promise<SetLabRepositionData> {
  signal.throwIfAborted();
  let phraseError = false;
  const phrases = await fetchTrackPhrases(target.track.id, signal).catch(() => {
    signal.throwIfAborted();
    phraseError = true;
    return [];
  });
  let result = await verify(target, phrases, sources, signal);
  const waveformDurationMs = durationMsForTrack(target.track, null);
  const gridEnd = target.grid.beats.at(-1)?.ms ?? 0;
  if (result.source.kind === 'local' && target.grid.beats.some(({ isDownbeat, ms }) =>
    isDownbeat && ms > result.source.durationMs && ms <= (waveformDurationMs ?? gridEnd))) {
    // Check cloud only if it could extend the playable range past a local file.
    const cloud = await verify(target, phrases, { ...sources, usb: { ...sources.usb, status: 'unavailable' } }, signal)
      .catch(() => { signal.throwIfAborted(); return null; });
    if (cloud && cloud.windows.length > result.windows.length) result = cloud;
  }
  const mediaDurationMs = result.source.durationMs;
  const trackDurationMs = waveformDurationMs ?? Math.max(mediaDurationMs, gridEnd);
  return { windows: result.windows, phrases, phraseError, trackDurationMs, waveformDurationMs, mediaDurationMs };
}

/** Resolve fresh authorized media and prepare only a complete, unchanged window for commit. */
export async function prepareSetLabReposition(
  target: SetLabRepositionTarget, data: SetLabRepositionData, proposed: ResolvedSetLabSection,
  sources: SetLabSourceDependencies, signal: AbortSignal,
): Promise<Extract<SetLabAction, { type: 'reposition' }>> {
  signal.throwIfAborted();
  const { slot, base, track } = target;
  if (proposed.barCount !== slot.barCount || !data.windows.includes(proposed)) {
    throw new Error('Choose a complete section on this track’s beat grid.');
  }
  const result = await verify(target, data.phrases, sources, signal, proposed.section);
  const window = result.windows.find(({ section }) => sameSetLabWindow(section, proposed.section));
  if (!window) throw new Error('The selected section is no longer playable. Choose another downbeat.');
  return {
    type: 'reposition', base, position: slot.position, section: window.section,
    selection: { title: track.title.trim() || 'Untitled track', reason: window.explanation },
  };
}

/** A fixed 40% frame with true time on either side. Blank space beyond the track stays blank. */
export function setLabRepositionViewport({ startMs, endMs }: SetLabSection, trackDurationMs: number) {
  const spanMs = (endMs - startMs) / 0.4;
  const originMs = startMs - spanMs * 0.3;
  return {
    spanMs, originMs,
    visible: { startMs: Math.max(0, originMs), endMs: Math.min(trackDurationMs, originMs + spanMs) },
    percent: (ms: number) => (ms - originMs) / spanMs * 100,
  };
}
