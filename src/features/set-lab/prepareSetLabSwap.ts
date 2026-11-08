import { durationMsForTrack } from '../../lib/music/trackTiming';
import { fetchTrackBeatGrid, fetchTrackBeatGrids, fetchTrackCues, fetchTrackPhrases, type BeatGridRow } from '../../lib/queries/analysisData';
import type { RekordboxTrack } from '../../types';
import { scoreSetLabWindowPair } from './generationCompatibility';
import { verifySetLabCandidate } from './mediaEligibility';
import { decodeSetLabSource, queueSetLabAudioPreparation } from './prepareSetLabAudio';
import { chooseSetLabReplacementWindow, type ResolvedSetLabSection } from './sectionResolver';
import { SET_LAB_AUDIO_LIMITS, type SetLabSourceDependencies } from './setLabSources';
import type { SetLabAction } from './sessionReducer';
import type { SetLabDraft, SetLabSlot, SetLabTransition } from './session';
import { loadSetLabSwapContext, swapContextKey, swapTrackPair, swapUnavailableReason, type SetLabSwapContext } from './swapCandidates';

function bpmAtBoundary(slot: SetLabSlot, grid: BeatGridRow | undefined, side: 'start' | 'end'): number | null {
  if (grid?.source_tag === 'PQT2' || grid?.track_id !== slot.trackId || !Array.isArray(grid?.beats)) return null;
  const seq = side === 'start' ? slot.section.startBeat : slot.section.endBeatExclusive;
  const ms = side === 'start' ? slot.section.startMs : slot.section.endMs;
  return grid.beats.find((beat) => beat?.seq === seq && beat.ms === ms && beat.isDownbeat)?.bpm ?? null;
}

function swapTransitions(
  draft: SetLabDraft, context: SetLabSwapContext, track: RekordboxTrack, window: ResolvedSetLabSection,
  grids: ReadonlyMap<string, BeatGridRow>,
): SetLabTransition[] {
  const target = draft.selectedSlot;
  return ([1, 2, 3, 4] as const).map((from) => {
    const left = draft.slots[from - 1];
    const right = draft.slots[from];
    const affected = from === target || from + 1 === target;
    const previous = draft.transitions?.[from - 1];
    if (!affected && previous) return previous;

    const leftNew = left.position === target;
    const rightNew = right.position === target;
    const pair = swapTrackPair(context, leftNew ? track : context.tracks.get(left.trackId),
      rightNew ? track : context.tracks.get(right.trackId));
    const leftBpm = leftNew ? window.endDownbeat.bpm : bpmAtBoundary(left, grids.get(left.trackId), 'end');
    const rightBpm = rightNew ? window.startDownbeat.bpm : bpmAtBoundary(right, grids.get(right.trackId), 'start');
    const fit = scoreSetLabWindowPair(
      { endDownbeat: { bpm: leftBpm }, section: leftNew ? window.section : left.section },
      { startDownbeat: { bpm: rightBpm }, section: rightNew ? window.section : right.section },
      pair?.keyMismatch ?? false,
    );
    const caution = !pair?.eligible || pair.severe || fit.severe;
    const reasons = [
      ...(pair?.reasons ?? []),
      leftBpm != null && rightBpm != null ? `Boundary tempos ${leftBpm.toFixed(1)} → ${rightBpm.toFixed(1)} BPM` : null,
      fit.contrast ? 'Contrasting phrase types' : null,
      pair?.keyMismatch ? 'Different Camelot keys' : null,
      caution ? 'Limited compatibility evidence or a large tempo change' : null,
    ].filter(Boolean);
    return { from, score: Math.round((pair?.score ?? 0) + fit.score), caution, explanation: reasons.join(' · ') || 'Track metadata compared' };
  });
}

export async function prepareSetLabSwap(
  { draft, track, context, importDeviceName, signal }: {
    draft: SetLabDraft;
    track: RekordboxTrack;
    context?: SetLabSwapContext | null;
    importDeviceName: string | null;
    signal: AbortSignal;
  },
  sources: SetLabSourceDependencies,
): Promise<{ action: Extract<SetLabAction, { type: 'replace' }>; title: string; notice: string }> {
  signal.throwIfAborted();
  const blocked = swapUnavailableReason(draft, track);
  if (blocked || draft.selectedSlot == null) throw new Error(blocked ?? 'Select a slot before swapping.');
  const position = draft.selectedSlot;
  const slot = draft.slots[position - 1];
  const neighbors = draft.slots.filter((item) => Math.abs(item.position - position) === 1);
  const [analysis, scoring, grids] = await Promise.all([
    (async () => {
      const beatGrid = await fetchTrackBeatGrid(track.id, signal);
      signal.throwIfAborted();
      const [phrases, cues] = beatGrid ? await Promise.all([
        fetchTrackPhrases(track.id, signal).catch(() => []),
        fetchTrackCues(track.id, signal).catch(() => []),
      ]) : [[], []];
      return { beatGrid, phrases, cues };
    })(),
    context?.key === swapContextKey(draft) ? context : loadSetLabSwapContext(draft, signal),
    fetchTrackBeatGrids(neighbors.map(({ trackId }) => trackId), signal).catch(() => new Map<string, BeatGridRow>()),
  ]);
  signal.throwIfAborted();

  // Verify decoded length before choosing a window. The offline decoder leaves
  // the running Set Lab AudioContext and its playhead untouched.
  const verified = await queueSetLabAudioPreparation(() => verifySetLabCandidate({
    scope: draft, track, analysis, barCount: slot.barCount, importDeviceName, signal,
  }, {
    ...sources,
    async probe(media) {
      const context = new OfflineAudioContext(2, 1, SET_LAB_AUDIO_LIMITS.sampleRate);
      const decoded = await decodeSetLabSource(context, media, signal);
      return decoded.length / decoded.sampleRate * 1000;
    },
  }));
  signal.throwIfAborted();
  const title = track.title.trim() || 'Untitled track';
  if (verified.ok === false) {
    throw new Error([`${title} cannot replace slot ${position}. ${verified.explanation}`,
      ...(verified.attempts ?? []).map(({ source, explanation }) => `${source === 'local' ? 'Local' : 'Cloud'}: ${explanation}`)].join(' '));
  }
  const oldDuration = durationMsForTrack(scoring.tracks.get(slot.trackId) ?? null, null);
  const replacement = chooseSetLabReplacementWindow(verified.windows, {
    phraseType: slot.section.phraseType, phraseOccurrence: slot.section.phraseOccurrence, barCount: slot.barCount,
    relativePosition: oldDuration != null && oldDuration > 0 ? slot.section.startMs / oldDuration : undefined,
  });
  if (replacement.ok === false) throw new Error(replacement.explanation);

  const scopedGrids = new Map([...grids].filter(([, grid]) => grid.import_id === draft.sourceImportId));
  const transitions = swapTransitions(draft, scoring, track, replacement.window, scopedGrids);
  const cautions = transitions.filter(({ from, caution }) => caution && (from === position || from + 1 === position));
  const warning = cautions.length ? ` Use caution on ${cautions.map(({ from }) => `${from} → ${from + 1}`).join(' and ')}.` : '';
  return {
    title,
    notice: replacement.explanation + warning,
    action: {
      type: 'replace', base: draft, position, transitions,
      track: {
        trackId: track.id, trackIdentityKey: verified.trackIdentityKey, section: replacement.window.section,
        manuallyPositioned: false, selection: { title, reason: replacement.explanation + warning },
      },
    },
  };
}
