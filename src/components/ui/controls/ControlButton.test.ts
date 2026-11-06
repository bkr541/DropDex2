import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const controlsCss = read('../dropdex-controls.css');
const feedbackCss = read('../dropdex-feedback.css');

describe('The one primary button', () => {
  it('is a blue outline on a clear background', () => {
    expect(read('../../../index.css')).toContain('--color-control-primary: #1f7dff;');
    expect(controlsCss).toMatch(/\.dd-control-button--primary \{[^}]*border-color: var\(--color-control-primary\)[^}]*background: transparent[^}]*color: var\(--color-control-primary\)/);
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
