import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const css = read('cue-studio.css');
const view = read('CuePointsView.tsx');

describe('Cue Points in the Audition look', () => {
  it('uses the Audition panel: slate gradient, hairline edge, coral accent, scoped to Cue Points mode', () => {
    expect(css).toContain('linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%)');
    expect(css).toMatch(/--color-primary: #f56b70;/);
    expect(view).toContain("mode === 'cues' && 'cue-studio'");
    expect(view).toContain("import './cue-studio.css'");
    // Nothing leaks into other pages that share the same components.
    for (const selector of css.match(/^\.[a-z-]+[^{]*\{/gm) ?? []) expect(selector, selector).toMatch(/\.cue-studio/);
  });

  it('styles the top-right buttons like Audition\'s figures: label under the icon, hairline between, 12px each side', () => {
    expect(css).toMatch(/\.cue-workstation__actions \[data-label\]::after \{[^}]*font-size: 9px;[^}]*letter-spacing: \.16em/);
    expect(css).toMatch(/button\.cue-action-icon,[\s\S]*?padding: 0 12px;[\s\S]*?border-left: 1px solid #ffffff0d/);
    for (const label of ['Pending', 'Auto Cue', 'Apply']) expect(view).toContain(`data-label="${label}"`);
    const toolbar = read('CueEditorToolbar.tsx');
    for (const label of ['Grid', 'Repeat', 'Volume', 'State']) expect(toolbar).toContain(`data-label="${label}"`);
    expect(toolbar).toContain('data-label={label}');
  });

  it('styles cue markers, sections and the beat grid like Audition', () => {
    expect(css).toMatch(/cue-point-marker"\] > span:first-child[\s\S]*?border-radius: 3px 3px 7px 7px/);
    expect(css).toMatch(/\.cue-wave-line \{ width: 1px;/);
    expect(css).toMatch(/\.timeline-section \{[^}]*border-bottom: 1px solid var\(--section-ink\)/);
    expect(css).toMatch(/\.timeline-beat-tick \{[^}]*#8997ae59/);
    expect(css).toMatch(/\.timeline-beat-tick--bar \{[^}]*#c3ccdb99/);
  });

  it('uses the same filter row and record listing rules as Audition', () => {
    expect(css).toMatch(/\.cue-browser__filters p \{ color: #a5aec0; font-size: 9px/);
    expect(css).toMatch(/\.cue-browser__table tbody td \{ height: 40px;/);
    expect(css).toMatch(/\.cue-browser__row--selected, \.cue-studio \.cue-browser__row--selected:hover \{ background: #f54b6409; box-shadow: inset 2px 0 #f5746b; \}/);
  });
});
