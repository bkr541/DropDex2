import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Lock, LockSlash, Minus, Plus, Refresh } from 'iconoir-react/regular';
import { TrackTimeline } from '../../components/ui/media/TrackTimeline';
import { timeRulerTicks, formatClock } from '../../components/audition/auditionTracks';
import { ContextMenu, ControlButton, IconControlButton, SelectControl } from '../../components/ui/controls';
import { WaveformCueMarker } from '../../components/ui/media/WaveformCueMarker';
import { useDropLabDetailWaveform } from '../../hooks/useDropLabDetailWaveform';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { waveformSectionInk } from '../../components/ui/media/waveformPresentation';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import type { BeatGridRow, CueRow } from '../../lib/queries/analysisData';
import { loadingWaveformState, type WaveformLoadState } from '../../lib/queries/waveformValidation';
import { cn } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';
import type { SetLabBarCount, SetLabFiveSlots, SetLabPosition, SetLabScope, SetLabSlot } from './session';
import { layoutSetLabTimeline, setLabBeatMarkers, setLabCueMarkers, sliceSetLabClipWaveform } from './timelineGeometry';
import { useSetLabTimelineData, type SetLabTimelineData } from './useSetLabTimelineData';
import { SetLabPlayhead, SetLabTransport } from './SetLabTransport';
import type { SetLabPreview } from './useSetLabPreview';

export interface SetLabClipAnalysis {
  track: RekordboxTrack;
  grid: BeatGridRow;
  cues: CueRow[];
}

interface TimelineActions {
  onSelect: (slot: SetLabPosition) => void;
  onLock: (slot: SetLabSlot) => void;
  onReroll: (slot: SetLabPosition) => void;
  onBars: (slot: SetLabSlot, bars: SetLabBarCount, analysis: SetLabClipAnalysis) => void;
  onReposition: (slot: SetLabSlot, analysis: SetLabClipAnalysis, trigger: HTMLElement) => void;
  renderReposition?: (position: SetLabPosition, waveform: WaveformLoadState) => ReactNode;
}

const BAR_COUNTS = [4, 8, 16] as const;

function SetLabClip({
  slot, durationMs, offsetMs, importId, selected, busy, selectionDisabled, editDisabled, data, preview, retryWaveform, actions, playback,
}: {
  slot: SetLabSlot;
  durationMs: number;
  offsetMs: number;
  importId: string;
  selected: boolean;
  busy: boolean;
  selectionDisabled: boolean;
  editDisabled: boolean;
  data: SetLabTimelineData;
  preview: WaveformLoadState;
  retryWaveform: () => void;
  actions: TimelineActions;
  playback: SetLabPreview;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; trigger: HTMLButtonElement } | null>(null);
  const track = data.status === 'ready' ? data.tracks.get(slot.trackId) ?? null : null;
  const grid = data.status === 'ready' ? data.grids.get(slot.trackId) ?? null : null;
  const cueState = data.status === 'ready' ? data.cues.get(slot.trackId) : null;
  const cues = useMemo(() => cueState?.status === 'loaded-with-cues'
    ? cueState.cues.filter((cue) => cue.import_id === importId && cue.track_id === slot.trackId)
    : [], [cueState, importId, slot.trackId]);
  const detail = useDropLabDetailWaveform(selected && track ? importId : null, selected && track ? slot.trackId : null, preview);
  const markers = useMemo(() => setLabCueMarkers(cues, slot.section), [cues, slot.section]);
  const ruler = useMemo(() => setLabBeatMarkers(slot, grid), [slot, grid]);
  const useDetail = selected && detail.detailState.status === 'loaded' && detail.detailState.trackId === slot.trackId;
  const display = useDetail ? detail.detailState : preview;
  // Rekordbox waveform columns are normalized to the original track length.
  // An inferred beat-grid endpoint cannot establish where the last column lies.
  const waveform = useMemo(() => sliceSetLabClipWaveform(
    display, slot.section, durationMsForTrack(track, null),
  ), [display, slot.section, track]);
  const title = track?.title || slot.selection?.title || `Track ${slot.position}`;
  const phrase = slot.section.phraseType
    ? `${slot.section.phraseType}${slot.section.phraseOccurrence ? ` ${slot.section.phraseOccurrence}` : ''}`
    : 'Unclassified section';
  const ink = waveformSectionInk(slot.section.phraseType ?? '');
  const ready = !!(track && grid && ruler);
  const clipUnavailable = data.status === 'ready' && !track;
  const cueError = data.status === 'ready' && track && (!cueState || cueState.status === 'failed');
  const beatMessage = data.status === 'loading' ? 'Loading beat grid…'
    : !track || (data.status === 'ready' && data.gridError) ? 'Beat grid unavailable'
      : grid ? 'Saved section no longer matches the beat grid' : 'No Rekordbox beat grid';
  const detailStatus = selected && detail.detailState.trackId === slot.trackId ? detail.detailState.status : null;
  const waveformQuality = waveform.status === 'loaded' ? useDetail ? 'Detailed waveform'
    : detailStatus === 'loading' ? 'Preview waveform · Loading detail…'
      : detailStatus === 'error' || detailStatus === 'invalid' ? 'Preview waveform · Detail could not load'
        : detailStatus === 'unavailable' ? 'Preview waveform · Detail unavailable' : 'Preview waveform'
    : waveform.status === 'loading' ? 'Loading waveform…' : null;

  const canReposition = !!(selected && !busy && track && grid);
  function showMenu(event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) {
    if (!canReposition) return;
    event.preventDefault();
    const trigger = event.currentTarget;
    const bounds = trigger.getBoundingClientRect();
    setMenu({
      trigger, x: 'clientX' in event && event.clientX ? event.clientX : bounds.left,
      y: 'clientY' in event && event.clientY ? event.clientY : bounds.bottom,
    });
  }

  const menuHandlers = selected ? {
    onContextMenu: showMenu,
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(event);
    },
  } : {};

  function reposition(trigger: HTMLElement) {
    if (canReposition && track && grid) actions.onReposition(slot, { track, grid, cues }, trigger);
  }

  return (
    <li
      data-set-slot={slot.position} data-selected={selected} data-clip-duration-ms={durationMs} data-clip-offset-ms={offsetMs}
      className={cn('relative min-w-0 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-[var(--color-border-subtle)] last:after:hidden',
        selected ? 'bg-primary/[0.08] shadow-[inset_0_2px_var(--color-primary)]' : 'bg-[var(--color-surface)]/20')}
    >
      <div className="flex min-w-0 items-center gap-1 px-2 pt-2">
        <button type="button" aria-pressed={selected} aria-label={`Select slot ${slot.position}, ${title}`}
          title={title} disabled={selectionDisabled} onClick={() => actions.onSelect(slot.position)} {...menuHandlers}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className={cn('shrink-0 font-mono text-[10px] font-bold tabular-nums', selected ? 'text-primary' : 'text-muted-foreground')}>
            {String(slot.position).padStart(2, '0')}
          </span>
          <span className="truncate text-xs font-bold">{title}</span>
        </button>
        <IconControlButton label={`Lock slot ${slot.position}`} aria-pressed={slot.locked} disabled={busy}
          onClick={() => actions.onLock(slot)}
          title={slot.locked ? 'Unlock slot' : 'Lock slot'}>
          {slot.locked ? <Lock width={15} height={15} aria-hidden="true" /> : <LockSlash width={15} height={15} aria-hidden="true" />}
        </IconControlButton>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-1 px-3 pb-1 text-[10px] text-muted-foreground">
        <span className="truncate" title={track?.artist ?? undefined}>{track?.artist || (clipUnavailable ? 'Track unavailable in this import' : 'Rekordbox track')}</span>
        <span className="shrink-0 font-mono tabular-nums" title={`Clip duration ${(durationMs / 1000).toFixed(3)} seconds`}>
          {(durationMs / 1000).toFixed(1)} s
        </span>
      </div>
      <TrackTimeline
        sections={[{ id: slot.trackId, leftPercent: 0, widthPercent: 100, label: phrase, color: ink }]}
        start={slot.section.startMs} end={slot.section.endMs}
        timeTicks={timeRulerTicks(durationMs).map((tick) => ({ ms: slot.section.startMs + tick.ms, label: formatClock(slot.section.startMs + tick.ms) }))}
        cues={<>
          {markers.map((marker) => (
            <WaveformCueMarker key={marker.id} data-cue-family={marker.hot ? 'hot' : 'memory'} role="img"
              aria-label={marker.description} title={marker.description}
              label={marker.label} color={marker.color} memory={!marker.hot}
              style={{ left: `${marker.leftPercent}%` }}
            />
          ))}
          {cueError && <span className="px-2 text-[10px] text-muted-foreground">Cue markers unavailable</span>}
        </>}
        waveforms={[{ id: slot.trackId, state: waveform,
          ariaLabel: `Waveform for ${title}`, colorSegments: [{ startFraction: 0, endFraction: 1, color: ink }] }]}
        cueLines={markers.map((marker) => ({ ...marker }))}
        overlay={<SetLabPlayhead preview={playback} durationMs={durationMs} offsetMs={offsetMs} />}
        waveformOverlay={
        <button type="button" className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          aria-label={`Select waveform for slot ${slot.position}`} aria-pressed={selected} disabled={selectionDisabled}
          onClick={() => actions.onSelect(slot.position)} {...menuHandlers} />
        }
        beatTicks={ruler?.ticks ?? []} beatLabels={ruler?.labels ?? []}
        beatMessage={ruler ? undefined : beatMessage}
      />

      <div className="flex h-7 items-center justify-between gap-1 px-2 text-[10px] text-muted-foreground">
        <span className="truncate" title={waveformQuality ?? undefined}>{waveformQuality}</span>
        {ruler && <span className="shrink-0 font-mono">{ruler.bpm} BPM</span>}
        {waveform.status === 'error' && <button type="button" className="shrink-0 rounded px-1 font-bold text-primary focus-visible:ring-2 focus-visible:ring-primary" onClick={retryWaveform}>Retry waveform</button>}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border-faint)] px-2 py-2">
        <SelectControl
          aria-label={`Bars for slot ${slot.position}`} value={slot.barCount} disabled={busy || !ready}
          title={ready ? 'Section length' : 'An exact Rekordbox beat grid is needed to change section length'}
          onChange={(event) => {
            const bars = Number(event.target.value) as SetLabBarCount;
            if (track && grid && BAR_COUNTS.includes(bars) && bars !== slot.barCount) actions.onBars(slot, bars, { track, grid, cues });
          }}
        >
          {BAR_COUNTS.map((bars) => <option key={bars} value={bars}>{bars} bars</option>)}
        </SelectControl>
        <ControlButton variant="neutral" disabled={editDisabled} aria-label={`Reroll slot ${slot.position}`}
          title="Reroll using saved generation filters" onClick={() => actions.onReroll(slot.position)}>
          <Refresh width={14} height={14} aria-hidden="true" /> Reroll
        </ControlButton>
      </div>
      <div className="flex min-h-10 items-center px-2 pb-2">
        {selected && <ControlButton variant="neutral" disabled={!canReposition}
          title={canReposition ? undefined : 'Repositioning needs an imported Rekordbox beat grid.'}
          onClick={(event) => reposition(event.currentTarget)}>Reposition Track</ControlButton>}
      </div>
      {menu && selected && createPortal(<ContextMenu x={menu.x} y={menu.y} ariaLabel={`Slot ${slot.position} actions`}
        onClose={() => { setMenu(null); menu.trigger.focus({ preventScroll: true }); }}
        items={[{ id: 'reposition', label: 'Reposition Track', disabled: !canReposition, onSelect: () => reposition(menu.trigger) }]}
      />, document.body)}
      {actions.renderReposition?.(slot.position, display)}
    </li>
  );
}

export function SetLabTimeline({
  scope, slots, selectedSlot, busy, selectionDisabled = busy, editDisabled, playback, ...actions
}: { scope: SetLabScope; slots: SetLabFiveSlots; selectedSlot: SetLabPosition; busy: boolean; selectionDisabled?: boolean; editDisabled: boolean; playback: SetLabPreview } & TimelineActions) {
  const { data, retry } = useSetLabTimelineData(scope, slots);
  const ids = useMemo(() => data.status === 'ready' ? [...data.tracks.keys()] : [], [data]);
  const waveforms = useTrackPreviewWaveforms(scope.sourceImportId, ids);
  const [zoom, setZoom] = useState(1);
  const layout = layoutSetLabTimeline(slots);

  return (
    <section aria-label="Set Lab timeline" className="min-w-0 overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <SetLabTransport preview={playback} durationMs={layout.totalMs} disabled={busy && playback.status !== 'playing'} />
        <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom">
          <IconControlButton label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}>
            <Minus width={15} height={15} aria-hidden="true" />
          </IconControlButton>
          <span className="w-12 text-center font-mono text-xs tabular-nums">{zoom * 100}%</span>
          <IconControlButton label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + 0.5))}>
            <Plus width={15} height={15} aria-hidden="true" />
          </IconControlButton>
        </div>
      </header>
      {(data.status === 'error' || (data.status === 'ready' && (data.gridError || data.cues.size < data.tracks.size || [...data.cues.values()].some((cue) => cue.status === 'failed')))) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <span>{data.status === 'error' ? data.message : 'Some beat grids or cue markers could not be loaded.'}</span>
          <ControlButton variant="ghost" onClick={retry} disabled={busy}>Retry analysis</ControlButton>
        </div>
      )}
      <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        role="region" aria-label="Scrollable five-slot timeline" tabIndex={0}>
        <div className="min-w-0" style={{ minWidth: layout.minWidthPx * zoom, width: `${zoom * 100}%` }}>
          <div className="relative">
            <ol className="grid"
              style={{ '--cue-timeline-inline-inset': '0px', gridTemplateColumns: layout.columns } as CSSProperties}>
              {layout.clips.map(({ slot, durationMs, offsetMs }) => {
                const preview = data.status === 'loading' ? loadingWaveformState(slot.trackId)
                  : data.status === 'ready' && data.tracks.has(slot.trackId) ? waveforms.getState(slot.trackId)
                    : { status: 'unavailable', trackId: slot.trackId } as const;
                return (
                  <SetLabClip key={`${slot.position}:${slot.trackId}`} slot={slot} durationMs={durationMs} offsetMs={offsetMs}
                    importId={scope.sourceImportId} selected={slot.position === selectedSlot} busy={busy} selectionDisabled={selectionDisabled} editDisabled={editDisabled}
                    data={data} preview={preview.status === 'idle' ? loadingWaveformState(slot.trackId) : preview}
                    retryWaveform={() => waveforms.retry([slot.trackId])} actions={actions} playback={playback} />
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
