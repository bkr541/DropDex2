import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bpmRangeStatsFrom, keyStatsFrom } from './libraryInsights';

const hero = readFileSync(resolve(__dirname, './LibraryView.tsx'), 'utf8');

describe('library insights helpers', () => {
  it('groups BPMs into 20-BPM ranges, lowest first', () => {
    expect(bpmRangeStatsFrom([{ bpm: 145, count: 2 }, { bpm: 150, count: 3 }, { bpm: 90, count: 1 }])).toEqual([['80–99', 1], ['140–159', 5]]);
  });
  it('sorts keys by count, most common first', () => {
    expect(keyStatsFrom([{ name: '7A', count: 1 }, { name: '2A', count: 5 }]).map(([k]) => k)[0]).toBe('2A');
  });
});

describe('the Home hero is the Ghost Banner (the seventh Layout Lab hero mockup)', () => {
  const ghost = readFileSync(resolve(__dirname, './LibraryGhostHero.tsx'), 'utf8');
  const css = readFileSync(resolve(__dirname, './library-ghost-hero.css'), 'utf8');

  it('replaces the old profile card and hero on desktop, and keeps the compact hero below it', () => {
    expect(hero).toContain('<LibraryGhostHero');
    expect(hero).not.toContain('<DesktopLibraryHero');
    expect(hero).not.toContain('<ArtistProfileCard');
    expect(hero).toContain('<LibraryHero');
    expect(hero).toContain('genreCount={libraryStats ? libraryStats.genreTotals.length : null}');
  });

  it('has the Ghost Banner look: the same frame, the name rising from the bottom edge, and a 218px height', () => {
    for (const part of ['radial-gradient(ellipse at 50% 120%, #00000066, transparent 60%)', 'repeating-linear-gradient(0deg, #ffffff05 0 1px, transparent 1px 3px)', 'linear-gradient(165deg, #2a2e38 0%, #1f2229 55%, #16191f 100%)']) {
      expect(css).toContain(part);
    }
    for (const part of ['bottom: -58px', 'font-size: 280px', 'mask-image: linear-gradient(0deg, #000 0%, transparent 78%)']) {
      expect(css).toContain(part);
    }
    expect(css).toMatch(/\.lgh \{ position: relative; height: 218px;/);
    expect(ghost).toContain('text-[40px] font-light uppercase leading-none tracking-[0.06em]');
    expect(ghost).toContain('<ProfileSocialLinks profile={profile} size={26} className="gap-5" />');
  });

  it('shows the same seven values as the mockup, in one line between hairlines', () => {
    for (const label of ['Tracks', 'Playlists', 'USBs', 'Cue points', 'Genres', 'Analysed', 'In the cloud']) expect(ghost).toContain(`label: '${label}'`);
    expect(ghost).toContain("i > 0 && 'border-l border-[#ffffff14]'");
  });

  it('puts the import row under the values, exactly as wide as them, with status, USB, last import, Resume Analysis and Import Library', () => {
    expect(ghost).toContain('style={{ width: 0, minWidth: \'100%\' }} data-testid="hero-import-row"');
    expect(ghost.indexOf('hero-value')).toBeLessThan(ghost.indexOf('hero-import-row'));
    expect(ghost).toContain('<ControlButton variant="primary"');
    expect(ghost).toContain('Import Library');
    expect(ghost).toContain('Resume Analysis');
    expect(ghost).toContain("usbLoaded ?? 'No USB loaded'");
    expect(ghost).toContain('Last import {lastImport}');
  });
});
