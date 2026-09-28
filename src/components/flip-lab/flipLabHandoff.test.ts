import { describe, expect, it } from 'vitest';
import { routeToUrl } from '../../navigation/appRoutes';
import { buildFlipLabDropLabRoute } from './flipLabHandoff';

describe('Flip Lab to Drop Lab handoff', () => {
  it('passes only the selected parent tracks and leaves drop identities unset', () => {
    const route = buildFlipLabDropLabRoute('vocal-parent', 'instrumental-parent');

    expect(route).toEqual({
      name: 'drop-lab',
      sourceTrackId: 'vocal-parent',
      candidateTrackId: 'instrumental-parent',
      sourceDropId: null,
      candidateDropId: null,
    });
    expect(Object.keys(route).sort()).toEqual([
      'candidateDropId',
      'candidateTrackId',
      'name',
      'sourceDropId',
      'sourceTrackId',
    ]);
    expect(routeToUrl(route)).toBe('/drop-lab/vocal-parent?candidate=instrumental-parent');
  });
});
