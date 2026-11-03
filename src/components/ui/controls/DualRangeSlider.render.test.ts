import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DualRangeSlider } from './DualRangeSlider';

const render = (value: [number, number]) => renderToStaticMarkup(createElement(DualRangeSlider, {
  variant: 'rings', bounds: [71, 192], value, onChange: vi.fn(), onReset: vi.fn(),
}));

describe('BPM range slider (rings, the Layout Lab "Current" look)', () => {
  it('shows the BPM label, two sliders with the value inside each round thumb, and a hairline rail', () => {
    const markup = render([71, 192]);
    expect(markup).toContain('>BPM<');
    expect(markup).toContain('aria-label="Minimum BPM"');
    expect(markup).toContain('aria-label="Maximum BPM"');
    expect(markup).toContain('aria-valuenow="71"');
    expect(markup).toContain('aria-valuenow="192"');
    expect(markup).toContain('>71<');
    expect(markup).toContain('>192<');
  });

  it('uses the filter-row palette: muted capital label, thin underline, no blue border', () => {
    const markup = render([71, 192]);
    expect(markup).toContain('text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground');
    expect(markup).toContain('border-b border-white/15');
    expect(markup).not.toContain('border-primary');
  });

  it('offers the red reset only once the range is narrowed', () => {
    expect(render([71, 192])).not.toContain('Reset BPM filter');
    const narrowed = render([100, 160]);
    expect(narrowed).toContain('aria-label="Reset BPM filter"');
    expect(narrowed).toContain('text-red-400');
  });
});

describe('Cue Points filter row alignment', () => {
  it('lets a dropdown fill a taller row: label on top, value and underline at the bottom', async () => {
    const { FilterDropdown } = await import('./FilterDropdown');
    const markup = renderToStaticMarkup(createElement(FilterDropdown, { label: 'Genre', value: '', onChange: vi.fn(), options: [{ value: '', label: 'All' }] }));
    expect(markup).toContain('relative flex min-w-[130px] flex-col');
    expect(markup).toContain('flex flex-1 flex-col justify-between pb-2 border-b');
  });

  it('stretches the real filter row so the BPM slider and the dropdowns share label and underline rows', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../cues/CuePointsView.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../../cues/CuePointsView.tsx', import.meta.url), 'utf8');
    expect(css).toMatch(/\.cue-browser__filters \{\s*align-items: stretch;/);
    expect(source).toContain('cue-browser__filters flex flex-wrap items-stretch');
    expect(source).toContain('flex-col justify-end" data-testid="cue-browser-search"');
    expect(source).toContain('<DualRangeSlider variant="inline"');
  });
});

describe('BPM range slider (inline, used in Cue Points)', () => {
  const inline = (value: [number, number]) => renderToStaticMarkup(createElement(DualRangeSlider, {
    variant: 'inline', bounds: [71, 192], value, onChange: vi.fn(), onReset: vi.fn(),
  }));

  it('shows the two values as plain text in the dropdown text style, with no circles around them', () => {
    const markup = inline([71, 192]);
    expect(markup).toMatch(/text-sm tabular-nums text-foreground text-right"[^>]*>71</);
    expect(markup).toMatch(/text-sm tabular-nums text-foreground text-left"[^>]*>192</);
    expect(markup).not.toContain('h-7 w-7');
    expect(markup).not.toContain('rounded-full bg-[var(--color-control-surface)] border');
    expect(markup).not.toContain('text-[8px]');
  });

  it('is one line tall, so the label sits as close to the value as it does in a dropdown', () => {
    const markup = inline([71, 192]);
    expect(markup).toContain('h-5');
    expect(markup).not.toContain('h-7');
    expect(markup).toContain('mb-1 flex items-start gap-1');
  });

  it('puts each number right beside its drag dot, with room for three digits so the rail never moves', () => {
    const markup = inline([71, 192]);
    expect(markup).toContain('flex items-center gap-1');
    expect(markup).toContain('relative mx-1.5 h-5');
    expect(markup.match(/min-w-\[3ch\]/g)).toHaveLength(2);
    expect(markup).not.toContain('gap-2.5');
  });

  it('keeps both drag handles, with the same labels and keys as the other styles', () => {
    const markup = inline([100, 160]);
    expect(markup).toContain('aria-label="Minimum BPM"');
    expect(markup).toContain('aria-label="Maximum BPM"');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('aria-valuenow="160"');
    expect(markup).toContain('aria-label="Reset BPM filter"');
    expect(inline([71, 192])).not.toContain('Reset BPM filter');
  });
});

describe('BPM range slider: width and typing a value', () => {
  const inline = () => renderToStaticMarkup(createElement(DualRangeSlider, {
    variant: 'inline', bounds: [71, 192], value: [71, 192], onChange: vi.fn(), onReset: vi.fn(),
  }));

  it('is 148px wide, narrower than the other styles, so the middle rail is shorter', async () => {
    const { readFileSync } = await import('node:fs');
    expect(inline()).toContain('min-w-[148px]');
    expect(inline()).not.toContain('min-w-[180px]');
    expect(render([71, 192])).toContain('min-w-[180px]');
    const css = readFileSync(new URL('../../cues/CuePointsView.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.cue-browser__filters > :last-child \{\s*min-width: 148px;/);
  });

  it('shows each number with a text cursor and a hint that a double-click lets you type', () => {
    const markup = inline();
    expect(markup.match(/title="Double-click to type a value"/g)).toHaveLength(2);
    expect(markup.match(/cursor-text/g)).toHaveLength(2);
  });

  it('swaps a number for a typing box on double-click, and applies it on Enter or when you click away', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./DualRangeSlider.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onDoubleClick={() => setEditing(kind)}');
    expect(source).toContain("if (event.key === 'Enter') { event.preventDefault(); finish(true); }");
    expect(source).toContain("else if (event.key === 'Escape') { event.preventDefault(); finish(false); }");
    expect(source).toContain('onBlur={() => finish(true)}');
    expect(source).toContain('inputRef.current?.select()');
    expect(source).toContain('commitTypedBound(kind, text');
  });
});
