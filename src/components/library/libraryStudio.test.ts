import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const css = read('library-studio.css');

describe('Library pages in the graphite look', () => {
  it('defines the shared recipe: slate gradient, hairlines, layered shadows, caps labels and a coral accent', () => {
    expect(css).toContain('linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%)');
    expect(css).toMatch(/\.lib-card \{[^}]*repeating-linear-gradient\(0deg, #ffffff05[^}]*inset 0 1px 0 #ffffff12/s);
    expect(css).toMatch(/\.lib-well \{[^}]*inset 0 2px 6px/s);
    expect(css).toMatch(/\.lib-label \{[^}]*font-size: 9px;[^}]*letter-spacing: \.16em/s);
    expect(css).toMatch(/\.lib-tab\[aria-selected="true"\] \{[^}]*#f56b70/);
    expect(css).not.toMatch(/10,\s*145,\s*255|1067dc|rgba\(16,\s*103/i);
  });

  it('puts both pages in that look and drops the old blue glass', () => {
    const home = read('LibraryView.tsx');
    const artistLibrary = read('ArtistLibraryView.tsx');
    expect(home).toContain("import './library-studio.css'");
    expect(home).toContain('lib-scope');
    expect(home).toContain('<LibraryGhostHero');
    expect(artistLibrary).toContain('lib-scope');
    for (const file of ['LibraryView.tsx', 'LibraryTabPanels.tsx', 'ArtistLibraryView.tsx']) {
      expect(read(file), file).not.toContain('glass rounded');
    }
    expect(home).not.toContain('rgba(16,103,220');
    expect(home).not.toContain('rgba(10,145,255');
  });
});
