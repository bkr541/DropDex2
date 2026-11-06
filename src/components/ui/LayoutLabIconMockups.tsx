import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ICON_GROUPS, ICON_STATES, type IconState } from './layoutLabIconData';

type Mode = IconState | 'all';

const STATE_STYLE = `
.ic-tile{color:var(--color-muted-foreground);}
.ic-tile .ic-svg{transition:transform .25s ease;}
.ic-tile .ic-svg [data-tone="accent"]{
  color:color-mix(in srgb, var(--color-muted-foreground) 72%, var(--color-panel));
  stroke:currentColor;
}
.ic-tile .ic-svg .ic-wash{fill:url(#dd-icons-wash);}
.ic-tile .ic-svg .ic-accent{stroke:var(--color-primary);}
.ic-tile.ic-hover{color:var(--color-foreground);}
.ic-tile.ic-hover .ic-chip{background:var(--color-surface);}
.ic-tile.ic-pressed{color:var(--color-foreground);}
.ic-tile.ic-pressed .ic-chip{background:var(--color-surface);}
.ic-tile.ic-pressed .ic-svg:not(:has([data-tone])){transform:scale(.9);}
.ic-tile.ic-pressed .ic-chip:has([data-tone]){box-shadow:inset 0 0 0 1px var(--color-border-subtle);}
.ic-tile.ic-disabled{opacity:.35;}
.ic-tile.ic-active{color:var(--color-foreground);}
.ic-tile.ic-active .ic-svg [data-tone="accent"]{color:var(--color-logo-red);}
.ic-tile.ic-active .ic-svg:not(:has([data-tone])){transform:scale(1.4);}
.ic-tile.ic-active .ic-svg:not(:has([data-tone])) [fill-opacity]{fill:var(--color-logo-red);}
.ic-tile.ic-active .ic-svg:not(:has([data-tone])) :is([stroke-opacity], .ic-accent){stroke:var(--color-logo-red);}
`;

function IconSvg({ svg, size }: { svg: string; size: number }) {
  return (
    <svg
      className="ic-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function StateChip({ state, svg, compact = false }: { state: IconState; svg: string; compact?: boolean }) {
  return (
    <div className={cn('ic-tile', `ic-${state}`)}>
      <div className={cn('ic-chip flex items-center justify-center rounded-xl transition-colors', compact ? 'h-[72px] w-[72px]' : 'h-32 w-32')}>
        <IconSvg svg={svg} size={compact ? 40 : 64} />
      </div>
    </div>
  );
}

export function IconMockupsContent() {
  const [mode, setMode] = useState<Mode>('idle');
  const modes: { id: Mode; label: string }[] = [...ICON_STATES.map(({ id, label }) => ({ id, label })), { id: 'all', label: 'All states' }];
  const note = mode === 'all' ? 'Every state side by side: Idle, Hover, Active, Pressed, Disabled.' : ICON_STATES.find((s) => s.id === mode)?.note;

  const gridTemplateColumns = `repeat(auto-fill, minmax(min(100%, ${mode === 'all' ? 440 : 230}px), 1fr))`;

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12">
      <style>{STATE_STYLE}</style>
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="dd-icons-wash" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.1} />
          </linearGradient>
        </defs>
      </svg>

      <div className="sticky top-0 z-10 -mx-8 mb-6 border-b border-[var(--color-border-subtle)] bg-[var(--color-background)] px-8 pb-4 pt-7">
        <div className="mb-1 text-sm font-extrabold text-foreground">Nav Icon Concepts</div>
        <div className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          Fifteen icon concepts for each page in the left nav. Use the toggle to preview them in each state.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Icon state" className="inline-flex rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1">
            {modes.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors',
                  mode === id ? 'bg-primary text-[var(--color-background)]' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{note}</span>
        </div>
      </div>

      {ICON_GROUPS.map((group) => (
        <section key={group.page} className="mb-10" data-testid={`icon-group-${group.page}`}>
          <div className="mb-3 flex items-center gap-2.5">
            <span className="text-[13px] font-bold text-foreground">{group.page}</span>
            <span className="text-[11px] text-muted-foreground">{group.icons.length + group.customIcons.length} concepts</span>
          </div>
          <div className="space-y-3">
            {[group.icons, group.customIcons].map((icons, rowIndex) => (
              <div key={icons[0].name} className="grid gap-3" style={{ gridTemplateColumns }}>
                {icons.map((icon, index) => (
                  <div key={icon.name} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] px-3 py-4" data-testid="icon-tile">
                    {mode === 'all' ? (
                      <div className="flex items-center gap-1">
                        {ICON_STATES.map((s) => <StateChip key={s.id} state={s.id} svg={icon.svg} compact />)}
                      </div>
                    ) : (
                      <StateChip state={mode} svg={icon.svg} />
                    )}
                    <div className="text-center">
                      <div className="text-[11px] font-semibold text-foreground">{icon.name}</div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{group.page} · {rowIndex * group.icons.length + index + 1}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
