import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HeroMockupsContent } from './LayoutLabHeroMockups';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const markupOf = () => renderToStaticMarkup(createElement(HeroMockupsContent));
const src = readFileSync(resolve(__dirname, './LayoutLabHeroMockups.tsx'), 'utf8');
const sample = readFileSync(resolve(__dirname, './layoutLabHeroSample.ts'), 'utf8');
const navDesign = readFileSync(resolve(__dirname, './LayoutLabNavDesignMockups.tsx'), 'utf8');
const body = src.slice(src.indexOf('export function HeroMockupsContent'));

const ORIGINAL = ['HeroAurora', 'HeroGlassDuo', 'HeroPoster', 'HeroStudioStrip', 'HeroSplitCover'];
const NEW = ['HeroNameWash', 'HeroGhostBanner', 'HeroLedger', 'HeroTileWall', 'HeroSplitName'];
const MOCKUPS = [...ORIGINAL, ...NEW];
const block = (fn: string) => {
  const start = src.indexOf(`function ${fn}(`);
  const end = src.indexOf('\n// ──', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
};

describe('Layout Lab hero mockups', () => {
  it('shows ten mockups, and none of the first old ten', () => {
    expect(body.match(/<HeroMockupCard /g)).toHaveLength(10);
    for (const old of ['HeroSpotlight', 'HeroBento', 'HeroEditorial', 'HeroTypographic', 'HeroPlates', 'HeroSwiss', 'HeroHub', 'HeroMonograph', 'HeroInstrument']) expect(src).not.toContain(old);
  });

  it('keeps every mockup at the production hero height (218px) through one shared frame', () => {
    expect(src).toContain("'lh-frame relative h-[218px] overflow-hidden'");
    for (const fn of MOCKUPS) expect({ fn, framed: block(fn).includes('<HeroFrame') }).toEqual({ fn, framed: true });
  });

  it('has no analysis and none of the genre, BPM or Camelot key groups', () => {
    for (const word of ['GenreList', 'BpmChart', 'Wheel', 'CamelotWheel', 'InsightCharts', 'Top Genres', 'BPM Distribution', 'Track Analysis', 'Analysis Complete', 'ProgressBar']) expect(src).not.toContain(word);
    for (const key of ['SAMPLE_GENRES', 'SAMPLE_BPM', 'SAMPLE_KEYS', 'bpm:', 'genre:']) expect(sample).not.toContain(key);
  });

  it('shows the profile, socials, USB import and library counts in every mockup', () => {
    for (const fn of ORIGINAL) {
      const b = block(fn);
      expect({ fn, name: b.includes('HERO.name'), socials: b.includes('<Socials'), usb: /<UsbLine|Import Complete|<Done/.test(b), import: b.includes('<ImportButton'), counts: b.includes('HERO.tracks') }).toEqual({ fn, name: true, socials: true, usb: true, import: true, counts: true });
    }
  });

  it('uses the shared primary button for Import Library', () => {
    expect(src).toContain('<ControlButton variant="primary"');
  });

  it('is what the Nav Design tab pairs each navigation with', () => {
    for (const fn of ORIGINAL) expect(navDesign).toContain(`hero: ${fn}`);
    expect(navDesign).not.toMatch(/hero: Hero(Spotlight|Bento|Typographic|Hub|Instrument)/);
  });

  it('is in the graphite look: graphite surfaces, light type, 9px spaced labels, coral and mint, and none of the old purples and blues', () => {
    const css = read('./layout-lab-hero.css');
    expect(css).toContain('background: linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%);');
    expect(css).toMatch(/\.lh-label \{[^}]*font-size: 9px[^}]*letter-spacing: \.16em[^}]*text-transform: uppercase/);
    expect(css).toMatch(/\.lh-figure \{ font-weight: 300;/);
    expect(css).toMatch(/\.lh-done \{[^}]*color: #6fd9a4/);
    for (const old of ['rgba(18,10,32', 'rgba(30,16,50', '#0b0f17', '#141a26', '#0d121b', 'rgba(56,120,255', 'rgba(80,110,255', 'rgba(70,90,200', 'text-emerald-500', 'font-black']) expect(src, old).not.toContain(old);
    expect(markupOf()).toContain('lh-stage');
  });

  it('gives each mockup its own finish on the same palette', () => {
    const finishes = { HeroAurora: 'lh-f-aurora', HeroGlassDuo: 'lh-f-glass', HeroPoster: 'lh-f-poster', HeroStudioStrip: 'lh-f-strip', HeroSplitCover: 'lh-f-cover', HeroNameWash: 'lh-f-wash', HeroGhostBanner: 'lh-f-ghost', HeroLedger: 'lh-f-ledger', HeroTileWall: 'lh-f-tiles', HeroSplitName: 'lh-f-two' };
    for (const [fn, finish] of Object.entries(finishes)) expect(block(fn), fn).toContain(`<HeroFrame className="${finish}`);
    expect(new Set(Object.values(finishes)).size).toBe(10);
    const css = read('./layout-lab-hero.css');
    for (const finish of Object.values(finishes)) expect(css).toContain(`.${finish} {`);
    // Real differences in depth and texture: a vignette and frosted glass, brushed grain, a raised cover.
    expect(css).toMatch(/\.lh-f-glass \{[^}]*radial-gradient\(ellipse at 50% 40%/);
    expect(css).toMatch(/\.lh-glass \{[^}]*backdrop-filter: blur\(14px\)/);
    expect(css).toMatch(/\.lh-f-poster \{[^}]*repeating-linear-gradient\(0deg, #ffffff06 0 1px/);
    expect(css).toMatch(/\.lh-cover \{[^}]*inset 0 1px 0 #ffffff1f/);
  });

  describe('mockups six to ten', () => {
    const markup = markupOf();
    const slice = (n: number) => {
      const start = markup.indexOf('data-testid="hero-mockup"', markup.indexOf(`>${n}</div>`) - 200);
      const next = markup.indexOf('data-testid="hero-mockup"', start + 10);
      return markup.slice(start, next === -1 ? undefined : next);
    };

    it('puts the artist name in the background of each, as a huge faded word', () => {
      for (const [i, fn] of NEW.entries()) {
        const b = block(fn);
        expect(b, fn).toContain('<Watermark');
        const part = slice(i + 6);
        expect(part, fn).toContain('data-testid="hero-watermark"');
        expect(part, fn).toContain('aria-hidden="true"');
      }
      const css = read('./layout-lab-hero.css');
      expect(css).toMatch(/\.lh-watermark \{[^}]*font-weight: 300[^}]*opacity: \.085/);
      for (const wm of ['right', 'up', 'outline', 'center', 'two']) expect(css).toMatch(new RegExp(`\\.lh-wm-${wm} \\{[^}]*mask-image: linear-gradient`));
      expect(css).toMatch(/\.lh-wm-(right|up|outline|center|two) \{[^}]*font-size: (1[3-9]\d|2\d\d)px/);
    });

    it('shows exactly seven values in each, taken from what DropDex keeps about a user', () => {
      for (let n = 6; n <= 10; n += 1) {
        const part = slice(n);
        expect(part.match(/data-testid="hero-value"/g), `mockup ${n}`).toHaveLength(7);
        for (const label of ['Tracks', 'Playlists', 'USBs', 'Cue points', 'Genres', 'Analysed', 'In the cloud']) expect(part, `mockup ${n} ${label}`).toContain(label);
      }
      for (const key of ['usbs:', 'cuePoints:', 'genreCount:', 'analysedPct:', 'cloudSynced:']) expect(sample).toContain(key);
    });

    it('makes the picture, name and social icons fill the height of the strip', () => {
      for (const fn of NEW) expect(block(fn), fn).toContain('<Identity');
      const sizes = [...src.matchAll(/<Identity([^/]*)\/>/g)].map((m) => Number(/avatar=\{(\d+)\}/.exec(m[1])?.[1] ?? 172));
      expect(sizes).toHaveLength(5);
      for (const size of sizes) { expect(size).toBeGreaterThanOrEqual(160); expect(size).toBeLessThanOrEqual(190); }
      // The strip is 218px tall, so a 160 to 190px picture takes at least three quarters of it.
      expect(src).toContain("'lh-frame relative h-[218px] overflow-hidden'");
      expect(src).toContain('<Socials size={26}');
      expect(src).toMatch(/nameClass = 'text-\[44px\]'/);
      expect(markup).toContain('data-testid="hero-identity"');
    });

    it('draws each name block once for the identity and keeps the watermark out of the way of clicks', () => {
      expect(read('./layout-lab-hero.css')).toMatch(/\.lh-watermark \{[^}]*pointer-events: none/);
    });
  });
});
