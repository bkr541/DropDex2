import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const css = read('cue-studio.css');
const view = read('CuePointsView.tsx');
const surface = read('../ui/studio-surface.css');

describe('Cue Points in the Audition look', () => {
  it('uses the Audition panel: slate gradient, hairline edge, coral accent, scoped to Cue Points mode', () => {
    expect(surface).toContain('linear-gradient(165deg, #303540 0%, #272c36 36%, #212630 100%)');
    expect(surface).toMatch(/--color-primary: #f56b70;/);
    expect(view).toContain("mode === 'cues' && 'studio-surface cue-studio'");
    expect(view).toContain("import './cue-studio.css'");
    // Nothing leaks into other pages that share the same components.
    for (const selector of css.match(/^\.[a-z-]+[^{]*\{/gm) ?? []) expect(selector, selector).toMatch(/\.cue-studio/);
  });

  it('keeps the top-right buttons icon-only with compact spacing and hairline dividers', () => {
    expect(css).not.toContain('content: attr(data-label)');
    expect(css).toMatch(/button\.cue-action-icon,[\s\S]*?padding: 0 8px;[\s\S]*?border-left: 1px solid #ffffff0d/);
    for (const label of ['Pending', 'Auto Cue', 'Apply']) expect(view).toContain(`data-label="${label}"`);
    const toolbar = read('CueEditorToolbar.tsx');
    for (const label of ['Grid', 'Repeat', 'Volume', 'State']) expect(toolbar).toContain(`data-label="${label}"`);
    expect(toolbar).toContain('data-label={label}');
  });

  it('styles cue markers, sections and the beat grid like Audition', () => {
    const markerCss = read('../ui/media/waveform-cue-marker.css');
    expect(markerCss).toContain('width: 29px; height: 30px');
    expect(view).toContain("from '../ui/media/WaveformCueMarker'");
    expect(read('../audition/AuditionFullSong.tsx')).toContain("from '../ui/media/WaveformCueMarker'");
    expect(view).toContain("memory={cue.family === 'memory'}");
    expect(css).toMatch(/\.cue-wave-line \{ width: 1px;/);
    expect(read('../ui/media/waveform-sections.css')).toContain('border-bottom: 1px solid var(--section-ink)');
    expect(css).toMatch(/\.timeline-beat-tick \{[^}]*#8997ae59/);
    expect(css).toMatch(/\.timeline-beat-tick--bar \{[^}]*#c3ccdb99/);
  });

  it('styles the Cue Points filter bar and delegates record rows to the shared listing', () => {
    expect(css).toMatch(/\.cue-browser__filters p \{ color: #a5aec0; font-size: 9px/);
    expect(css).not.toContain('.cue-browser__row--selected');
    expect(view).toContain('<RecordTrackListing');
  });
});
