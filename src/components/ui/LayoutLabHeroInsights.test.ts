import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, './LayoutLabHeroMockups.tsx'), 'utf8');
const body = src.slice(src.indexOf('export function HeroMockupsContent'));

describe('Layout Lab hero mockups', () => {
  it('shows all nine mockups', () => {
    expect(body.match(/<HeroMockupCard /g)).toHaveLength(9);
  });
  it('no longer shows the single main BPM / key / genre stats', () => {
    expect(src).not.toContain('MAIN_STATS');
    expect(src).not.toContain("label: 'Main BPM'");
    expect(src).not.toContain("'MAIN BPM'");
  });
  it('includes top genres, BPM distribution and the Camelot wheel in each mockup', () => {
    const fns = ['HeroSpotlight', 'HeroBento', 'HeroEditorial', 'HeroTypographic', 'HeroGalleryMasthead', 'HeroSwissIndex', 'HeroQuietRegister', 'HeroSplitLedger', 'HeroMonograph'];
    for (const fn of fns) {
      const start = src.indexOf(`function ${fn}(`);
      const end = src.indexOf('\nfunction ', start + 10);
      const block = src.slice(start, end === -1 ? undefined : end);
      const hasGenres = /InsightTrio|Top Genres|TOP GENRES|Top genres|MiniInsights|MiniGenres/.test(block);
      const hasBpm = /InsightTrio|BPM Distribution|BPM DISTRIBUTION|MiniInsights|MiniBpm/.test(block);
      const hasWheel = /InsightTrio|Camelot Wheel|CAMELOT WHEEL|MiniInsights|MiniWheel|WheelWithKeys/.test(block);
      expect({ fn, hasGenres, hasBpm, hasWheel }).toEqual({ fn, hasGenres: true, hasBpm: true, hasWheel: true });
    }
  });
  it('keeps the taller mockups at the Spotlight Banner height (218px)', () => {
    for (const fn of ['HeroBento', 'HeroEditorial', 'HeroGalleryMasthead', 'HeroSwissIndex', 'HeroQuietRegister']) {
      const start = src.indexOf(`function ${fn}(`);
      const end = src.indexOf('\nfunction ', start + 10);
      expect({ fn, fixed: src.slice(start, end === -1 ? undefined : end).includes('h-[218px]') }).toEqual({ fn, fixed: true });
    }
  });
});
