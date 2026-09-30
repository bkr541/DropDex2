import type { FlipLabTimeline } from './flipLabTimeline';

export interface FlipLabEngineLoad {
  timeline: FlipLabTimeline;
  instrumental: AudioBuffer;
  /** Already tempo-stretched vocal; `vocalRate` resamples it for key shift. */
  vocal: AudioBuffer;
  vocalRate: number;
}

const SCHEDULE_LEAD_SEC = 0.03;

export type FlipLabStem = 'vocal' | 'instrumental';
export type FlipLabEqBand = 'low' | 'mid' | 'high';
export type FlipLabStemEq = Record<FlipLabEqBand, number>;
export const FLIP_LAB_EQ_RANGE_DB = 12;

interface DeckChain {
  /** Solo/mute gain feeding the 3-band EQ, then the master volume. */
  input: GainNode;
  eq: Record<FlipLabEqBand, BiquadFilterNode>;
}

/**
 * Two AudioBufferSourceNodes on one transport clock. Each deck starts at its
 * own timeline offset so both first downbeats coincide, and the transport
 * keeps running until the longer deck finishes.
 */
export class FlipLabEngine {
  readonly context: AudioContext;
  private readonly master: GainNode;
  private loaded: FlipLabEngineLoad | null = null;
  private nodes: AudioBufferSourceNode[] = [];
  private generation = 0;
  private originCtxTime = 0;
  private pausedAt = 0;
  private playing = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly decks: Record<FlipLabStem, DeckChain>;
  onEnded: (() => void) | null = null;

  constructor() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.decks = { vocal: this.createDeck(), instrumental: this.createDeck() };
  }

  // Same bands as the earlier Flip Lab mixer: low shelf 180 Hz, peak 1 kHz, high shelf 6 kHz.
  private createDeck(): DeckChain {
    const input = this.context.createGain();
    const low = this.context.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 180;
    const mid = this.context.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1_000;
    mid.Q.value = 0.8;
    const high = this.context.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 6_000;
    input.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(this.master);
    return { input, eq: { low, mid, high } };
  }

  setSolo(solo: FlipLabStem | null): void {
    const now = this.context.currentTime;
    this.decks.vocal.input.gain.setTargetAtTime(solo === 'instrumental' ? 0 : 1, now, 0.01);
    this.decks.instrumental.input.gain.setTargetAtTime(solo === 'vocal' ? 0 : 1, now, 0.01);
  }

  setEq(stem: FlipLabStem, band: FlipLabEqBand, db: number): void {
    const value = Math.max(-FLIP_LAB_EQ_RANGE_DB, Math.min(FLIP_LAB_EQ_RANGE_DB, Number.isFinite(db) ? db : 0));
    this.decks[stem].eq[band].gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }

  get durationSec(): number {
    return this.loaded?.timeline.totalSec ?? 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setVolume(volume: number): void {
    this.master.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), this.context.currentTime);
  }

  load(input: FlipLabEngineLoad, keepPosition = false): void {
    const position = keepPosition ? this.getPosition() : 0;
    const wasPlaying = keepPosition && this.playing;
    this.stopNodes();
    this.playing = false;
    this.loaded = input;
    this.pausedAt = Math.min(position, input.timeline.totalSec);
    if (wasPlaying) void this.play();
  }

  unload(): void {
    this.stopNodes();
    this.playing = false;
    this.loaded = null;
    this.pausedAt = 0;
  }

  getPosition(): number {
    if (!this.loaded) return 0;
    if (!this.playing) return this.pausedAt;
    return Math.max(0, Math.min(this.loaded.timeline.totalSec, this.context.currentTime - this.originCtxTime));
  }

  async play(): Promise<void> {
    if (!this.loaded || this.playing) return;
    if (this.context.state === 'suspended') await this.context.resume();
    const start = this.pausedAt >= this.loaded.timeline.totalSec ? 0 : this.pausedAt;
    this.schedule(start);
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.getPosition();
    this.stopNodes();
    this.playing = false;
  }

  seek(positionSec: number): void {
    if (!this.loaded) return;
    const next = Math.max(0, Math.min(this.loaded.timeline.totalSec, positionSec));
    if (this.playing) {
      this.stopNodes();
      this.schedule(next);
    } else {
      this.pausedAt = next;
    }
  }

  async dispose(): Promise<void> {
    this.unload();
    this.onEnded = null;
    await this.context.close().catch(() => undefined);
  }

  private schedule(positionSec: number): void {
    const loaded = this.loaded;
    if (!loaded) return;
    const { timeline } = loaded;
    const now = this.context.currentTime + SCHEDULE_LEAD_SEC;
    this.originCtxTime = now - positionSec;
    const generation = ++this.generation;

    const startDeck = (deck: GainNode, buffer: AudioBuffer, rate: number, startSec: number, spanSec: number) => {
      if (positionSec >= startSec + spanSec) return;
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = rate;
      node.connect(deck);
      const when = now + Math.max(0, startSec - positionSec);
      const offset = Math.max(0, positionSec - startSec) * rate;
      node.start(when, Math.min(offset, buffer.duration));
      this.nodes.push(node);
    };

    startDeck(this.decks.instrumental.input, loaded.instrumental, 1, timeline.instrumentalStartSec, timeline.instrumentalSpanSec);
    startDeck(this.decks.vocal.input, loaded.vocal, loaded.vocalRate, timeline.vocalStartSec, timeline.vocalSpanSec);
    this.playing = true;

    const remainingMs = Math.max(0, (timeline.totalSec - positionSec) * 1000) + SCHEDULE_LEAD_SEC * 1000 + 50;
    this.endTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.stopNodes();
      this.playing = false;
      this.pausedAt = 0;
      this.onEnded?.();
    }, remainingMs);
  }

  private stopNodes(): void {
    this.generation += 1;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    for (const node of this.nodes) {
      try { node.stop(); } catch { /* not started */ }
      node.disconnect();
    }
    this.nodes = [];
  }
}
