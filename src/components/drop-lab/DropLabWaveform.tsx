import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { cn } from '../../lib/utils';
import { sectionTone } from '../../lib/music/phraseSections';
import { useTimelineZoom } from '../../hooks/useTimelineZoom';
import type { WaveformSegment } from '../../lib/music/waveformSegments';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { TimelineBeatLane, TimelineLane, TimelineSectionLane, WaveformZoomControls } from '../ui/media';
import {
  DROP_LAB_SIDE_LABEL,
  DROP_LAB_TRACK_MIME,
  dropSideForPointer,
  isDropLabTrackDrag,
  type DropLabSide,
} from './dropLabDrag';
import { percentageAt, visibleSpan } from './dropLabTimeline';
import { segmentWaveformState } from './segmentWaveformState';

interface DropLabWaveformProps {
  sourceSegment: WaveformSegment | null;
  candidateSegment: WaveformSegment | null;
  loading?: boolean;
  unavailableMessage?: string;
  previewProgress?: number;
  alignmentLabel?: string;
  barCount: number;
  /** Called when a track row is dropped on the timeline. Left of the swap line loads a build, right of it a drop. */
  onLoadTrack?: (trackId: string, side: DropLabSide) => void;
}

const BUILD_COLOR = sectionTone('Build').waveformColor;
const DROP_COLOR = sectionTone('Drop').waveformColor;
const SWAP_COLOR = '#3b91ff';
const WAVEFORM_HEIGHT = 66;
const BEATS_PER_BAR = 4;
/** Zoomed in this far, the timeline shows one sixth of itself. */
const MAX_ZOOM = 6;
const BUTTON_ZOOM_FACTOR = 0.75;

function Half({ state, color, side }: { state: NonNullable<ReturnType<typeof segmentWaveformState>>; color: string; side: 'left' | 'right' }) {
  return (
    <div className={cn('absolute inset-y-0 w-1/2', side === 'left' ? 'left-0' : 'right-0')}>
      <RekordboxPreviewWaveform
        state={state}
        height={WAVEFORM_HEIGHT}
        variant="detail"
        appearance="rekordbox"
        renderMode="area"
        showCenterLine={false}
        surface={false}
        colorSegments={[{ startFraction: 0, endFraction: 1, color }]}
        ariaLabel={side === 'left' ? 'Selected track build waveform' : 'Candidate drop waveform'}
        className="absolute inset-x-0 top-0 w-full"
      />
    </div>
  );
}

/**
 * The transition timeline, built from the same lanes as Cue Points: colored section names,
 * a filled waveform, and the beat ruler. The build plays on the left, swaps at the center,
 * and the candidate drop plays on the right. The mouse wheel zooms and pans it, and zoom
 * buttons appear when the pointer is over the waveform, as in Cue Points.
 */
export function DropLabWaveform({
  sourceSegment,
  candidateSegment,
  loading,
  unavailableMessage,
  previewProgress = 0,
  alignmentLabel = 'Candidate starts exactly on its detected drop',
  barCount,
  onLoadTrack,
}: DropLabWaveformProps) {
  const sourceState = useMemo(() => segmentWaveformState(sourceSegment), [sourceSegment]);
  const candidateState = useMemo(() => segmentWaveformState(candidateSegment), [candidateSegment]);
  const [dragSide, setDragSide] = useState<DropLabSide | null>(null);

  // The timeline is measured in beats: the build is the first half, the drop the second.
  const totalBeats = barCount * BEATS_PER_BAR * 2;
  const swapBeat = totalBeats / 2;
  const zoom = useTimelineZoom(totalBeats, totalBeats / MAX_ZOOM);
  const { viewStart, viewEnd, reset: resetZoom } = zoom;
  const visibleBeats = viewEnd - viewStart;

  // A different pair of tracks or a different length starts fully zoomed out.
  const sourceTrackId = sourceSegment?.waveform.trackId;
  const candidateTrackId = candidateSegment?.waveform.trackId;
  useEffect(() => { resetZoom(); }, [resetZoom, barCount, sourceTrackId, candidateTrackId]);

  const unavailable = !sourceState || !candidateState;
  const wholeWidth = totalBeats / Math.max(visibleBeats, Number.EPSILON);
  const swapPercent = percentageAt(swapBeat, viewStart, viewEnd);

  // Only the beats on screen get a tick, so zooming in does not draw hundreds of off-screen lines.
  const visibleBeatNumbers = useMemo(() => {
    const first = Math.max(0, Math.floor(viewStart));
    const last = Math.min(totalBeats, Math.ceil(viewEnd));
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  }, [totalBeats, viewEnd, viewStart]);
  const ticks = useMemo(
    () => visibleBeatNumbers.map((beat) => ({
      key: `beat-${beat}`,
      leftPercent: percentageAt(beat, viewStart, viewEnd),
      downbeat: beat % BEATS_PER_BAR === 0,
    })),
    [viewEnd, viewStart, visibleBeatNumbers],
  );
  const labels = useMemo(() => {
    const visibleBars = visibleBeats / BEATS_PER_BAR;
    const step = visibleBars > 32 ? 4 : visibleBars > 16 ? 2 : 1;
    const items: Array<{ key: string; leftPercent: number; text: string }> = [];
    for (const beat of visibleBeatNumbers) {
      if (beat % BEATS_PER_BAR !== 0) continue;
      const bar = beat / BEATS_PER_BAR;
      if (bar >= barCount * 2 || bar % step !== 0) continue;
      items.push({
        key: `bar-${bar}`,
        leftPercent: percentageAt(beat, viewStart, viewEnd),
        text: bar < barCount ? `−${barCount - bar}` : `${bar - barCount + 1}`,
      });
    }
    return items;
  }, [barCount, viewEnd, viewStart, visibleBeatNumbers, visibleBeats]);

  const sectionItems = useMemo(() => {
    const build = visibleSpan(0, swapBeat, viewStart, viewEnd);
    const drop = visibleSpan(swapBeat, totalBeats, viewStart, viewEnd);
    return [
      build && { id: 'build', label: 'Selected build', color: BUILD_COLOR, title: 'The selected track plays up to the swap point', ...build },
      drop && { id: 'drop', label: 'Candidate drop', color: DROP_COLOR, title: 'The candidate plays from its drop', ...drop },
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [swapBeat, totalBeats, viewEnd, viewStart]);

  const progress = Math.max(0, Math.min(1, previewProgress));
  const playheadPercent = percentageAt(progress * totalBeats, viewStart, viewEnd);

  function sideAt(event: DragEvent<HTMLDivElement>): DropLabSide {
    return dropSideForPointer(event.clientX, event.currentTarget.getBoundingClientRect(), (swapBeat - viewStart) / visibleBeats);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!onLoadTrack || !isDropLabTrackDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragSide(sideAt(event));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!onLoadTrack || !isDropLabTrackDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    const trackId = event.dataTransfer.getData(DROP_LAB_TRACK_MIME);
    const side = sideAt(event);
    setDragSide(null);
    if (trackId) onLoadTrack(trackId, side);
  }

  // The highlighted area is whichever part of the visible timeline lies on the dragged-over side of the swap line.
  const highlight = dragSide === 'build'
    ? { left: 0, width: Math.max(0, Math.min(100, swapPercent)) }
    : dragSide === 'drop'
      ? { left: Math.max(0, Math.min(100, swapPercent)), width: 100 - Math.max(0, Math.min(100, swapPercent)) }
      : null;

  return (
    <div className="shrink-0 pt-1">
      <div
        className="cue-timeline relative"
        data-testid="drop-lab-timeline"
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragSide(null);
        }}
        onDrop={handleDrop}
      >
        <TimelineSectionLane sections={sectionItems} />

        <TimelineLane
          heightClass="h-[68px]"
          className="group/waveform"
          contentRef={zoom.containerRef}
          overlay={!unavailable && !loading ? (
            <WaveformZoomControls
              onZoomIn={() => zoom.zoomBy(BUTTON_ZOOM_FACTOR)}
              onZoomOut={() => zoom.zoomBy(1 / BUTTON_ZOOM_FACTOR)}
              canZoomIn={zoom.canZoomIn}
              canZoomOut={zoom.canZoomOut}
            />
          ) : undefined}
        >
          <div
            className="absolute inset-0"
            role="img"
            aria-label="Transition waveform. The selected track buildup plays on the left, swaps at the center, and the active candidate drop plays on the right."
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center"><div className="h-12 w-4/5 animate-pulse rounded-lg bg-white/[0.06]" /></div>
            ) : unavailable ? (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-muted-foreground">
                {unavailableMessage || sourceSegment?.unavailableReason || candidateSegment?.unavailableReason || 'Waveform segment unavailable'}
              </div>
            ) : (
              <>
                <div
                  data-testid="drop-lab-waveform-scale"
                  className="absolute inset-y-0"
                  style={{ left: `${-(viewStart / totalBeats) * wholeWidth * 100}%`, width: `${wholeWidth * 100}%` }}
                >
                  <Half state={sourceState} color={BUILD_COLOR} side="left" />
                  <Half state={candidateState} color={DROP_COLOR} side="right" />
                </div>
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  {ticks.filter((tick) => tick.leftPercent > 0.01 && tick.leftPercent < 99.99).map((tick) => (
                    <span
                      key={tick.key}
                      className={cn('absolute bottom-0 top-0 border-l border-dashed', tick.downbeat ? 'border-white/[0.10]' : 'border-white/[0.035]')}
                      style={{ left: `${tick.leftPercent}%` }}
                    />
                  ))}
                </div>
              </>
            )}
            {swapPercent >= 0 && swapPercent <= 100 && (
              <div className="pointer-events-none absolute inset-y-0 z-20 w-[2px] -translate-x-1/2" style={{ left: `${swapPercent}%`, background: SWAP_COLOR }} />
            )}
            {!unavailable && !loading && progress > 0 && playheadPercent >= 0 && playheadPercent <= 100 && (
              <div className="pointer-events-none absolute inset-y-0 z-30 w-px bg-white shadow-[0_0_7px_rgba(255,255,255,0.75)]" style={{ left: `${playheadPercent}%` }} data-testid="drop-lab-playhead">
                <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-[2px] rotate-45 rounded-[1px] bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
              </div>
            )}
          </div>
        </TimelineLane>

        <TimelineBeatLane ticks={ticks} labels={labels} />

        {highlight && dragSide && (
          <div
            data-testid="drop-lab-drop-target"
            data-side={dragSide}
            className="pointer-events-none absolute inset-y-0 z-40 flex items-start justify-center rounded-md border-2 border-dashed pt-2 text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{
              left: `${highlight.left}%`,
              width: `${highlight.width}%`,
              borderColor: dragSide === 'build' ? BUILD_COLOR : DROP_COLOR,
              color: dragSide === 'build' ? BUILD_COLOR : DROP_COLOR,
              backgroundColor: `${dragSide === 'build' ? BUILD_COLOR : DROP_COLOR}1f`,
            }}
          >
            {DROP_LAB_SIDE_LABEL[dragSide]}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center px-[var(--drop-lab-inset,24px)] pb-1 pt-1 text-[10px] text-muted-foreground">
        <span className="shrink-0 rounded-md border px-2 py-0.5 font-medium" style={{ borderColor: `${SWAP_COLOR}59`, color: SWAP_COLOR }}>Automatic swap cue · {alignmentLabel}</span>
      </div>
    </div>
  );
}
