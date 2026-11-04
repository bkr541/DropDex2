import { describe, expect, it } from 'vitest';
import { describeCategories, deviceKeyFor, formatBytes, makeAndModel, percentUsed } from './usbFormat';

describe('USB formatting', () => {
  it('writes sizes the way drives are sold, in powers of 1000', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(64_000_000_000)).toBe('64 GB');
    expect(formatBytes(1_234_000_000_000)).toBe('1.23 TB');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
  it('says how full a drive is', () => {
    expect(percentUsed({ totalBytes: 100, usedBytes: 25 })).toBe(25);
    expect(percentUsed({ totalBytes: 100, usedBytes: 250 })).toBe(100);
    expect(percentUsed({ totalBytes: null, usedBytes: 5 })).toBeNull();
    expect(percentUsed(null)).toBeNull();
  });
  it('recognises the same drive again by its volume id, or by name and size', () => {
    expect(deviceKeyFor({ volumeUuid: 'ABC-1', volumeName: 'DJ', totalBytes: 1 })).toBe('uuid:abc-1');
    expect(deviceKeyFor({ volumeUuid: null, volumeName: ' DJ STICK ', totalBytes: 64 })).toBe('name:dj stick|64');
    expect(deviceKeyFor({ volumeUuid: null, volumeName: 'x', totalBytes: null })).toBe('name:x|unknown');
  });
  it('joins make and model, and lists what is being copied', () => {
    expect(makeAndModel({ brand: 'SanDisk', model: 'Ultra' })).toBe('SanDisk Ultra');
    expect(makeAndModel({ brand: null, model: null })).toBeNull();
    expect(describeCategories(['tracks'])).toBe('Tracks');
    expect(describeCategories(['tracks', 'rekordbox', 'other'])).toBe('Tracks, Rekordbox library and Other files');
    expect(describeCategories([])).toBe('Nothing');
  });
});
