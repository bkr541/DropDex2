import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './lazyWithRecovery';

describe('lazy chunk recovery', () => {
  it('recognizes stale deployment chunk errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/App-old.js'))).toBe(true);
    expect(isChunkLoadError(new Error('ChunkLoadError: Loading chunk 42 failed'))).toBe(true);
  });

  it('does not classify ordinary render errors as chunk failures', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
