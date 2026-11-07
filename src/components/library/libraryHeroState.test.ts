import { describe, expect, it } from 'vitest';
import { heroFigure, heroImportState } from './libraryHeroState';

describe('where the latest import stands', () => {
  it('says complete when analysis is done, reused or was never asked for', () => {
    for (const status of ['completed', 'reused', 'not_requested', null, undefined]) expect(heroImportState(status)).toEqual({ tone: 'complete', label: 'Import complete', needsAttention: false });
  });

  it('says paused for every way analysis can be held, failed for a failure, and analysing while it works', () => {
    for (const status of ['paused', 'pause_requested', 'stopping', 'cancelled', 'interrupted']) expect(heroImportState(status).label, status).toBe('Import paused');
    expect(heroImportState('failed')).toMatchObject({ tone: 'failed', label: 'Import failed', needsAttention: true });
    expect(heroImportState('partial')).toMatchObject({ tone: 'incomplete', label: 'Analysis incomplete', needsAttention: true });
    for (const status of ['awaiting_upload', 'uploading', 'uploaded', 'parsing', 'queued']) expect(heroImportState(status), status).toMatchObject({ tone: 'working', label: 'Analysing' });
  });
});

describe('a figure in the hero', () => {
  it('uses thousands separators, and a dash while the count is unknown', () => {
    expect(heroFigure(1234)).toBe('1,234');
    expect(heroFigure(0)).toBe('0');
    expect(heroFigure(null)).toBe('—');
    expect(heroFigure(undefined)).toBe('—');
  });
});
