import { Stage1Showcase } from './Stage1Showcase';
import { Stage2Showcase } from './Stage2Showcase';
import { Stage3Showcase } from './Stage3Showcase';
import { Stage4Showcase } from './Stage4Showcase';
import './reusable-components-layout.css';

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/50 shrink-0">{children}</h2>
      <div className="flex-1 h-px bg-[var(--color-border-faint)]" />
    </div>
  );
}

export function ReusableComponentsView() {
  return (
    <div className="space-y-8 pt-2 pb-12 md:max-w-[1480px] md:mx-auto">
      <section className="space-y-3">
        <SectionHeader>Inputs, Buttons &amp; Form Controls</SectionHeader>
        <Stage1Showcase />
      </section>

      <section className="space-y-3">
        <SectionHeader>Status, Feedback, Progress, Uploads &amp; Modals</SectionHeader>
        <Stage2Showcase />
      </section>

      <section className="space-y-3">
        <SectionHeader>Playback, Waveforms, Track Rows &amp; Tables</SectionHeader>
        <Stage3Showcase />
      </section>

      <section className="space-y-3">
        <SectionHeader>Cards, Artwork, Avatars, Typography &amp; Navigation</SectionHeader>
        <Stage4Showcase />
      </section>
    </div>
  );
}
