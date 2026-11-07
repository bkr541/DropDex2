import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const controlsCss = read('../dropdex-controls.css');
const feedbackCss = read('../dropdex-feedback.css');

describe('The one primary button', () => {
  it('is a coral outline on a clear background, the same outline as the profile icon ring in the Hero mockup', () => {
    const hero = read('../layout-lab-hero.css');
    const ring = hero.match(/\.lh-avatar-ring \{[^}]*border: 1\.5px solid (#[0-9a-f]{6}); border-radius: 50%; box-shadow: 0 0 12px (#[0-9a-f]{8});/)!;
    expect(read('../../../index.css')).toContain(`--color-control-primary: ${ring[1]};`);
    expect(read('../../../index.css')).toContain(`--color-control-primary-glow: ${ring[2]};`);
    expect(controlsCss).toMatch(/\.dd-control-button--primary \{ border-width: 1\.5px;[^}]*box-shadow: 0 0 12px var\(--color-control-primary-glow\)/);
    expect(controlsCss).toMatch(/\.dd-control-button--primary \{[^}]*border-color: var\(--color-control-primary\)[^}]*background: transparent[^}]*color: var\(--color-control-primary\)/);
  });

  it('sets its text like the artist name in the Hero mockups (light, capitals, 0.1em spacing)', () => {
    const mockup = read('../LayoutLabHeroMockups.tsx');
    expect(mockup).toMatch(/<h2 className="truncate text-\[28px\] font-light uppercase leading-none tracking-\[0\.1em\]"[^>]*>\{HERO\.name\}<\/h2>/);
    expect(controlsCss).toMatch(/\.dd-control-button--primary \{[^}]*font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif; font-weight: 300; letter-spacing: \.1em; text-transform: uppercase;/);
    expect(feedbackCss).toMatch(/\.dd-upload-button--primary \{[^}]*font-weight: 300; letter-spacing: \.1em; text-transform: uppercase;/);
  });

  it('needs no one-off colors at the sign-in button', () => {
    expect(read('../../AuthGate.tsx')).not.toContain("borderColor: '#cf6b65'");
  });

  it('is what dialogs, empty states and the library hero use for their main action', () => {
    expect(read('../feedback/Dialog.tsx')).toContain('<ControlButton key={action.label} variant="primary"');
    expect(read('../feedback/EmptyState.tsx')).toContain('<ControlButton variant="primary"');
    expect(read('../../library/HeroActionButton.tsx')).toContain('<ControlButton variant="primary"');
    expect(read('../../player/NowPlayingBar.tsx')).toContain('<ControlButton variant="primary"');
    expect(read('../../drop-lab/DropLabView.tsx')).toContain('<ControlButton variant="primary"');
  });

  it('is not left as a solid fill anywhere else', () => {
    expect(feedbackCss).toMatch(/\.dd-upload-button--primary \{[^}]*background: transparent/);
  });
});

describe('The one secondary button', () => {
  it('is a gray outline on a clear background: the same shape as the primary, but quieter', () => {
    expect(controlsCss).toMatch(/\.dd-control-button--secondary,\s*\.dd-control-button--neutral,\s*\.dd-control-button--surface \{[^}]*border-color: #3a4655[^}]*background: transparent[^}]*color: #d8dee7/);
    expect(controlsCss).not.toMatch(/\.dd-control-button--secondary \{[^}]*control-blue/);
  });

  it('lights up on hover without turning blue, so it never looks like the primary', () => {
    expect(controlsCss).toMatch(/\.dd-control-button--secondary:hover:not\(:disabled\),[^{]*\{[^}]*background: rgb\(255 255 255 \/ \.05\)[^}]*color: #fff/);
  });
});
