import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuietProgress } from './QuietProgress';
import { quietOverallPercent, quietPhaseState, quietStagePercent } from './quietProgressMath';

const phases = [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }, { id: 'c', label: 'Three' }];
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('quiet progress math', () => {
  it('spreads the percent across the phases and never reaches 100 until done', () => {
    expect(quietOverallPercent(0, 3)).toBe(0);
    expect(quietOverallPercent(1, 3, 50)).toBe(75);
    expect(quietOverallPercent(2, 3, 100)).toBe(99);
    expect(quietOverallPercent(2, 3, 0, true)).toBe(100);
  });

  it('marks phases done, active and to do', () => {
    expect(quietPhaseState(0, 1, 'running')).toBe('done');
    expect(quietPhaseState(1, 1, 'running')).toBe('active');
    expect(quietPhaseState(2, 1, 'running')).toBe('todo');
    expect(quietStagePercent(0, 3, 150)).toBeLessThanOrEqual(100);
  });
});

describe('QuietProgress', () => {
  it('renders the percent, every phase, the headline and the figures', () => {
    const html = renderToStaticMarkup(createElement(QuietProgress, {
      title: 'Test', phases, activeIndex: 1, percent: 40, headline: 'Working on it.', figures: [{ label: 'Files', value: '3' }],
    }));
    expect(html).toContain('role="progressbar"');
    for (const label of ['One', 'Two', 'Three', 'Working on it.', 'Files']) expect(html).toContain(label);
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
  });
});

describe('every progress popover uses QuietProgress', () => {
  it.each([
    'ImportStageProgress.tsx',
    'discovery/DiscoveryScrapeProgressModal.tsx',
    'profile/StreamingSyncGroup.tsx',
    'ResumeAnalysisModal.tsx',
    'BackgroundImportPanel.tsx',
  ])('%s', (file) => {
    expect(read(file)).toContain('<QuietProgress');
  });
});
