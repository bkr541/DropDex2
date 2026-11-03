import { describe, expect, it } from 'vitest';
import { commitTypedBound } from './dualRangeMath';

const bounds: [number, number] = [71, 192];

describe('commitTypedBound', () => {
  it('sets the low end to the typed number', () => {
    expect(commitTypedBound('minimum', '120', [71, 192], bounds)).toEqual([120, 192]);
  });

  it('sets the high end to the typed number', () => {
    expect(commitTypedBound('maximum', '150', [71, 192], bounds)).toEqual([71, 150]);
  });

  it('keeps each end inside the limits', () => {
    expect(commitTypedBound('minimum', '10', [100, 160], bounds)).toEqual([71, 160]);
    expect(commitTypedBound('maximum', '900', [100, 160], bounds)).toEqual([100, 192]);
  });

  it('lets one end reach the other but never cross it', () => {
    expect(commitTypedBound('minimum', '170', [100, 160], bounds)).toEqual([160, 160]);
    expect(commitTypedBound('maximum', '90', [100, 160], bounds)).toEqual([100, 100]);
  });

  it('ignores anything that is not a number', () => {
    expect(commitTypedBound('minimum', '', [100, 160], bounds)).toBeNull();
    expect(commitTypedBound('minimum', 'abc', [100, 160], bounds)).toBeNull();
    expect(commitTypedBound('maximum', ' - ', [100, 160], bounds)).toBeNull();
  });

  it('takes the digits out of mixed text', () => {
    expect(commitTypedBound('minimum', 'a1b2c0', [71, 192], bounds)).toEqual([120, 192]);
  });
});
