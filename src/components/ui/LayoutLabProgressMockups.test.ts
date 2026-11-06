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
    expect(progressModel(PROCESSES[1], 100).stageIndex).toBe(3);
    expect(progressModel(PROCESSES[2], 100).stageIndex).toBe(2);
    expect(progressModel(rekordbox, 250).percent).toBe(100);
  });
});
