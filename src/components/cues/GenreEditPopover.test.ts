import { describe, expect, it } from 'vitest';
import { genreEditorPosition } from './GenreEditPopover';

describe('floating genre editor placement', () => {
  const popup = { width: 260, height: 56 };
  const viewport = { width: 1200, height: 800 };
  it('uses its full width below the genre cell when there is room', () => {
    expect(genreEditorPosition({ left: 700, top: 200, bottom: 240 }, popup, viewport)).toEqual({ left: 700, top: 246 });
  });
  it('moves inward at the right edge without reducing the input width', () => {
    const position = genreEditorPosition({ left: 1150, top: 200, bottom: 240 }, popup, viewport);
    expect(position.left).toBe(928);
    expect(position.left + popup.width).toBe(viewport.width - 12);
  });
  it('opens above a cell near the bottom, including a larger error message', () => {
    expect(genreEditorPosition({ left: 700, top: 740, bottom: 780 }, { ...popup, height: 120 }, viewport))
      .toEqual({ left: 700, top: 614 });
  });
  it('keeps the full editor inside a narrow viewport', () => {
    expect(genreEditorPosition({ left: 260, top: 100, bottom: 140 }, popup, { width: 320, height: 600 }))
      .toEqual({ left: 48, top: 146 });
  });
});
