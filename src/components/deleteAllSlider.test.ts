import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SLIDER_TRACK_HEIGHT, THUMB_SIZE, TRACK_BORDER, TRACK_PAD, sliderTravel } from './deleteAllSlider';

const source = readFileSync(new URL('./DeleteAllLibrariesModal.tsx', import.meta.url), 'utf8');

describe('Delete All slider', () => {
  const thumb = THUMB_SIZE;
  const pad = TRACK_PAD;
  const border = TRACK_BORDER;

  it('has the same space above the thumb as below it, so it sits centred inside the red border', () => {
    const above = border + pad;
    const below = SLIDER_TRACK_HEIGHT - above - thumb;
    expect(below).toBe(above);
  });

  it('leaves the same space at the far end as at the start when the thumb is dragged all the way across', () => {
    const outerWidth = 600;
    const left = border + pad;
    const right = outerWidth - (left + sliderTravel(outerWidth) + thumb);
    expect(right).toBe(left);
  });

  it('sets the track height from those sizes instead of a fixed number, and measures drags from inside the border', () => {
    expect(source).toContain('style={{ height: SLIDER_TRACK_HEIGHT, borderWidth: TRACK_BORDER }}');
    expect(source).not.toContain('h-[52px]');
    expect(source).toContain('e.clientX - rect.left - TRACK_BORDER - THUMB_SIZE / 2 - TRACK_PAD');
  });
});
