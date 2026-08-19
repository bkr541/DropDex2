import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleDash, Music, Upload, WarningAlt } from '@carbon/icons-react';
import { AudioWaveform, Bookmark, Grip, List } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useRouteImport } from '../../hooks/useRouteEntities';
import {
  fetchTrackBeatGrid,
  fetchTrackCues,
  fetchTrackPhrases,
  fetchTracksCues,
  type BeatEntry,
  type BeatGridRow,
  type CueRow,
  type PhraseRow,
} from '../../lib/queries/analysisData';
import { RekordboxPreviewWaveform, type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { ControlButton, SearchControl, SelectControl } from '../ui/controls';
import type { RekordboxTrack } from '../../types';

interface CuePointsViewProps {
  importId: string | null;
  onImport: () => void;
}

type CueFilter = 'all' | 'with-cues' | 'without-cues';
type AnalysisFilter = 'all' | 'ready' | 'incomplete';

const CUE_PAGE_SIZE = 100;
const MAX_TIMELINE_GRID_LINES = 120;
const MAX_BEAT_RULER_TICKS = 480;
const MAX_BAR_LABELS = 20;

interface TimelineSection {
  id: string;
  label: string;
  sourceLabel: string;
  startMs: number;
  endMs: number;
  panelColor: string;
  waveformColor: string;
}

function durationMsForTrack(
  track: RekordboxTrack | null,
  beatGrid: BeatGridRow | null,
  phrases: PhraseRow[] = [],
): number | null {
  if (!track) return null;
  if (typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms > 0) {
    return track.duration_ms;
  }
  if (typeof track.duration_seconds === 'number' && Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
    return track.duration_seconds * 1000;
  }

  const candidates: number[] = [];
  const beats = beatGrid?.beats ?? [];
  const lastBeat = beats[beats.length - 1];
  if (lastBeat && Number.isFinite(lastBeat.ms)) {
    const beatLength = lastBeat.bpm > 0 ? 60_000 / lastBeat.bpm : 500;
    candidates.push(lastBeat.ms + beatLength);
  }
  for (const phrase of phrases) {
    if (phrase.end_ms != null && Number.isFinite(phrase.end_ms)) candidates.push(phrase.end_ms);
    else if (phrase.start_ms != null && Number.isFinite(phrase.start_ms)) candidates.push(phrase.start_ms);
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function formatTime(milliseconds: number | null): string {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function cueLabel(cue: CueRow): string {
  if (cue.cue_family === 'memory') return 'M';
  const slot = cue.hot_cue_slot;
  if (slot != null && slot >= 1 && slot <= 26) return String.fromCharCode(64 + slot);
  return slot != null ? `H${slot}` : 'H';
}

function cueDisplayName(cue: CueRow): string {
  const family = cue.cue_family === 'hot' ? `Hot Cue ${cueLabel(cue)}` : 'Memory Cue';
  return cue.point_type === 'loop' ? `${family} Loop` : family;
}

function cueTimelineLabel(cue: CueRow, memoryIndex: number): string {
  if (cue.cue_family === 'hot') return `Cue ${cueLabel(cue)}`;
  return `Memory ${memoryIndex + 1}`;
}

function analysisReady(track: RekordboxTrack): boolean {
  return track.analysis_parse_status === 'completed' || track.analysis_parse_status === 'reused';
}

function analysisLabel(track: RekordboxTrack): string {
  switch (track.analysis_parse_status) {
    case 'completed': return 'Ready';
    case 'reused': return 'Reused';
    case 'partial': return 'Partial';
    case 'failed': return 'Failed';
    case 'missing_required': return 'Missing';
    case 'parsing': return 'Parsing';
    case 'queued': return 'Queued';
    default: return 'Pending';
  }
}

function timelineGridLines(beats: BeatEntry[]): BeatEntry[] {
  const downbeats = beats.filter((beat) => beat.isDownbeat);
  if (downbeats.length <= MAX_TIMELINE_GRID_LINES) return downbeats;
  const step = Math.ceil(downbeats.length / MAX_TIMELINE_GRID_LINES);
  return downbeats.filter((_, index) => index % step === 0);
}

function beatRulerTicks(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_BEAT_RULER_TICKS) return beats;
  const step = Math.ceil(beats.length / MAX_BEAT_RULER_TICKS);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

function barLabelBeats(beats: BeatEntry[]): BeatEntry[] {
  const downbeats = beats.filter((beat) => beat.isDownbeat);
  if (downbeats.length <= MAX_BAR_LABELS) return downbeats;
  const step = Math.ceil(downbeats.length / MAX_BAR_LABELS);
  return downbeats.filter((_, index) => index % step === 0 || index === downbeats.length - 1);
}

function phraseBeatMs(beatGrid: BeatGridRow | null, beatNumber: number | null): number | null {
  if (beatNumber == null) return null;
  const beat = beatGrid?.beats.find((entry) => entry.seq === beatNumber);
  return beat?.ms ?? null;
}

function sectionDisplayLabel(sourceLabel: string | null, index: number): string {
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

function sectionTone(label: string): { panelColor: string; waveformColor: string } {
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

function buildTimelineSections(
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

function percentageAt(ms: number, durationMs: number): number {
  return Math.max(0, Math.min(100, (ms / durationMs) * 100));
}

function beatPositionLabel(beat: BeatEntry | undefined): string {
  if (!beat) return '—';
  return `${beat.bar}.${beat.beatInBar}.1`;
}

function TimelineLaneLabel({ icon, label, children }: { icon: ReactNode; label: string; children?: ReactNode }) {
  return (
    <div className="flex h-full items-center gap-3 rounded-lg border border-[#25303a] bg-[#111820] px-4 text-[#d7dce2] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <span className="shrink-0 text-[#aab3bd]" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tracking-[-0.01em]">{label}</p>
        {children}
      </div>
    </div>
  );
}

function CueWaveformPanel({
  track,
  beatGrid,
  cues,
  phrases,
  cueLoading,
  beatGridLoading,
  phraseLoading,
  waveformState,
  onRetryWaveform,
}: {
  track: RekordboxTrack | null;
  beatGrid: BeatGridRow | null;
  cues: CueRow[];
  phrases: PhraseRow[];
  cueLoading: boolean;
  beatGridLoading: boolean;
  phraseLoading: boolean;
  waveformState: WaveformLoadState;
  onRetryWaveform: () => void;
}) {
  const durationMs = durationMsForTrack(track, beatGrid, phrases);
  const sections = useMemo(
    () => buildTimelineSections(phrases, beatGrid, durationMs),
    [beatGrid, durationMs, phrases],
  );
  const gridLines = useMemo(() => timelineGridLines(beatGrid?.beats ?? []), [beatGrid]);
  const rulerTicks = useMemo(() => beatRulerTicks(beatGrid?.beats ?? []), [beatGrid]);
  const rulerLabels = useMemo(() => barLabelBeats(beatGrid?.beats ?? []), [beatGrid]);
  const positionedCues = useMemo(
    () => cues.filter((cue) => cue.start_ms != null && durationMs != null && durationMs > 0),
    [cues, durationMs],
  );
  const waveformColorSegments = useMemo<WaveformColorSegment[]>(() => {
    if (durationMs == null || durationMs <= 0) return [];
    return sections.map((section) => ({
      startFraction: section.startMs / durationMs,
      endFraction: section.endMs / durationMs,
      color: section.waveformColor,
    }));
  }, [durationMs, sections]);

  if (!track) {
    return (
      <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)]">
        <div className="flex min-h-[310px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Music size={26} />
          </div>
          <h2 className="text-lg font-black">Select a track to inspect cue points</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Track sections, imported cues, the Rekordbox waveform, and the beat grid will appear in one aligned timeline.
          </p>
        </div>
      </section>
    );
  }

  const keyDisplay = formatKey(track.musical_key);
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(2) : '—';
  const durationDisplay = formatTime(durationMs);
  const firstBeat = beatGrid?.beats[0];

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-muted-foreground">{track.artist ?? 'Artist Not Stored'}</p>
          <h1 className="mt-1 truncate text-xl font-black tracking-tight md:text-2xl">{track.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {[
              ['Beats', beatGridLoading ? '…' : beatGrid ? String(beatGrid.beat_count ?? beatGrid.beats.length) : '—'],
              ['Bars', beatGridLoading ? '…' : beatGrid ? String(beatGrid.bar_count ?? '—') : '—'],
              ['First Beat', beatGridLoading ? '…' : formatTime(beatGrid?.first_beat_ms ?? null)],
              ['First Downbeat', beatGridLoading ? '…' : formatTime(beatGrid?.first_downbeat_ms ?? null)],
            ].map(([label, value]) => (
              <span key={label} className="inline-flex items-baseline gap-1.5">
                <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
                <strong className="font-mono text-[11px] font-black tabular-nums">{value}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 xl:justify-end">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['BPM', bpmDisplay],
              ['Key', keyDisplay],
              ['Duration', durationDisplay],
              ['Cues', cueLoading ? '…' : String(cues.length)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-[88px] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                <span className="block text-[8px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
                <span className="mt-1 block font-mono text-sm font-black tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ControlButton variant="surface" disabled>Auto Cue</ControlButton>
            <ControlButton variant="ghost" disabled>Discard</ControlButton>
            <ControlButton variant="surface" disabled>Save changes</ControlButton>
            <ControlButton variant="primary" disabled title="Cue export will be enabled in the functional integration stage">
              Export to Rekordbox
            </ControlButton>
          </div>
        </div>
      </div>

      <div className="px-3 pb-4 pt-3 md:px-4 md:pb-4">
        <div className="overflow-x-auto rounded-2xl">
          <div className="min-w-[920px] rounded-2xl border border-[#29343e] bg-[#080d12] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_30px_rgba(0,0,0,0.16)]">
            <div className="grid grid-cols-[168px_minmax(0,1fr)] gap-1.5">
              <div className="h-[58px]">
                <TimelineLaneLabel icon={<List size={19} strokeWidth={2.2} />} label="Sections" />
              </div>
              <div className="relative h-[58px] overflow-hidden rounded-lg border border-[#25303a] bg-[#0d1319]">
                {phraseLoading ? (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-[#7f8994]">Loading track sections…</div>
                ) : sections.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-[#7f8994]">No Rekordbox section data</div>
                ) : (
                  sections.map((section, index) => {
                    const left = percentageAt(section.startMs, durationMs ?? 1);
                    const right = percentageAt(section.endMs, durationMs ?? 1);
                    return (
                      <div
                        key={section.id}
                        className="absolute bottom-0 top-0 flex items-center justify-center border-x-2 border-[#080d12] px-3 text-center text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(0.6, right - left)}%`,
                          backgroundColor: section.panelColor,
                          clipPath: index === 0
                            ? 'polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)'
                            : 'polygon(6px 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 6px 100%, 0 50%)',
                        }}
                        title={`${section.label} · ${formatTime(section.startMs)}–${formatTime(section.endMs)} · source ${section.sourceLabel}`}
                      >
                        <span className="truncate">{section.label}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="h-[82px]">
                <TimelineLaneLabel icon={<Bookmark size={19} strokeWidth={2.1} />} label="Cues" />
              </div>
              <div className="relative h-[82px] overflow-hidden rounded-lg border border-[#25303a] bg-[#0d1319]">
                {durationMs != null && durationMs > 0 && gridLines.map((beat) => (
                  <span
                    key={`cue-grid-${beat.seq}`}
                    className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed border-white/[0.075]"
                    style={{ left: `${percentageAt(beat.ms, durationMs)}%` }}
                    aria-hidden="true"
                  />
                ))}
                {cueLoading ? (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-[#7f8994]">Loading cue points…</div>
                ) : positionedCues.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-[#7f8994]">No imported cue points</div>
                ) : (
                  positionedCues.map((cue, index) => {
                    const left = percentageAt(cue.start_ms ?? 0, durationMs ?? 1);
                    const markerColor = cue.color_hex || (cue.cue_family === 'hot' ? '#238df2' : '#9b5de5');
                    const memoryIndex = positionedCues.slice(0, index).filter((item) => item.cue_family === 'memory').length;
                    return (
                      <div
                        key={cue.id}
                        className="absolute top-[20px] z-10 -translate-x-1/2"
                        style={{ left: `${left}%` }}
                        title={`${cueDisplayName(cue)} · ${formatTime(cue.start_ms)}`}
                      >
                        <div
                          className="whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-semibold leading-none text-white shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
                          style={{ backgroundColor: markerColor, borderColor: markerColor }}
                        >
                          {cueTimelineLabel(cue, memoryIndex)}
                        </div>
                        <span
                          className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent"
                          style={{ borderTopColor: markerColor }}
                          aria-hidden="true"
                        />
                        <span
                          className="absolute left-1/2 top-[31px] h-[31px] w-px -translate-x-1/2 opacity-75"
                          style={{ backgroundColor: markerColor }}
                          aria-hidden="true"
                        />
                      </div>
                    );
                  })
                )}
              </div>

              <div className="h-[170px]">
                <TimelineLaneLabel icon={<AudioWaveform size={20} strokeWidth={2.2} />} label="Waveform" />
              </div>
              <div className="relative h-[170px] overflow-hidden rounded-lg border border-[#25303a] bg-[#0b1117]">
                <RekordboxPreviewWaveform
                  state={waveformState}
                  height={168}
                  variant="detail"
                  appearance="rekordbox"
                  showCenterLine={false}
                  surface={false}
                  colorSegments={waveformColorSegments}
                  onRetry={onRetryWaveform}
                  ariaLabel={`Cue point waveform for ${track.title}`}
                  className="absolute inset-x-0 top-0"
                />
                {durationMs != null && durationMs > 0 && (
                  <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                    {gridLines.map((beat) => (
                      <span
                        key={`wave-grid-${beat.seq}`}
                        className="absolute bottom-0 top-0 border-l border-dashed border-white/[0.09]"
                        style={{ left: `${percentageAt(beat.ms, durationMs)}%` }}
                      />
                    ))}
                    {sections.slice(1).map((section) => (
                      <span
                        key={`section-boundary-${section.id}`}
                        className="absolute bottom-0 top-0 w-px bg-white/[0.13]"
                        style={{ left: `${percentageAt(section.startMs, durationMs)}%` }}
                      />
                    ))}
                    {positionedCues.map((cue) => {
                      const markerColor = cue.color_hex || (cue.cue_family === 'hot' ? '#238df2' : '#9b5de5');
                      return (
                        <span
                          key={`wave-cue-${cue.id}`}
                          className="absolute bottom-0 top-0 w-px opacity-65"
                          style={{ left: `${percentageAt(cue.start_ms ?? 0, durationMs)}%`, backgroundColor: markerColor }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="h-[112px]">
                <TimelineLaneLabel icon={<Grip size={19} strokeWidth={2.5} />} label="Beats & Bars">
                  <div className="mt-2 space-y-0.5 font-mono text-[11px] leading-tight text-[#8d98a4]">
                    <p>{beatPositionLabel(firstBeat)}</p>
                    <p>{formatTime(firstBeat?.ms ?? null)}</p>
                  </div>
                </TimelineLaneLabel>
              </div>
              <div className="relative h-[112px] overflow-hidden rounded-lg border border-[#25303a] bg-[#0d1319]">
                {beatGridLoading ? (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-[#7f8994]">Loading beat grid…</div>
                ) : durationMs == null || rulerTicks.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs font-medium text-[#7f8994]">No beat grid available</div>
                ) : (
                  <>
                    {rulerTicks.map((beat) => (
                      <span
                        key={`ruler-${beat.seq}`}
                        className={cn(
                          'absolute top-[28px] -translate-x-1/2 rounded-full bg-[#e7ebef]',
                          beat.isDownbeat ? 'h-8 w-[3px]' : 'h-[18px] w-[2px] opacity-90',
                        )}
                        style={{ left: `${percentageAt(beat.ms, durationMs)}%` }}
                        title={`Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatTime(beat.ms)}`}
                      />
                    ))}
                    {rulerLabels.map((beat) => (
                      <span
                        key={`bar-label-${beat.seq}`}
                        className="absolute bottom-[19px] -translate-x-1/2 font-mono text-[12px] font-medium tabular-nums text-[#9ea7b1]"
                        style={{ left: `${percentageAt(beat.ms, durationMs)}%` }}
                      >
                        {beat.bar}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CuePointsView({ importId, onImport }: CuePointsViewProps) {
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [cueFilter, setCueFilter] = useState<CueFilter>('all');
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [selectedTrack, setSelectedTrack] = useState<RekordboxTrack | null>(null);
  const [selectedCues, setSelectedCues] = useState<CueRow[]>([]);
  const [selectedCueLoading, setSelectedCueLoading] = useState(false);
  const [cueRowsByTrackId, setCueRowsByTrackId] = useState<Map<string, CueRow[]>>(new Map());
  const [cueSummaryLoading, setCueSummaryLoading] = useState(false);
  const [beatGrid, setBeatGrid] = useState<BeatGridRow | null>(null);
  const [beatGridLoading, setBeatGridLoading] = useState(false);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [phraseLoading, setPhraseLoading] = useState(false);

  const selectedTrackId = selectedTrack?.id ?? null;
  const { stats } = useLibraryStats(importId);
  const { data: routeImport } = useRouteImport(importId);
  const usbName = routeImport?.device_name?.trim() || 'USB';
  const {
    tracks,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = useLibraryTracks(importId, {
    search,
    genre: genre || null,
    debounceMs: 220,
    pageSize: CUE_PAGE_SIZE,
  });

  const trackIdsKey = useMemo(() => tracks.map((track) => track.id).join(','), [tracks]);
  useEffect(() => {
    let cancelled = false;
    const trackIds = trackIdsKey ? trackIdsKey.split(',') : [];
    if (!importId || trackIds.length === 0) {
      setCueRowsByTrackId(new Map());
      setCueSummaryLoading(false);
      return;
    }

    setCueSummaryLoading(true);
    void fetchTracksCues(trackIds)
      .then((next) => {
        if (!cancelled) setCueRowsByTrackId(next);
      })
      .catch(() => {
        if (!cancelled) setCueRowsByTrackId(new Map(trackIds.map((id) => [id, []])));
      })
      .finally(() => {
        if (!cancelled) setCueSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [importId, trackIdsKey]);

  const filteredTracks = useMemo(() => tracks.filter((track) => {
    const cueCount = cueRowsByTrackId.get(track.id)?.length ?? 0;
    if (cueFilter === 'with-cues' && cueCount === 0) return false;
    if (cueFilter === 'without-cues' && cueCount > 0) return false;
    if (analysisFilter === 'ready' && !analysisReady(track)) return false;
    if (analysisFilter === 'incomplete' && analysisReady(track)) return false;
    return true;
  }), [analysisFilter, cueFilter, cueRowsByTrackId, tracks]);

  useEffect(() => {
    setSelectedTrack(null);
    setSelectedCues([]);
    setSelectedCueLoading(false);
    setBeatGrid(null);
    setBeatGridLoading(false);
    setPhrases([]);
    setPhraseLoading(false);
  }, [importId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrackId) {
      setSelectedCues([]);
      setSelectedCueLoading(false);
      return;
    }

    setSelectedCues([]);
    setSelectedCueLoading(true);
    void fetchTrackCues(selectedTrackId)
      .then((next) => {
        if (!cancelled) setSelectedCues(next);
      })
      .catch(() => {
        if (!cancelled) setSelectedCues([]);
      })
      .finally(() => {
        if (!cancelled) setSelectedCueLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTrackId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrackId) {
      setBeatGrid(null);
      setBeatGridLoading(false);
      return;
    }
    setBeatGrid(null);
    setBeatGridLoading(true);
    void fetchTrackBeatGrid(selectedTrackId)
      .then((next) => {
        if (!cancelled) setBeatGrid(next);
      })
      .catch(() => {
        if (!cancelled) setBeatGrid(null);
      })
      .finally(() => {
        if (!cancelled) setBeatGridLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTrackId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrackId) {
      setPhrases([]);
      setPhraseLoading(false);
      return;
    }
    setPhrases([]);
    setPhraseLoading(true);
    void fetchTrackPhrases(selectedTrackId)
      .then((next) => {
        if (!cancelled) setPhrases(next);
      })
      .catch(() => {
        if (!cancelled) setPhrases([]);
      })
      .finally(() => {
        if (!cancelled) setPhraseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTrackId]);

  const selectedTrackIds = useMemo(() => selectedTrackId ? [selectedTrackId] : [], [selectedTrackId]);
  const {
    getState: getWaveformState,
    retry: retryWaveform,
  } = useTrackPreviewWaveforms(importId, selectedTrackIds);
  const waveformState = getWaveformState(selectedTrackId);

  if (!importId) {
    return (
      <div className="mx-auto max-w-3xl pt-8">
        <div className="rounded-3xl border border-secondary/20 bg-[var(--color-panel)] p-8 text-center">
          <Music size={48} className="mx-auto mb-4 text-secondary opacity-60" />
          <h2 className="text-2xl font-black">Cue Points</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Import a Rekordbox library to preview waveforms, beat grids, and existing cue points.
          </p>
          <ControlButton variant="primary" className="mt-5" onClick={onImport}>
            <Upload size={16} /> Import library
          </ControlButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 pb-10">
      <CueWaveformPanel
        track={selectedTrack}
        beatGrid={beatGrid}
        cues={selectedCues}
        phrases={phrases}
        cueLoading={selectedCueLoading}
        beatGridLoading={beatGridLoading}
        phraseLoading={phraseLoading}
        waveformState={waveformState}
        onRetryWaveform={() => selectedTrackId && retryWaveform([selectedTrackId])}
      />

      <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] shadow-sm">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black">{usbName}&apos;s Tracks</h2>
                <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {total.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_170px_180px]">
              <SearchControl
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title or artist…"
                aria-label="Search cue point tracks"
              />
              <SelectControl value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Filter tracks by genre">
                <option value="">All genres</option>
                {(stats?.genreTotals ?? []).map((item) => (
                  <option key={item.name} value={item.name}>{item.name} ({item.count})</option>
                ))}
              </SelectControl>
              <SelectControl value={cueFilter} onChange={(event) => setCueFilter(event.target.value as CueFilter)} aria-label="Filter tracks by cue status">
                <option value="all">All cue states</option>
                <option value="with-cues">Has cues</option>
                <option value="without-cues">No cues</option>
              </SelectControl>
              <SelectControl value={analysisFilter} onChange={(event) => setAnalysisFilter(event.target.value as AnalysisFilter)} aria-label="Filter tracks by analysis status">
                <option value="all">All analysis</option>
                <option value="ready">Analysis ready</option>
                <option value="incomplete">Needs analysis</option>
              </SelectControl>
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-red-300">
            <WarningAlt size={20} />
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
            <CircleDash className="animate-spin text-primary" size={22} /> Loading library tracks…
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-bold">No tracks match these filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try clearing a search or filter to widen the library view.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="bg-[var(--color-surface)] text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 md:px-5">Track</th>
                    <th className="px-3 py-3">BPM</th>
                    <th className="px-3 py-3">Key</th>
                    <th className="px-3 py-3">Genre</th>
                    <th className="px-3 py-3 text-center">Cues</th>
                    <th className="px-3 py-3">Analysis</th>
                    <th className="px-4 py-3 text-right md:px-5">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-faint)]">
                  {filteredTracks.map((track) => {
                    const cueCount = cueRowsByTrackId.get(track.id)?.length ?? 0;
                    const selected = track.id === selectedTrackId;
                    return (
                      <tr
                        key={track.id}
                        tabIndex={0}
                        aria-selected={selected}
                        onClick={() => setSelectedTrack(track)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedTrack(track);
                          }
                        }}
                        className={cn(
                          'cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                          selected ? 'bg-primary/[0.08]' : 'hover:bg-[var(--color-surface-hover)]',
                        )}
                      >
                        <td className="max-w-[420px] px-4 py-3 md:px-5">
                          <div className="flex items-center gap-3">
                            <span className={cn('h-8 w-1 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
                            <div className="min-w-0">
                              <p className={cn('truncate text-sm font-bold', selected && 'text-primary')}>{track.title}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{track.artist ?? 'Artist Not Stored'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-md border border-primary/20 bg-primary/[0.07] px-2 py-1 font-mono text-[11px] font-bold text-primary">
                            {formatKey(track.musical_key)}
                          </span>
                        </td>
                        <td className="max-w-[190px] px-3 py-3 text-xs text-muted-foreground"><span className="block truncate">{track.genre ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center">
                          <span className={cn(
                            'inline-flex min-w-8 justify-center rounded-md border px-2 py-1 font-mono text-[10px] font-black',
                            cueCount > 0
                              ? 'border-secondary/25 bg-secondary/10 text-secondary'
                              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground',
                          )}>
                            {cueSummaryLoading ? '…' : cueCount}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={cn(
                            'inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]',
                            analysisReady(track)
                              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                              : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required'
                                ? 'border-red-400/20 bg-red-400/10 text-red-300'
                                : 'border-amber-400/20 bg-amber-400/10 text-amber-300',
                          )}>
                            {analysisLabel(track)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground md:px-5">
                          {formatTime(durationMsForTrack(track, null))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <p className="text-xs text-muted-foreground">
                Showing {filteredTracks.length.toLocaleString()} loaded rows · {total.toLocaleString()} tracks match title/genre filters
              </p>
              {hasMore && (
                <ControlButton variant="surface" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more tracks'}
                </ControlButton>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
