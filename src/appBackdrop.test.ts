import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const css = read('./index.css');
const studio = read('./components/ui/studio.css');
const GRADIENT = 'linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%)';

describe('The app backdrop matches the Discovery surface', () => {
  it('uses the same gradient and base colour as the Discovery panel', () => {
    expect(studio).toContain(`background: ${GRADIENT};`);
    expect(studio).toContain('--color-background: #1b1f28;');
    expect(css).toContain(`--app-backdrop: ${GRADIENT};`);
    expect(css).toMatch(/@theme \{[^}]*--color-background: #1b1f28;/);
  });

  it('paints the fixed layer behind the app with it in both dark themes (Dark and CDJ), and keeps the light theme flat', () => {
    expect(read('./App.tsx')).toContain('className="app-backdrop fixed inset-0 -z-10 overflow-hidden"');
    expect(css).toMatch(/\.app-backdrop \{\s*background: var\(--app-backdrop, var\(--color-background\)\);/);
    expect(css).toMatch(/\[data-theme="light"\] \{\s*--app-backdrop: #f2efed;/);
    const cdj = css.slice(css.indexOf('[data-theme="cdj"] {'), css.indexOf('}', css.indexOf('[data-theme="cdj"] {')));
    expect(cdj).not.toContain('--app-backdrop');
  });

  it('is matte: no coloured glow in either dark theme', () => {
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\) \.ambience-blob \{\s*display: none;/);
    expect(css).toMatch(/\[data-theme="cdj"\] \.ambience-blob \{\s*display: none;/);
  });

  it('matches the colour the window and the browser chrome show first', () => {
    expect(read('../index.html')).toContain('<meta name="theme-color" content="#1b1f28" />');
    const main = read('../electron/main.cjs');
    expect(main).toContain("backgroundColor: '#1b1f28',\n    title: 'DropDex',");
  });
});
