import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./useRekordboxPlaylists.ts', import.meta.url), 'utf8');

describe('useRekordboxPlaylists Stage 5 request ownership', () => {
  it('invalidates stale playlist loads when the import scope changes', () => {
    expect(source).toContain('const generationRef = useRef(0);');
    expect(source).toContain('const generation = ++generationRef.current;');
    expect(source).toContain('let cancelled = false;');
    expect(source).toContain('if (cancelled || generation !== generationRef.current) return;');
    expect(source).toContain('return () => {');
    expect(source).toContain('cancelled = true;');
  });

  it('clears prior-import playlist state immediately and resets null-import state completely', () => {
    expect(source).toContain('setPlaylists([]);');
    expect(source).toContain('setLoading(false);');
    expect(source).toContain('setError(null);');
    expect(source).toContain('setLoading(true);');
  });
});
