import { useState } from 'react';
import { DualRangeSlider, FilterDropdown, type DualRangeVariant } from './controls';

// UI Components: candidate replacements for the Cue Points BPM range slider.
// All of them are the same component with the same behavior (drag either thumb,
// arrow keys 1 / PageUp-Down 5 / Home-End, thumbs can touch but never cross,
// reset when narrowed); only the look differs.

const BOUNDS: [number, number] = [71, 192];

const OPTIONS: Array<{ variant: DualRangeVariant; title: string; concept: string }> = [
  { variant: 'inline', title: 'Inline Values (in use)', concept: 'One line tall like a dropdown: plain values in the dropdown text style at each end, hairline rail, small dot handles' },
  { variant: 'rings', title: 'Current', concept: 'Baseline: round thumbs with the value inside, hairline rail' },
  { variant: 'pills', title: 'Value Pills', concept: 'Solid rounded thumbs holding the value, thicker filled rail' },
  { variant: 'flags', title: 'Cue Flags', concept: 'Small dot thumbs with a value flag above, like a cue pin' },
  { variant: 'ticks', title: 'Beat-Grid Ticks', concept: 'Rail made of grid ticks that light up inside the range, live readout' },
  { variant: 'histogram', title: 'BPM Spread', concept: 'The rail is your library\'s BPM distribution; bars inside the range light up' },
  { variant: 'capsule', title: 'Glow Capsule', concept: 'Thick capsule rail, cyan-to-blue fill, soft glowing handles, live readout' },
];

function SliderCard({ n, variant, title, concept }: { n: number; variant: DualRangeVariant; title: string; concept: string }) {
  const [range, setRange] = useState<[number, number]>(BOUNDS);
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-card)] p-4">
      <div className="mb-1 flex items-center gap-2.5">
        <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/15 text-[10px] font-extrabold text-primary">{n}</div>
        <span className="text-[13px] font-bold text-foreground">{title}</span>
      </div>
      <p className="mb-4 ml-[32px] text-[11px] text-muted-foreground">{concept}</p>
      <div className="flex items-stretch gap-6 rounded-lg border border-[var(--color-border-faint)] bg-[var(--color-background)] px-5 py-4">
        <FilterDropdown label="Genre" value="all" onChange={() => undefined} className="w-[120px] shrink-0" options={[{ value: 'all', label: 'All' }]} />
        <DualRangeSlider variant={variant} bounds={BOUNDS} value={range} onChange={setRange} onReset={() => setRange(BOUNDS)} className="flex-1" />
      </div>
    </div>
  );
}

export function UiComponentsContent() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12 pt-7">
      <div className="mb-7">
        <div className="mb-1 text-sm font-extrabold text-foreground">BPM Range Slider</div>
        <div className="max-w-[860px] text-[11px] leading-relaxed text-muted-foreground">
          Seven looks for the Cue Points BPM filter. Number 0 is the one now used in Cue Points; the others are alternatives. All are colored like the filter dropdown row: muted capital labels, plain foreground values, a thin underline that brightens on hover and turns blue only on focus, neutral rails and fills, dark control-surface handles, and a red reset. A real Genre dropdown sits beside each one so you can compare. Each is live: drag either handle, or focus one and use the arrow keys (PageUp / PageDown move by 5, Home / End jump to the limit). The handles can touch but never cross, and a reset arrow appears next to the label once the range is narrowed. Each card uses the BPM bounds from your screenshot (71 to 192). The histogram's bars are sample data.
        </div>
      </div>
      <div className="grid max-w-[1000px] grid-cols-2 gap-4">
        {OPTIONS.map((o, i) => <SliderCard key={o.variant} n={i} {...o} />)}
      </div>
    </div>
  );
}
