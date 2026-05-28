import type { DiscoverySetlistResult } from '../../types';

interface StyleEntry {
  style: string;
  count: number;
}

function computeStyles(setlists: DiscoverySetlistResult[]): StyleEntry[] {
  const counts = new Map<string, number>();
  for (const s of setlists) {
    for (const style of s.music_styles ?? []) {
      const key = style.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

interface ArtistStylesSidebarProps {
  setlists: DiscoverySetlistResult[];
}

export function ArtistStylesSidebar({ setlists }: ArtistStylesSidebarProps) {
  const styles = computeStyles(setlists);

  return (
    <div className="glass rounded-2xl p-4 border border-[var(--color-border-subtle)]">
      <p className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground mb-4">Top Styles</p>
      {styles.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No style data available</p>
      ) : (
        <div className="flex flex-col gap-3">
          {styles.map(({ style, count }) => {
            const maxCount = styles[0].count;
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div key={style}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-foreground truncate pr-2">{style}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{count}</span>
                </div>
                <div className="h-1 rounded-full bg-[var(--color-avatar-bg)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
