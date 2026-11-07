import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DiscoveryMockupsContent } from './LayoutLabDiscoveryMockups';
import { CARD_KINDS } from './layoutLabDiscoveryData';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const markup = renderToStaticMarkup(createElement(DiscoveryMockupsContent));
const css = read('./layout-lab-discovery.css');

const rows = (testId: string) => [...markup.matchAll(new RegExp(`data-testid="${testId}" data-style="([a-z]+)"`, 'g'))].map((m) => m[1]);
const slice = (testId: string, style: string) => {
  const start = markup.indexOf(`data-testid="${testId}" data-style="${style}"`);
  const next = markup.indexOf('class="ld-row"', start + 10);
  return markup.slice(start, next === -1 ? undefined : next);
};

describe('Layout Lab Discovery tab', () => {
  it('is a tab called Discovery', () => {
    const win = read('./LayoutLabWindow.tsx');
    expect(win).toContain("{ id: 'discovery', label: 'Discovery' }");
    expect(win).toContain("activeId === 'discovery'");
    expect(win).toContain('<DiscoveryMockupsContent />');
  });

  it('has four genre filter rows, each styled differently', () => {
    const genre = rows('genre-row');
    expect(genre).toEqual(['tabs', 'chips', 'rail', 'multi']);
    for (const cls of ['ld-g-tabs', 'ld-g-chips', 'ld-g-rail', 'ld-g-multi']) expect(markup).toContain(`ld-genres ${cls}`);
    expect(markup).toContain('Melodic Dubstep');
  });

  it('has four rows of five cards, left to right an artist, a genre, a DJ set, the artist count and the genre count', () => {
    expect(CARD_KINDS).toEqual(['artist', 'genre', 'set', 'artists', 'genres']);
    expect(rows('card-row')).toEqual(['studio', 'raised', 'wells', 'poster']);
    const cardClass = { studio: 'ld-a-card', raised: 'ld-b-card', wells: 'ld-c-card', poster: 'ld-d-card' } as const;
    for (const [style, cls] of Object.entries(cardClass)) {
      const row = slice('card-row', style);
      expect(row.match(new RegExp(`class="${cls}[ "]`, 'g')), style).toHaveLength(5);
      // artist, genre, set, artist count, genre count: the content appears in that order.
      const order = ['ILLENIUM', 'Melodic Dubstep', 'Lost Lands 2025', '1,420', '849'].map((text) => row.indexOf(text));
      expect(order.every((at) => at >= 0), style).toBe(true);
      expect([...order].sort((a, b) => a - b), style).toEqual(order);
    }
  });

  it('gives each card row its own depth and texture', () => {
    expect(css).toContain('.ld-b-card::after');
    expect(css).toContain('feTurbulence');
    expect(css).toMatch(/\.ld-c-card \{[^}]*inset 0 3px 8px #000000b3/);
    expect(css).toMatch(/\.ld-cards-wells \{[^}]*repeating-linear-gradient\(0deg/);
    expect(css).toMatch(/\.ld-d-art::after \{[^}]*radial-gradient\(#ffffff2e 1px/);
    expect(css).toContain('backdrop-filter: blur(16px) saturate(1.4)');
    expect(css).toMatch(/\.ld-a-card \{[^}]*background: #ffffff05/);
  });

  it('puts the card elements in different places in each row', () => {
    expect(slice('card-row', 'studio').indexOf('ld-a-foot')).toBeGreaterThan(-1);
    expect(slice('card-row', 'raised')).toContain('ld-b-ring');
    expect(slice('card-row', 'wells')).toContain('ld-c-copy');
    expect(slice('card-row', 'poster')).toContain('ld-d-plate');
    expect(slice('card-row', 'poster').indexOf('ld-d-art')).toBeLessThan(slice('card-row', 'poster').indexOf('ld-d-plate'));
  });

  it('has four hero sections for a DJ, none alike', () => {
    expect(rows('hero-row')).toEqual(['builder', 'fresh', 'digger', 'spotlight']);
    expect(slice('hero-row', 'builder')).toContain('What do you need next?');
    expect(slice('hero-row', 'builder')).toContain('7A');
    expect(slice('hero-row', 'fresh')).toContain('Fresh this week');
    expect(slice('hero-row', 'digger')).toContain('Because you play Melodic Dubstep');
    expect(slice('hero-row', 'spotlight')).toContain('Picked for you');
    // The fourth group is styled exactly like Fresh This Week: both are the one shared header group component.
    expect(slice('hero-row', 'spotlight').replace(/<(\w+)[^>]*>/g, '<$1>').split('<em>').length).toBe(slice('hero-row', 'fresh').replace(/<(\w+)[^>]*>/g, '<$1>').split('<em>').length);
    expect(slice('hero-row', 'spotlight')).toContain('ld-h-week');
    expect(read('./LayoutLabDiscoveryMockups.tsx').match(/<HeroGroup/g)).toHaveLength(2);
    for (const cls of ['ld-h-builder', 'ld-h-fresh', 'ld-h-digger', 'ld-h-spot']) expect(markup).toContain(`ld-hero ${cls}`);
  });

  it('uses the shared primary and secondary buttons', () => {
    expect(read('./LayoutLabDiscoveryMockups.tsx')).toContain('<ControlButton variant="primary"');
    expect(read('./LayoutLabDiscoveryMockups.tsx')).toContain('<ControlButton variant="secondary"');
  });
});
