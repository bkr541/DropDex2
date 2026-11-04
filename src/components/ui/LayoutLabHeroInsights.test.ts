import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, './LayoutLabHeroMockups.tsx'), 'utf8');
const body = src.slice(src.indexOf('export function HeroMockupsContent'));
const wheelSource = readFileSync(resolve(__dirname, '../library/InsightCharts.tsx'), 'utf8');

const MOCKUPS = ['HeroSpotlight', 'HeroBento', 'HeroEditorial', 'HeroTypographic', 'HeroPlates', 'HeroSwiss', 'HeroHub', 'HeroLedger', 'HeroMonograph', 'HeroInstrument'];

const block = (fn: string) => {
  const start = src.indexOf(`function ${fn}(`);
  const end = src.indexOf('\nfunction ', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
};

describe('Layout Lab hero mockups', () => {
  it('shows ten mockups, and none of the removed premium ones', () => {
    expect(body.match(/<HeroMockupCard /g)).toHaveLength(10);
    for (const name of ['Obsidian', 'Champagne', 'Neon Noir', 'Frosted Aurora', 'Platinum']) expect(src).not.toContain(name);
  });
  it('keeps every mockup at the production hero height (218px) through one shared frame', () => {
    expect(src).toContain("'relative h-[218px] overflow-hidden'");
    for (const fn of MOCKUPS) expect({ fn, framed: block(fn).includes('<HeroFrame') }).toEqual({ fn, framed: true });
  });
  it('includes the top genres, BPM distribution and Camelot wheel in every mockup', () => {
    for (const fn of MOCKUPS) {
      const b = block(fn);
      expect({ fn, genres: /<GenreList|<LedGenres/.test(b), bpm: /<BpmChart|<LedTempo/.test(b), wheel: /<Wheel/.test(b) }).toEqual({ fn, genres: true, bpm: true, wheel: true });
    }
  });
  it('draws the Camelot wheel big enough to read every key name', () => {
    // Names are 9 units in the wheel's 160-unit drawing, so any wheel at least 160px wide shows them at 9px or larger.
    expect(src).toContain('labelSize={9}');
    const sizes = [...src.matchAll(/<Wheel[^>]*size=\{(\d+)\}/g)].map((m) => Number(m[1]));
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(160);
    expect(src).toContain('function Wheel({ size = 162');
  });
  it('lets the production wheel keep its original label size', () => {
    expect(wheelSource).toContain('labelSize = 6');
  });
  it('sizes groups to their content instead of stretching them', () => {
    expect(src).not.toContain('justify-between gap-4 px-6');
    for (const fn of ['HeroBento', 'HeroPlates', 'HeroSwiss', 'HeroLedger']) expect({ fn, hugs: block(fn).includes('w-fit') }).toEqual({ fn, hugs: true });
  });
});
