import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waveformSectionInk } from './waveformPresentation';
import { TrackTimeline, type TrackTimelineProps } from './TrackTimeline';

const rendered = vi.hoisted(() => ({ waveforms: [] as { colorSegments?: { startFraction: number; endFraction: number; color: string }[]; tint: string }[] }));
vi.mock('../../library/RekordboxPreviewWaveform', () => ({ RekordboxPreviewWaveform: (props: { tint: string }) => {
  rendered.waveforms.push(props);
  return null;
} }));
const props: TrackTimelineProps = {
  start: 0, end: 1000, timeTicks: [], beatTicks: [], beatLabels: [],
  sections: [{ id: 'drop', label: 'Drop', color: '#F78361', leftPercent: 0, widthPercent: 100 }],
  waveforms: [{ id: 'track', state: { status: 'unavailable', trackId: 'track' }, fill: 0.5,
    colorSegments: [{ startFraction: 0, endFraction: 1, color: '#F78361' }] }],
};
beforeEach(() => { rendered.waveforms = []; });

describe('Audition-only drop highlighting', () => {
  it('keeps every phrase slate by default and restricts orange to opted-in drops/choruses', () => {
    for (const label of ['Intro', 'Build', 'Verse', 'Drop', 'Chorus', 'Bridge'])
      expect(waveformSectionInk(label)).toBe('#8997AE');
    expect(waveformSectionInk('Drop', true)).toBe('#F78361');
    expect(waveformSectionInk('Chorus', true)).toBe('#F78361');
    expect(waveformSectionInk('Verse', true)).toBe('#8997AE');
  });

  it('ignores supplied orange colors in standard phrase rows and both waveform layers', () => {
    const markup = renderToStaticMarkup(createElement(TrackTimeline, props));
    expect(markup).toContain('--section-ink:#8997AE');
    expect(markup).not.toContain('#F78361');
    expect(rendered.waveforms).toHaveLength(2);
    for (const waveform of rendered.waveforms) {
      expect(waveform.tint).toBe('#8997AE');
      expect(waveform.colorSegments).toEqual([{ startFraction: 0, endFraction: 1, color: '#8997AE' }]);
    }
  });

  it('paints only gray with multicolor Rekordbox source data in standard mode', async () => {
    renderToStaticMarkup(createElement(TrackTimeline, props));
    const { buildTimelineWaveformGradient } = await vi.importActual<typeof import('../../library/RekordboxPreviewWaveform')>('../../library/RekordboxPreviewWaveform');
    const addColorStop = vi.fn();
    const context = { createLinearGradient: () => ({ addColorStop }) } as unknown as CanvasRenderingContext2D;
    for (const waveform of rendered.waveforms) {
      const segments = waveform.colorSegments?.map((segment) => ({ ...segment,
        color: [parseInt(segment.color.slice(1, 3), 16), parseInt(segment.color.slice(3, 5), 16), parseInt(segment.color.slice(5, 7), 16)] as [number, number, number],
      })) ?? [];
      buildTimelineWaveformGradient(context, [
        { h: .8, r: 255, g: 0, b: 0 }, { h: .8, r: 0, g: 255, b: 0 }, { h: .8, r: 0, g: 0, b: 255 },
      ], 300, [137, 151, 174], segments);
    }
    expect(addColorStop).toHaveBeenCalled();
    expect(new Set(addColorStop.mock.calls.map(([, color]) => color))).toEqual(new Set(['rgba(137,151,174,1)']));
  });

  it('preserves Audition highlighting when explicitly enabled', () => {
    const markup = renderToStaticMarkup(createElement(TrackTimeline, { ...props, highlightDrops: true }));
    expect(markup).toContain('--section-ink:#F78361');
    for (const waveform of rendered.waveforms)
      expect(waveform.colorSegments).toEqual(props.waveforms[0].colorSegments);
  });
});
