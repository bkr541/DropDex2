import { RekordboxExperimentalConcepts } from './LayoutLabRekordboxExperimentalMockups';

export function RekordboxMockupsContent() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-14 pt-7">
      <div className="mb-9 flex items-start gap-4 border-b border-[var(--color-border-faint)] pb-5">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-primary/25 bg-primary/10">
          <span className="font-mono text-[10px] font-black text-primary">TL</span>
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold tracking-[-0.02em] text-foreground">Rekordbox Timeline Concepts</div>
          <div className="mt-1 max-w-3xl text-[10px] leading-[1.65] text-muted-foreground">
            Five waveform-first directions for professional track preparation, cue editing, phrase analysis, transition planning, and performance readiness.
          </div>
        </div>
      </div>

      <RekordboxExperimentalConcepts />
    </div>
  );
}
