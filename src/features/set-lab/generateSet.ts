import type { SetLabCandidate, SetLabCandidatePool, SetLabPreflight, SetLabRecommendation } from './candidateProvider';
import { reverseSetLabRecommendation, scoreSetLabTrackPair, scoreSetLabWindowPair, setLabWindowWeight, type SetLabPairScore } from './generationCompatibility';
import type { ResolvedSetLabSection } from './sectionResolver';
import {
  DEFAULT_SET_LAB_BAR_COUNT, SET_LAB_POSITIONS,
  type SetLabBarCount, type SetLabDraft, type SetLabFiveSlots, type SetLabPosition, type SetLabSlot, type SetLabTransition,
} from './session';

const PLACEMENT_ORDER = [3, 2, 4, 1, 5] as const;
const TRANSITIONS = [1, 2, 3, 4] as const;

export interface SetLabSearchOptions {
  candidateLimit: number;
  anchorLimit: number;
  maxChecks: number;
  maxBranches: number;
  windowsPerTrack: number;
  temperature: number;
  bpmTolerance: number;
}

const DEFAULT_OPTIONS: SetLabSearchOptions = {
  candidateLimit: 32, anchorLimit: 28, maxChecks: 40, maxBranches: 180,
  windowsPerTrack: 24, temperature: 14, bpmTolerance: 6,
};

type GenerationResult =
  | { ok: true; slots: SetLabFiveSlots; transitions: SetLabTransition[] }
  | { ok: false; explanation: string };

interface Placement {
  track: SetLabCandidate;
  bars: SetLabBarCount;
  windows: readonly ResolvedSetLabSection[];
  fixed?: SetLabSlot;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }
  state ||= 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** A seeded weighted permutation of the shortlist, without retries of the same choice. */
function weightedOrder<T>(items: readonly T[], score: (item: T) => number, random: () => number, temperature: number): T[] {
  return items.map((item) => ({
    item, rank: score(item) / temperature - Math.log(-Math.log(Math.max(Number.EPSILON, random()))),
  })).sort((a, b) => b.rank - a.rank).map(({ item }) => item);
}

function exactWindow(slot: SetLabSlot, window: ResolvedSetLabSection): boolean {
  const a = slot.section;
  const b = window.section;
  return a.startBeat === b.startBeat && a.endBeatExclusive === b.endBeatExclusive
    && a.startMs === b.startMs && a.endMs === b.endMs && slot.barCount === window.barCount;
}

/** Optimize all four adjacent section boundaries together using a bounded set of windows per track. */
function chooseWindows(
  chain: readonly Placement[], pairs: readonly SetLabPairScore[], strict: boolean, random: () => number, limit: number,
): ResolvedSetLabSection[] | null {
  const layers = chain.map(({ fixed, windows }) => fixed ? windows : weightedOrder(windows, setLabWindowWeight, random, 6).slice(0, limit));
  type Step = { score: number; previous: number };
  const steps: Step[][] = [];
  for (let index = 0; index < layers.length; index += 1) {
    steps.push(layers[index].map((window) => {
      const own = setLabWindowWeight(window) + random() * 6;
      if (index === 0) return { score: own, previous: -1 };
      let best = { score: -Infinity, previous: -1 };
      for (let i = 0; i < layers[index - 1].length; i += 1) {
        const pair = scoreSetLabWindowPair(layers[index - 1][i], window, pairs[index - 1].keyMismatch);
        if (strict && pair.severe && !(chain[index - 1].fixed && chain[index].fixed)) continue;
        const score = steps[index - 1][i].score + pair.score + own;
        if (score > best.score) best = { score, previous: i };
      }
      return best;
    }));
  }
  const last = steps[4];
  let best = last.reduce((winner, entry, index) => entry.score > last[winner].score ? index : winner, 0);
  if (!Number.isFinite(last[best].score)) return null;
  const result: ResolvedSetLabSection[] = [];
  for (let index = 4; index >= 0; index -= 1) {
    result.unshift(layers[index][best]);
    best = steps[index][best].previous;
  }
  return result;
}

export async function generateSetLab({
  draft, seed, pool, reroll, options, signal,
}: {
  draft: SetLabDraft;
  seed: string;
  pool: SetLabCandidatePool;
  reroll?: SetLabPosition;
  options?: Partial<SetLabSearchOptions>;
  signal?: AbortSignal;
}): Promise<GenerationResult> {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const { candidateLimit, anchorLimit, maxChecks, maxBranches, windowsPerTrack, temperature, bpmTolerance } = settings;
  if (![candidateLimit, anchorLimit, maxChecks, maxBranches, windowsPerTrack].every((value) => Number.isSafeInteger(value) && value > 0)
    || !(Number.isFinite(temperature) && temperature > 0) || !(Number.isFinite(bpmTolerance) && bpmTolerance >= 0)) {
    throw new Error('Invalid Set Lab search options.');
  }
  signal?.throwIfAborted();
  const fixed = draft.slots.filter((slot) => reroll ? slot.position !== reroll : slot.locked);
  const target = reroll ? draft.slots[reroll - 1] : undefined;
  if (reroll && !target) return { ok: false, explanation: 'Generate a complete set before rerolling a slot.' };
  if (fixed.length === 5) return { ok: false, explanation: 'All five tracks are locked. Unlock a slot to regenerate the set.' };

  const reserved = new Set(fixed.map((slot) => slot.trackIdentityKey));
  if (target) reserved.add(target.trackIdentityKey);
  const candidates = pool.candidates.filter((track) => !reserved.has(track.identity));
  if (new Set(candidates.map((track) => track.identity)).size + fixed.length < 5) {
    return {
      ok: false,
      explanation: reroll ? 'No different track matches the saved generation filters.'
        : 'Fewer than five unique tracks match the generation filters and locks.',
    };
  }

  const placements = new Map<SetLabPosition, Placement>();
  const cache = new Map<string, SetLabPreflight>();
  const edgeCache = new Map<string, ReadonlyMap<string, SetLabRecommendation>>();
  const failures = new Map<string, string>();
  let limited = false;

  async function verify(track: SetLabCandidate, bars: SetLabBarCount) {
    const key = `${track.id}:${bars}`;
    let result = cache.get(key);
    if (!result) {
      if (cache.size >= maxChecks) { limited = true; return null; }
      signal?.throwIfAborted();
      result = await pool.preflight(track, bars);
      signal?.throwIfAborted();
      cache.set(key, result);
      if (result.ok === false) failures.set(track.id, result.explanation);
    }
    return result;
  }

  async function edgesFor(id: string) {
    let edges = edgeCache.get(id);
    if (!edges) {
      signal?.throwIfAborted();
      edges = await pool.recommendations(id);
      signal?.throwIfAborted();
      edgeCache.set(id, edges);
    }
    return edges;
  }

  for (const slot of fixed) {
    const track = pool.tracksById.get(slot.trackId);
    if (!track || track.identity !== slot.trackIdentityKey) {
      return { ok: false, explanation: `Track ${slot.position} is unavailable in the active import.` };
    }
    const result = await verify(track, slot.barCount);
    const window = result?.ok ? result.windows.find((item) => exactWindow(slot, item)) : undefined;
    if (!window) {
      const reason = result?.ok === false ? result.explanation : 'Its original section could not be verified.';
      return { ok: false, explanation: `Track ${slot.position} must stay in place. ${reason}` };
    }
    placements.set(slot.position, { track, bars: slot.barCount, windows: [window], fixed: slot });
  }

  async function complete(strict: boolean, random: () => number): Promise<GenerationResult | null> {
    const chain = SET_LAB_POSITIONS.map((position) => placements.get(position)!);
    const pairs: SetLabPairScore[] = [];
    for (const from of TRANSITIONS) {
      const [parent, child] = from < 3 ? [chain[from], chain[from - 1]] : [chain[from - 1], chain[from]];
      const edges = await edgesFor(parent.track.id);
      const pair = scoreSetLabTrackPair(parent.track, child.track, bpmTolerance, edges.get(child.track.id));
      if (!(parent.fixed && child.fixed) && (!pair.eligible || (strict && pair.severe))) return null;
      pairs.push(pair);
    }
    const windows = chooseWindows(chain, pairs, strict, random, windowsPerTrack);
    if (!windows) return null;

    function slotAt<P extends SetLabPosition>(position: P): SetLabSlot<P> {
      const { track, bars, fixed: previous } = chain[position - 1];
      if (previous) return { ...previous, position };
      const window = windows[position - 1];
      const reason = reroll ? 'Rerolled against the adjacent tracks.' : position === 3
        ? 'Chosen as the anchor.' : `Ranked from Track ${position === 1 ? 2 : position === 5 ? 4 : 3}’s Similar Vibes candidates.`;
      return {
        position, trackId: track.id, trackIdentityKey: track.identity, barCount: bars, section: window.section,
        manuallyPositioned: false, locked: target?.locked ?? false,
        selection: { title: track.title.trim() || 'Untitled track', reason: `${reason} ${window.explanation}` },
      };
    }

    return {
      ok: true, slots: [slotAt(1), slotAt(2), slotAt(3), slotAt(4), slotAt(5)],
      transitions: TRANSITIONS.map((from, i) => {
        const pair = pairs[i];
        const left = windows[i];
        const right = windows[i + 1];
        const fit = scoreSetLabWindowPair(left, right, pair.keyMismatch);
        const caution = pair.severe || fit.severe || !pair.eligible;
        const evidence = [
          ...pair.reasons,
          `Boundary tempos ${left.endDownbeat.bpm.toFixed(1)} → ${right.startDownbeat.bpm.toFixed(1)} BPM`,
          fit.contrast ? 'Contrasting phrase types' : null,
          pair.keyMismatch ? 'Different Camelot keys' : null,
          caution ? 'Limited compatibility evidence or a large tempo change' : null,
        ].filter(Boolean);
        return { from, score: Math.round(pair.score + fit.score), caution, explanation: evidence.join(' · ') };
      }),
    };
  }

  const remaining = (reroll ? [reroll] : PLACEMENT_ORDER).filter((position) => !placements.has(position));
  for (const strict of [true, false]) {
    const random = seededRandom(seed);
    let branches = 0;

    async function search(depth: number): Promise<GenerationResult | null> {
      signal?.throwIfAborted();
      if (depth === remaining.length) return complete(strict, random);

      const position = remaining[depth];
      const neighbors: Array<{ track: SetLabCandidate; edges: ReadonlyMap<string, SetLabRecommendation>; isParent: boolean }> = [];
      for (const adjacent of [position - 1, position + 1] as SetLabPosition[]) {
        const neighbor = placements.get(adjacent);
        if (neighbor) neighbors.push({
          track: neighbor.track, edges: await edgesFor(neighbor.track.id),
          isParent: Math.abs(3 - adjacent) < Math.abs(3 - position),
        });
      }
      const used = new Set([...placements.values()].map(({ track }) => track.identity));
      const ranked = candidates.flatMap((track) => {
        if (used.has(track.identity)) return [];
        const pairs = neighbors.map(({ track: other, edges, isParent }) => isParent
          ? scoreSetLabTrackPair(other, track, bpmTolerance, edges.get(track.id))
          : scoreSetLabTrackPair(track, other, bpmTolerance, reverseSetLabRecommendation(edges.get(track.id))));
        if (pairs.some((pair) => !pair.eligible || (strict && pair.severe))) return [];
        const scores = pairs.map(({ score }) => score);
        const score = scores.length ? (Math.min(...scores) + scores.reduce((sum, value) => sum + value, 0) / scores.length) / 2 : 0;
        return [{ track, score }];
      }).sort((a, b) => b.score - a.score || (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0));
      const limit = position === 3 ? anchorLimit : candidateLimit;
      if (ranked.length > limit) limited = true;
      // An unconstrained anchor is sampled uniformly from the entire import.
      const ordered = neighbors.length
        ? weightedOrder(ranked.slice(0, limit), ({ score }) => score, random, temperature)
        : weightedOrder(ranked, () => 0, random, temperature).slice(0, limit);

      const bars = draft.slots[position - 1]?.barCount ?? DEFAULT_SET_LAB_BAR_COUNT;
      for (const { track } of ordered) {
        if (++branches > maxBranches) { limited = true; return null; }
        const result = await verify(track, bars);
        if (!result?.ok || !result.windows.length) continue;
        placements.set(position, { track, bars, windows: result.windows });
        const generated = await search(depth + 1);
        if (generated?.ok) return generated;
        placements.delete(position);
      }
      return null;
    }

    const generated = await search(0);
    if (generated) return generated;
  }

  const playable = new Set<string>();
  for (const track of pool.tracksById.values()) {
    if (SET_LAB_POSITIONS.some((position) => cache.get(`${track.id}:${draft.slots[position - 1]?.barCount ?? DEFAULT_SET_LAB_BAR_COUNT}`)?.ok)) {
      playable.add(track.identity);
    }
  }
  const eligibility = failures.size > 0
    ? ` ${failures.size} tracks failed the audio or section checks. ${playable.size} unique tracks passed at least one check. ${failures.values().next().value}` : '';
  const bound = limited ? ' The bounded search reached its shortlist or retry limit.' : '';
  return {
    ok: false,
    explanation: (reroll ? 'No different playable track fit the adjacent slots and the saved filters.'
      : 'Could not find five unique playable tracks with compatible adjacent sections.') + eligibility + bound,
  };
}
