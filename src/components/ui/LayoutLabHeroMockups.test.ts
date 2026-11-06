import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, './LayoutLabHeroMockups.tsx'), 'utf8');
const sample = readFileSync(resolve(__dirname, './layoutLabHeroSample.ts'), 'utf8');
const navDesign = readFileSync(resolve(__dirname, './LayoutLabNavDesignMockups.tsx'), 'utf8');
const body = src.slice(src.indexOf('export function HeroMockupsContent'));

const MOCKUPS = ['HeroAurora', 'HeroGlassDuo', 'HeroPoster', 'HeroStudioStrip', 'HeroSplitCover'];
const block = (fn: string) => {
  const start = src.indexOf(`function ${fn}(`);
  const end = src.indexOf('\n// ──', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
};

describe('Layout Lab hero mockups', () => {
  it('shows five mockups, and none of the old ten', () => {
    expect(body.match(/<HeroMockupCard /g)).toHaveLength(5);
    for (const old of ['HeroSpotlight', 'HeroBento', 'HeroEditorial', 'HeroTypographic', 'HeroPlates', 'HeroSwiss', 'HeroHub', 'HeroLedger', 'HeroMonograph', 'HeroInstrument']) expect(src).not.toContain(old);
  });

  it('keeps every mockup at the production hero height (218px) through one shared frame', () => {
    expect(src).toContain("'relative h-[218px] overflow-hidden'");
    for (const fn of MOCKUPS) expect({ fn, framed: block(fn).includes('<HeroFrame') }).toEqual({ fn, framed: true });
  });

  it('has no analysis and none of the genre, BPM or Camelot key groups', () => {
    for (const word of ['GenreList', 'BpmChart', 'Wheel', 'CamelotWheel', 'InsightCharts', 'Top Genres', 'BPM Distribution', 'Track Analysis', 'Analysis Complete', 'ProgressBar']) expect(src).not.toContain(word);
    for (const key of ['SAMPLE_GENRES', 'SAMPLE_BPM', 'SAMPLE_KEYS', 'bpm:', 'genre:']) expect(sample).not.toContain(key);
  });

  it('shows the profile, socials, USB import and library counts in every mockup', () => {
    for (const fn of MOCKUPS) {
      const b = block(fn);
      expect({ fn, name: b.includes('HERO.name'), socials: b.includes('<Socials'), usb: /<UsbLine|Import Complete|<Done/.test(b), import: b.includes('<ImportButton'), counts: b.includes('HERO.tracks') }).toEqual({ fn, name: true, socials: true, usb: true, import: true, counts: true });
    }
  });

  it('uses the shared primary button for Import Library', () => {
    expect(src).toContain('<ControlButton variant="primary"');
  });

  it('is what the Nav Design tab pairs each navigation with', () => {
    for (const fn of MOCKUPS) expect(navDesign).toContain(`hero: ${fn}`);
    expect(navDesign).not.toMatch(/hero: Hero(Spotlight|Bento|Typographic|Hub|Instrument)/);
  });
});
