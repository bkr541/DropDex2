import { useEffect, useMemo, useState } from 'react';
import { CircleDash, Music, Upload, WarningAlt } from '@carbon/icons-react';
import { cn, formatKey } from '../../lib/utils';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useRouteImport } from '../../hooks/useRouteEntities';
import {
  fetchTrackBeatGrid,
  fetchTrackCues,
  fetchTracksCues,
  type BeatEntry,
  type BeatGridRow,
  type CueRow,
} from '../../lib/queries/analysisData';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
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
const MAX_GRID_LINES = 360;

function durationMsForTrack(track: RekordboxTrack | null, beatGrid: BeatGridRow | null): number | null {
  if (!track) return null;
  if (typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms > 0) {
    return track.duration_ms;
  }
  if (typeof track.duration_seconds === 'number' && Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
    return track.duration_seconds * 1000;
  }
  const beats = beatGrid?.beats ?? [];
  const last = beats[beats.length - 1];
  if (!last || !Number.isFinite(last.ms)) return null;
  const beatLength = last.bpm > 0 ? 60_000 / last.bpm : 500;
  return last.ms + beatLength;
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

function gridLines(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_GRID_LINES) return beats;
  const downbeats = beats.filter((beat) => beat.isDownbeat);
  if (downbeats.length <= MAX_GRID_LINES) return downbeats;
  const step = Math.ceil(downbeats.length / MAX_GRID_LINES);
  return downbeats.filter((_, index) => index % step === 0);
}

function CueWaveformPanel({
  track,
  beatGrid,
  cues,
  cueLoading,
  beatGridLoading,
  waveformState,
  onRetryWaveform,
}: {
  track: RekordboxTrack | null;
  beatGrid: BeatGridRow | null;
  cues: CueRow[];
  cueLoading: boolean;
  beatGridLoading: boolean;
  waveformState: WaveformLoadState;
  onRetryWaveform: () => void;
}) {
  const durationMs = durationMsForTrack(track, beatGrid);
  const lines = useMemo(() => gridLines(beatGrid?.beats ?? []), [beatGrid]);
  const positionedCues = useMemo(
    () => cues.filter((cue) => cue.start_ms != null && durationMs != null && durationMs > 0),
    [cues, durationMs],
  );

  if (!track) {
    return (
      <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)]">
        <div className="flex min-h-[310px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Music size={26} />
          </div>
          <h2 className="text-lg font-black">Select a track to inspect cue points</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            The waveform, Rekordbox beat grid, and imported hot and memory cues will appear here.
          </p>
        </div>
      </section>
    );
  }

  const keyDisplay = formatKey(track.musical_key);
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(2) : '—';
  const durationDisplay = formatTime(durationMs);

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

      <div className="px-4 pb-4 pt-3 md:px-5 md:pb-5">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-black/20">
          <RekordboxPreviewWaveform
            state={waveformState}
            height={176}
            variant="detail"
            appearance="rekordbox"
            showCenterLine
            onRetry={onRetryWaveform}
            ariaLabel={`Cue point waveform for ${track.title}`}
            className="rounded-2xl"
          />

          {durationMs != null && durationMs > 0 && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {lines.map((beat) => {
                const left = Math.max(0, Math.min(100, (beat.ms / durationMs) * 100));
                return (
                  <span
                    key={`${beat.seq}-${beat.ms}`}
                    className={cn(
                      'absolute bottom-0 top-0 w-px',
                      beat.isDownbeat ? 'bg-foreground/12' : 'bg-foreground/[0.035]',
                    )}
                    style={{ left: `${left}%` }}
                  />
                );
              })}

              {positionedCues.map((cue, index) => {
                const left = Math.max(0, Math.min(100, ((cue.start_ms ?? 0) / durationMs) * 100));
                const markerColor = cue.color_hex || (cue.cue_family === 'hot' ? '#28d7ff' : '#b788ff');
                return (
                  <span
                    key={cue.id}
                    className="absolute bottom-0 top-0"
                    style={{ left: `${left}%` }}
                  >
                    <span className="absolute bottom-0 top-0 w-px opacity-90" style={{ backgroundColor: markerColor }} />
                    <span
                      className="absolute -translate-x-1/2 rounded-md border px-1.5 py-1 font-mono text-[9px] font-black leading-none text-white shadow-lg"
                      style={{
                        top: `${8 + (index % 2) * 30}px`,
                        backgroundColor: markerColor,
                        borderColor: markerColor,
                      }}
                      title={`${cueDisplayName(cue)} · ${formatTime(cue.start_ms)}`}
                    >
                      {cueLabel(cue)}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 grid grid-cols-5 font-mono text-[9px] text-muted-foreground">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction, index) => (
            <span key={fraction} className={cn(index === 0 ? 'text-left' : index === 4 ? 'text-right' : 'text-center')}>
              {formatTime(durationMs == null ? null : durationMs * fraction)}
            </span>
          ))}
        </div>

        {(cueLoading || cues.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {cueLoading ? (
              <span className="text-xs text-muted-foreground">Loading imported cue points…</span>
            ) : (
              cues.map((cue) => (
                <span
                  key={cue.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs"
                  title={cue.comment ?? undefined}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm border border-white/20"
                    style={{ backgroundColor: cue.color_hex || (cue.cue_family === 'hot' ? '#28d7ff' : '#b788ff') }}
                  />
                  <strong className="font-mono">{cueDisplayName(cue)}</strong>
                  <span className="font-mono text-muted-foreground">{formatTime(cue.start_ms)}</span>
                </span>
              ))
            )}
          </div>
        )}
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
        cueLoading={selectedCueLoading}
        beatGridLoading={beatGridLoading}
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
