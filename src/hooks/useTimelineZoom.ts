import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MIN_CUE_TIMELINE_WINDOW_MS,
  applyTimelineWheel,
  zoomCueTimelineView,
  type CueTimelineView,
} from '../lib/cues/cueTimelineViewport';

export const TIMELINE_BUTTON_ZOOM_FACTOR = 0.75;

export interface TimelineZoom {
  /** Visible window, in the same units as `durationMs`. */
  viewStart: number;
  viewEnd: number;
  /** Attach to the element the mouse wheel should zoom and pan. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** `factor` below 1 zooms in, above 1 zooms out. */
  zoomBy: (factor: number) => void;
  reset: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/**
 * Zoom and pan for a waveform timeline, shared by Cue Points and Drop Lab: the mouse wheel
 * zooms around the pointer, a sideways scroll pans, and the hover buttons zoom around the center.
 * `durationMs` is the full length in any unit; `minimumWindow` is the closest zoom, in that unit.
 */
export function useTimelineZoom(durationMs: number | null, minimumWindow = MIN_CUE_TIMELINE_WINDOW_MS): TimelineZoom {
  const [view, setView] = useState<{ start: number; end: number | null }>({ start: 0, end: null });
  const viewRef = useRef<{ start: number; end: number | null }>({ start: 0, end: null });
  const wheelFrameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const total = durationMs && durationMs > 0 ? durationMs : 0;
  const viewEnd = view.end ?? total;

  // The wheel handler reads the latest view from here, never from a stale closure.
  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !(total > 0)) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const current = viewRef.current;
      const next = applyTimelineWheel(
        { start: current.start, end: current.end ?? total },
        total,
        { deltaX: event.deltaX, deltaY: event.deltaY, focusFraction: (event.clientX - rect.left) / rect.width, width: rect.width },
        minimumWindow,
      );
      if (!next) return;
      viewRef.current = next;
      if (wheelFrameRef.current == null) {
        wheelFrameRef.current = requestAnimationFrame(() => {
          setView({ ...viewRef.current });
          wheelFrameRef.current = null;
        });
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      if (wheelFrameRef.current != null) {
        cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
    };
  }, [total, minimumWindow]);

  const zoomBy = useCallback((factor: number) => {
    if (!(total > 0)) return;
    const current = viewRef.current;
    const next = zoomCueTimelineView({ start: current.start, end: current.end ?? total }, total, factor, 0.5, minimumWindow);
    if (!next) return;
    viewRef.current = next;
    setView(next);
  }, [total, minimumWindow]);

  const reset = useCallback(() => {
    viewRef.current = { start: 0, end: null };
    setView({ start: 0, end: null });
  }, []);

  const range = viewEnd - view.start;
  return {
    viewStart: view.start,
    viewEnd,
    containerRef,
    zoomBy,
    reset,
    canZoomIn: total > 0 && range > Math.min(minimumWindow, total),
    canZoomOut: total > 0 && range < total,
  };
}

export type { CueTimelineView };
