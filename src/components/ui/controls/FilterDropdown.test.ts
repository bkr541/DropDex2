import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./FilterDropdown.tsx', import.meta.url), 'utf8');

describe('FilterDropdown option spacing', () => {
  it('keeps the options close together: 6px above and below each option, not 10px', () => {
    expect(source).toContain("'w-full text-left px-4 py-1.5 text-sm transition-colors hover:bg-white/[0.06]'");
    expect(source).not.toContain('px-4 py-2.5 text-sm');
  });

  it('does not add any space between options', () => {
    const listbox = source.slice(source.indexOf('role="listbox"'), source.indexOf('filtered.length === 0'));
    expect(listbox).not.toMatch(/\bgap-|space-y-|divide-y/);
  });
});
