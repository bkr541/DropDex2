import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const controlsCss = read('../dropdex-controls.css');
const feedbackCss = read('../dropdex-feedback.css');
const raisedPlate = controlsCss.match(/\.dd-control-button:is\(\.dd-control-button--primary, \.dd-control-button--secondary\) \{([^}]*)\}/)?.[1];

describe('The one primary button', () => {
  it('shares a graphite plate with the secondary, with coral on the primary rim and label', () => {
    expect(raisedPlate).toContain('repeating-linear-gradient(0deg, #ffffff05 0 1px, transparent 1px 3px)');
    expect(raisedPlate).toContain('linear-gradient(165deg, #2c303b 0%, #232731 40%, #1c2029 100%)');
    expect(raisedPlate).toContain('box-shadow: inset 0 1px 0 #ffffff14, inset 0 -1px 0 #00000040, 0 1px 2px #00000059, 0 10px 24px -8px #0000008c;');
    expect(controlsCss).toMatch(/\.dd-control-button--primary \{[^}]*--dd-plate-border: #f56b7099;[^}]*--dd-plate-text: var\(--color-control-primary-hover\);/);
    expect(controlsCss).toMatch(/\.dd-control-button--primary\.dd-control-button--ready:not\(:disabled\) \{[^}]*--dd-plate-text: var\(--color-control-green\);/);
  });

  it('sets its text like the artist name in the Hero mockups (light, capitals, 0.1em spacing)', () => {
    const mockup = read('../LayoutLabHeroMockups.tsx');
    expect(mockup).toMatch(/<h2 className="truncate text-\[28px\] font-light uppercase leading-none tracking-\[0\.1em\]"[^>]*>\{HERO\.name\}<\/h2>/);
    expect(raisedPlate).toMatch(/font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif;[^}]*font-weight: 400;[^}]*letter-spacing: \.1em;[^}]*text-transform: uppercase;/);
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

  it('keeps the file-upload button outline', () => {
    expect(feedbackCss).toMatch(/\.dd-upload-button--primary \{[^}]*background: transparent/);
  });
});

describe('The one secondary button', () => {
  it('uses silver on the raised plate and brightens the rim and label on hover', () => {
    expect(controlsCss).toMatch(/\.dd-control-button--secondary \{[^}]*--dd-plate-border: #ffffff1f;[^}]*--dd-plate-text: #cdd3dd;[^}]*--dd-plate-hover-border: #ffffff3d;[^}]*--dd-plate-hover-text: #fff;/);
    expect(controlsCss).toMatch(/\.dd-control-button:is\(\.dd-control-button--primary, \.dd-control-button--secondary\):hover:not\(:disabled\) \{[^}]*border-color: var\(--dd-plate-hover-border\);[^}]*color: var\(--dd-plate-hover-text\);/);
  });

  it('dims the plate when disabled and keeps neutral and surface as outline variants', () => {
    expect(controlsCss).toContain('.dd-control-button:is(.dd-control-button--primary, .dd-control-button--secondary):disabled { opacity: .35; }');
    expect(controlsCss).toMatch(/\.dd-control-button--neutral,\s*\.dd-control-button--surface \{[^}]*border-color: #3a4655[^}]*background: transparent[^}]*color: #d8dee7/);
  });
});
