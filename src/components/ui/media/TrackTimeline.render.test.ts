import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackTimeline, type TrackTimelineProps } from './TrackTimeline';
import { WaveformCueMarker } from './WaveformCueMarker';

vi.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ theme: 'dropdex' }) }));
afterEach(() => vi.unstubAllGlobals());

const fixture: TrackTimelineProps = {
  start: 0, end: 120_000,
  sections: [{ id: 'verse', label: 'Verse', color: '#8997AE', leftPercent: 0, widthPercent: 50 },
    { id: 'drop', label: 'Drop', color: '#F78361', leftPercent: 50, widthPercent: 50 }],
  timeTicks: [{ ms: 0, label: '0:00' }, { ms: 60_000, label: '1:00' }],
  cues: createElement(WaveformCueMarker, { label: 'B', color: '#5aa9d1', style: { left: '50%' } }),
  cueLines: [{ id: 'b', label: 'B', color: '#5aa9d1', leftPercent: 50 }],
  waveforms: [{ id: 'fixture', state: { status: 'unavailable', trackId: 'fixture' }, ariaLabel: 'Fixture waveform' }],
  beatTicks: [{ key: '1', leftPercent: 0, downbeat: true }, { key: '2', leftPercent: 25, downbeat: false }],
  beatLabels: [{ key: '1', leftPercent: 0, text: '1' }],
};
function render(props: TrackTimelineProps = fixture) {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  return renderToStaticMarkup(createElement(TrackTimeline, props));
}
const rows = (markup: string) => [...markup.matchAll(/data-timeline-row="([a-z]+)"/g)].map((match) => match[1]);

describe('Library five-row timeline contract', () => {
  it('keeps Library row order and reserves every row when data is missing', () => {
    const expected = ['sections', 'timestamps', 'cues', 'waveform', 'beats'];
    expect(rows(render())).toEqual(expected);
    expect(rows(render({ sections: [], start: 0, end: 0, timeTicks: [], waveforms: [], beatTicks: [], beatLabels: [] }))).toEqual(expected);
  });

  it('aligns timestamps, cue flags, cue lines and positioned audio to the same content width', () => {
    const markup = render({ ...fixture, waveforms: [{ ...fixture.waveforms[0], leftPercent: 50, widthPercent: 25 }] });
    expect(markup).toContain('left:50%;width:25%');
    expect(markup).toContain('left:50%;--waveform-cue-ink:#5aa9d1');
    expect(markup).toContain('left:50%;transform:translateX(-50%)');
    expect(markup).toContain('data-waveform-appearance="rekordbox"');
    expect(markup).toContain('data-waveform-render-mode="area"');
    expect(markup).toContain('height:72px');
  });

  it('every full timeline consumer delegates the five-row region to this component', () => {
    for (const path of [
      '../../cues/CuePointsView.tsx', '../../audition/AuditionFullSong.tsx', '../../drop-lab/DropLabWaveform.tsx',
      '../../../features/set-lab/SetLabTimeline.tsx', '../../../features/set-lab/SetLabRepositionEditor.tsx', '../../flip-lab/FlipLabView.tsx',
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source, path).toContain('<TrackTimeline');
      expect(source, path).not.toMatch(/<(?:RekordboxPreviewWaveform|TimelineBeatLane|TimelineSectionLane|WaveformTimeRuler|WaveformSectionRow)\b/);
    }
  });

  // Run with TRACK_TIMELINE_BROWSER_CHECK=1 after the production build, in the focused validation pass.
  it.runIf(process.env.TRACK_TIMELINE_BROWSER_CHECK === '1')('measures identical geometry in every workspace at desktop and mobile widths', async () => {
    const { chromium } = await import('playwright');
    const css = readdirSync('dist/assets').filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(`dist/assets/${name}`, 'utf8')).join('\n');
    const markup = render();
    const workspaces = ['artist-library-studio cue-studio cue-track-panel', 'cue-studio', 'audition-studio', 'drop-lab-studio', 'set-lab-studio', 'flip-lab-studio'];
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      for (const width of [1200, 640]) {
        await page.setViewportSize({ width, height: 1400 });
        await page.setContent(`<style>${css}</style>${workspaces.map((classes) => `<section class="studio-surface ${classes}">${markup}</section>`).join('')}`);
        const geometry = await page.locator('.track-timeline').evaluateAll((timelines) => timelines.map((timeline) => {
          const root = timeline.getBoundingClientRect();
          const selectors = ['[data-timeline-row="sections"]', '[data-timeline-row="timestamps"]', '[data-timeline-row="cues"]', '[data-timeline-row="waveform"]', '[data-timeline-row="beats"]', '.waveform-cue-marker', '.cue-flag', '.waveform-section', '.waveform-time-ruler > span', '.track-timeline__beat-tick', '.track-timeline__beat-label'];
          return selectors.map((selector) => {
            const element = timeline.querySelector(selector)!;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { x: rect.x - root.x, y: rect.y - root.y, width: rect.width, height: rect.height,
              font: style.font, color: style.color, padding: style.padding, margin: style.margin };
          });
        }));
        for (const metrics of geometry) expect(metrics).toEqual(geometry[0]);
        expect(geometry[0].slice(0, 5).map(({ height }) => height)).toEqual([32, 16, 36, 72, 26]);
        expect(geometry[0].slice(0, 5).map(({ y }) => y)).toEqual([12, 44, 55, 92, 168]);
      }
    } finally {
      await browser.close();
    }
  }, 20_000);
});
