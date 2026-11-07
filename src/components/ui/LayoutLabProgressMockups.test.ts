import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PROCESSES, progressModel } from './layoutLabProgressData';
import { ProgressMockupsContent } from './LayoutLabProgressMockups';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const windowSource = readFileSync(resolve(__dirname, './LayoutLabWindow.tsx'), 'utf8');

describe('Layout Lab Progress tab', () => {
  it('is a tab called Progress that shows the progress mockups', () => {
    expect(windowSource).toContain("{ id: 'progress', label: 'Progress' }");
    expect(windowSource).toContain("activeId === 'progress'");
    expect(windowSource).toContain('<ProgressMockupsContent />');
  });

  it('shows ten different looks, each for the Rekordbox import, the artist set search and the cloud sync', () => {
    expect(PROCESSES.map((p) => p.id)).toEqual(['rekordbox', 'sets', 'cloud']);
    const markup = renderToStaticMarkup(createElement(ProgressMockupsContent));
    const looks = [...markup.matchAll(/data-look="([^"]+)"/g)].map((m) => m[1]);
    expect(looks).toHaveLength(10);
    expect(new Set(looks).size).toBe(10);
    for (const id of PROCESSES.map((p) => p.id)) expect(markup.split(`data-process="${id}"`).length - 1).toBe(10);
  });

  it('works out the stage, the share of that stage and when the job is done', () => {
    const rekordbox = PROCESSES[0];
    expect(progressModel(rekordbox, 0)).toMatchObject({ stageIndex: 0, stagePercent: 0, done: false });
    expect(progressModel(rekordbox, 62)).toMatchObject({ stageIndex: 2, done: false });
    expect(progressModel(rekordbox, 99.9).stageIndex).toBe(3);
    expect(progressModel(rekordbox, 100)).toMatchObject({ stageIndex: 4, done: true, headline: 'Book imported with analysis' });
    expect(progressModel(PROCESSES[1], 100).stageIndex).toBe(4);
    expect(progressModel(PROCESSES[2], 100).stageIndex).toBe(3);
    expect(progressModel(rekordbox, 250).percent).toBe(100);
  });

  it('Quiet Figure shows every phase of each job, numbered, with the current one marked', () => {
    const markup = renderToStaticMarkup(createElement(ProgressMockupsContent));
    const quiet = markup.slice(markup.indexOf('data-look="quiet"'), markup.indexOf('data-look="stage-bars"'));
    expect(quiet.split('data-testid="quiet-phases"').length - 1).toBe(3);
    for (const label of ['Source', 'Database', 'Analysis files', 'Analyze', 'Searching', 'Collecting', 'Saving', 'Upload', 'Verify']) expect(quiet).toContain(`>${label}</p>`);
    expect(quiet.split('aria-current="step"').length - 1).toBe(3);
    expect(quiet).toContain('>05</p>');
    expect(quiet).toContain('Phase 3 of 5');
  });

  it('gives the artist set search five phases: queued, searching, collecting, saving, complete', () => {
    expect(PROCESSES[1].steps.map((step) => step.id)).toEqual(['queued', 'search', 'collect', 'save', 'complete']);
    expect(progressModel(PROCESSES[1], 90)).toMatchObject({ stageIndex: 3, headline: 'Saving the sets to your library…' });
  });
});

describe('Layout Lab tabs with their mockups removed', () => {
  const blank = ['scratch-pad', 'drop-lab', 'icons'];
  it('keeps the Scratch Pad, Drop Lab and Icons tabs, which show the blank canvas', () => {
    for (const [id, label] of [['scratch-pad', 'Scratch Pad'], ['drop-lab', 'Drop Lab'], ['icons', 'Icons']]) expect(windowSource).toContain(`{ id: '${id}'`), expect(windowSource).toContain(`label: '${label}'`);
    for (const id of blank) expect(windowSource).not.toContain(`activeId === '${id}'`);
    expect(windowSource).toContain('<BlankCanvas />');
  });

  it('no longer has the mockups, their parts or their data', () => {
    for (const gone of ['ScratchPadContent', 'Mockup2', 'Mockup11', 'IconMockupsContent', 'DropLabMockupsContent']) expect(windowSource).not.toContain(gone);
    for (const file of ['LayoutLabDropLabMockups.tsx', 'LayoutLabDropLabParts.tsx', 'LayoutLabIconMockups.tsx', 'layoutLabIconData.ts']) {
      expect(() => readFileSync(resolve(__dirname, file))).toThrow();
    }
  });
});

describe('Every progress look names every phase of its job, in the graphite look', () => {
  const markup = renderToStaticMarkup(createElement(ProgressMockupsContent));
  const looks = [...markup.matchAll(/data-look="([a-z-]+)"/g)].map((m) => m[1]);
  const lookSlice = (id: string) => {
    const start = markup.indexOf(`data-look="${id}"`);
    const next = markup.indexOf('data-testid="progress-look"', start + 10);
    return markup.slice(start, next === -1 ? undefined : next);
  };
  const cardSlice = (look: string, process: string) => {
    const row = lookSlice(look);
    const start = row.indexOf(`data-process="${process}"`);
    const next = row.indexOf('data-process="', start + 10);
    return row.slice(start, next === -1 ? undefined : next);
  };
  const css = readFileSync(resolve(__dirname, './layout-lab-progress.css'), 'utf8');

  it('shows every phase of the Rekordbox import, the artist set search and the cloud sync in all ten looks', () => {
    expect(looks).toHaveLength(10);
    for (const look of looks) {
      for (const process of PROCESSES) {
        const card = cardSlice(look, process.id);
        for (const step of process.steps) expect(card, `${look} / ${process.id} / ${step.label}`).toContain(step.label);
      }
    }
  });

  it('tells finished, current and coming phases apart in every card, one current phase at a time', () => {
    for (const look of looks) {
      for (const [process, expected] of [['rekordbox', [2, 1, 2]], ['sets', [2, 1, 2]], ['cloud', [1, 1, 2]]] as const) {
        const card = cardSlice(look, process);
        const count = (state: string) => (card.match(new RegExp(`data-phase-state="${state}"`, 'g')) ?? []).length;
        expect([count('done'), count('active'), count('todo')], `${look} / ${process}`).toEqual(expected);
      }
    }
  });

  it('numbers the phases in every look, so the order is clear', () => {
    for (const look of looks) {
      const rekordbox = cardSlice(look, 'rekordbox');
      for (const n of ['01', '02', '03', '04', '05']) expect(rekordbox, `${look} ${n}`).toContain(`>${n}<`);
    }
  });

  it('wears the graphite look: the Discovery backdrop, graphite cards, the coral accent and no leftover blues', () => {
    expect(css).toContain('background: linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%);');
    expect(css).toMatch(/\.lp-card \{[^}]*linear-gradient\(165deg, #30353f 0%, #252931 45%, #1d2129 100%\)/);
    expect(css).toMatch(/\.lp-label \{[^}]*font-size: 9px[^}]*letter-spacing: \.16em[^}]*text-transform: uppercase/);
    const source = readFileSync(resolve(__dirname, './LayoutLabProgressMockups.tsx'), 'utf8');
    for (const old of ['#168cff', "'#fbbf24'", 'StageStepper', 'bg-[var(--color-panel)]', 'font-mono text-[13px] font-black']) expect(source).not.toContain(old);
    expect(markup).toContain('lp-stage');
    expect(markup.match(/class="lp-card"/g)).toHaveLength(30);
  });

  it('keeps Quiet Figure as it was', () => {
    expect(cardSlice('quiet', 'rekordbox')).toContain('data-testid="quiet-phases"');
    expect(cardSlice('quiet', 'rekordbox')).toContain('Phase 3 of 5');
  });

  it('centres each value and its label in its own cell in Quiet Figure, and leaves the other rows as they were', () => {
    for (const process of ['rekordbox', 'sets', 'cloud']) {
      const card = cardSlice('quiet', process);
      expect(card, process).toContain('class="lp-figures lp-figures-centered mt-4"');
      expect(card.match(/<div><p>/g), process).toHaveLength(3);
    }
    for (const look of looks.filter((id) => id !== 'quiet')) {
      for (const process of ['rekordbox', 'sets', 'cloud']) expect(cardSlice(look, process), `${look} ${process}`).not.toContain('lp-figures-centered');
    }
    expect(css).toMatch(/\.lp-figures-centered > div, \.lp-figures-centered > div:first-child \{ padding-inline: 12px; text-align: center; \}/);
    expect(css).toMatch(/\.lp-figures-centered > div:first-child \{ border-left: 0; \}/);
  });
});
