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

describe('artist library hero', () => {
  it('shows genres, BPM distribution and the Camelot wheel instead of the main BPM, key and genre', () => {
    expect(hero).toContain('data-testid="hero-insights"');
    expect(hero).toContain('<InsightTopGenres genres={topGenres} compact />');
    expect(hero).toContain('<InsightBpmDistribution bpmRangeStats={bpmRangeStats} compact />');
    expect(hero).toContain('<InsightKeyProfile keyStats={keyStats} compact />');
    expect(hero).not.toContain("label: 'Main BPM'");
  });
  it('uses narrower USB import and track analysis cards', () => {
    expect(hero.match(/px-3 py-3 w-\[200px\] shrink-0/g)).toHaveLength(2);
    expect(hero).not.toContain('w-[264px]');
  });
  it('keeps the hero at its original 218px height', () => {
    expect(hero).toContain('relative z-10 flex h-[218px] items-stretch');
  });
});
