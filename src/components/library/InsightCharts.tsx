import { cn } from '../../lib/utils';
import { CAMELOT_COLORS, GENRE_OTHER_COLOR, GENRE_RANK_COLORS, camelotColor, parseCamelotKey } from './libraryInsights';

// ── Camelot wheel SVG ─────────────────────────────────────────────────────────
export function CamelotWheel({ keyStats }: { keyStats: readonly (readonly [string, number])[] }) {
  const cx = 80, cy = 80;
  const bO = 72, bI = 56, aO = 54, aI = 32;
  const INACTIVE = '#182333';
  const GAP = 0.025;

  const activeColors = new Map<string, string>();
  for (const [key] of keyStats.slice(0, 6)) {
    const p = parseCamelotKey(key);
    if (p) activeColors.set(`${p.n}${p.letter}`, CAMELOT_COLORS[p.n] ?? '#6b7280');
  }

  function arc(r1: number, r2: number, sA: number, eA: number): string {
    const s = sA + GAP, e = eA - GAP;
    const lg = e - s > Math.PI ? 1 : 0;
    const [x1, y1] = [cx + r2 * Math.cos(s), cy + r2 * Math.sin(s)];
    const [x2, y2] = [cx + r2 * Math.cos(e), cy + r2 * Math.sin(e)];
    const [x3, y3] = [cx + r1 * Math.cos(e), cy + r1 * Math.sin(e)];
    const [x4, y4] = [cx + r1 * Math.cos(s), cy + r1 * Math.sin(s)];
    return `M ${x1} ${y1} A ${r2} ${r2} 0 ${lg} 1 ${x2} ${y2} L ${x3} ${y3} A ${r1} ${r1} 0 ${lg} 0 ${x4} ${y4} Z`;
  }

  const segs = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const ca = -Math.PI / 2 + i * (Math.PI / 6);
    const sa = ca - Math.PI / 12, ea = ca + Math.PI / 12;
    const bColor = activeColors.get(`${n}B`) ?? INACTIVE;
    const aColor = activeColors.get(`${n}A`) ?? INACTIVE;
    const bTx = cx + ((bI + bO) / 2) * Math.cos(ca), bTy = cy + ((bI + bO) / 2) * Math.sin(ca);
    const aTx = cx + ((aI + aO) / 2) * Math.cos(ca), aTy = cy + ((aI + aO) / 2) * Math.sin(ca);
    return { n, sa, ea, bColor, aColor, bPath: arc(bI, bO, sa, ea), aPath: arc(aI, aO, sa, ea), bTx, bTy, aTx, aTy };
  });

  return (
    <svg width="100%" viewBox="0 0 160 160" aria-hidden="true" style={{ display: 'block' }}>
      {segs.map(({ n, bPath, bColor, bTx, bTy }) => (
        <g key={`b${n}`}>
          <path d={bPath} fill={bColor} />
          <text x={bTx} y={bTy} textAnchor="middle" dominantBaseline="middle"
            fontSize="6" fontWeight="700"
            fill={bColor === INACTIVE ? '#3a5068' : 'rgba(255,255,255,0.88)'}
            style={{ fontFamily: 'inherit', pointerEvents: 'none' }}>
            {n}B
          </text>
        </g>
      ))}
      {segs.map(({ n, aPath, aColor, aTx, aTy }) => (
        <g key={`a${n}`}>
          <path d={aPath} fill={aColor} />
          <text x={aTx} y={aTy} textAnchor="middle" dominantBaseline="middle"
            fontSize="6" fontWeight="700"
            fill={aColor === INACTIVE ? '#3a5068' : 'rgba(255,255,255,0.88)'}
            style={{ fontFamily: 'inherit', pointerEvents: 'none' }}>
            {n}A
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Top Genres card ────────────────────────────────────────────────────────────
export function InsightTopGenres({ genres, compact = false }: { genres: readonly (readonly [string, number])[]; compact?: boolean }) {
  if (genres.length === 0) return null;
  const total = genres.reduce((s, [, n]) => s + n, 0);
  const named = genres.filter(([name]) => name.toLowerCase() !== 'other');
  const preOther = genres.filter(([name]) => name.toLowerCase() === 'other').reduce((s, [, n]) => s + n, 0);
  const top5 = named.slice(0, 5);
  const overflowTotal = named.slice(5).reduce((s, [, n]) => s + n, 0) + preOther;
  const items: [string, number][] = [
    ...top5.map(([name, count]) => [name, count] as [string, number]),
    ...(overflowTotal > 0 ? [['Other', overflowTotal] as [string, number]] : []),
  ];
  const top1 = items[0]?.[0] ?? '';
  const top2 = items[1]?.[0] ?? '';

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', compact ? 'gap-2' : 'gap-3')}>
      {!compact && <div>
        <p className={cn('font-black leading-snug', compact ? 'text-base' : 'text-xl')}>
          <span style={{ color: GENRE_RANK_COLORS[0] }}>{top1}</span>
          {top2 ? <> and <span style={{ color: GENRE_RANK_COLORS[1] }}>{top2}</span></> : null}
          <br />lead the library
        </p>
      </div>}
      <div className={compact ? 'space-y-[5px]' : 'space-y-2.5'}>
        {items.map(([name, count], i) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const color = name === 'Other' ? GENRE_OTHER_COLOR : (GENRE_RANK_COLORS[i] ?? GENRE_OTHER_COLOR);
          return (
            <div key={name}>
              <div className="flex items-baseline justify-between mb-0.5 gap-2">
                <span className="text-[11px] font-semibold truncate" style={{ color }}>{name}</span>
                <span className="text-[11px] font-mono font-black tabular-nums shrink-0">{pct}%</span>
              </div>
              <div className="h-[3px] w-full rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BPM Distribution card ──────────────────────────────────────────────────────
const BPM_HIGHLIGHT = '#f43f5e';

export function InsightBpmDistribution({ bpmRangeStats, compact = false }: { bpmRangeStats: readonly (readonly [string, number])[]; compact?: boolean }) {
  if (bpmRangeStats.length === 0) return null;
  const total = bpmRangeStats.reduce((s, [, n]) => s + n, 0);
  const maxCount = Math.max(...bpmRangeStats.map(([, n]) => n));
  const dominantIdx = bpmRangeStats.findIndex(([, n]) => n === maxCount);
  const [dominantRange, dominantCount] = bpmRangeStats[dominantIdx] ?? ['—', 0];
  const dominantPct = total > 0 ? Math.round((dominantCount / total) * 100) : 0;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="shrink-0">
        <p className={cn('font-black leading-tight', compact ? 'whitespace-nowrap text-base' : 'text-2xl')} style={{ color: BPM_HIGHLIGHT }}>
          {dominantRange} BPM · {dominantPct}%
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{compact ? 'of your tracks' : 'of your tracks are in this range'}</p>
      </div>
      <div className="flex flex-col flex-1 min-h-0">
        {/* bars — fills all remaining card height */}
        <div className="flex-1 relative min-h-0">
          <div className="absolute inset-0 flex gap-1.5">
            {bpmRangeStats.map(([range, count], i) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              const barPct = maxCount > 0 ? Math.max(2, Math.round((count / maxCount) * 88)) : 2;
              const isHl = i === dominantIdx;
              return (
                <div key={range} className="flex-1 h-full flex flex-col items-center justify-end gap-0.5">
                  {(!compact || isHl) && (
                    <span className="text-[9px] font-mono font-black tabular-nums" style={{ color: isHl ? BPM_HIGHLIGHT : 'var(--color-foreground)' }}>
                      {pct}%
                    </span>
                  )}
                  <div className="w-full rounded-[3px]"
                    style={{ height: `${barPct}%`, backgroundColor: isHl ? BPM_HIGHLIGHT : '#1f2d3d' }} />
                </div>
              );
            })}
          </div>
        </div>
        {/* x-axis */}
        <div className="flex gap-1.5 mt-1.5 border-t border-white/[0.05] pt-1.5 shrink-0">
          {bpmRangeStats.map(([range]) => (
            <span key={range} className="flex-1 text-center text-[8px] text-muted-foreground leading-tight truncate">{compact ? range.split('–')[0] : range}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Key Profile card ───────────────────────────────────────────────────────────
export function InsightKeyProfile({ keyStats, compact = false }: { keyStats: readonly (readonly [string, number])[]; compact?: boolean }) {
  if (keyStats.length === 0) return null;
  const total = keyStats.reduce((s, [, n]) => s + n, 0);

  function KeyRow({ keyName, count, rank }: { keyName: string; count: number; rank: number }) {
    const color = camelotColor(keyName);
    const pct = total > 0 ? (count / total) * 100 : 0;
    return (
      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        <span className="text-[9px] text-muted-foreground font-mono w-3 shrink-0">{rank}</span>
        <span className="text-[11px] font-black shrink-0 w-7" style={{ color }}>{keyName}</span>
        <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full min-w-0 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <span className="text-[10px] font-mono tabular-nums shrink-0 text-right" style={{ minWidth: compact ? undefined : '4.5rem' }}>
          <span className={cn(compact ? 'text-[12px]' : 'text-[14px]', 'text-foreground font-black')}>{count.toLocaleString()}</span>
          {!compact && <span className="text-muted-foreground font-bold">/{total.toLocaleString()}</span>}
        </span>
      </div>
    );
  }

  if (compact) {
    // Narrow hero column: the wheel on top, the five most common keys under it.
    return (
      <div className="flex flex-col items-center gap-1 flex-1 min-h-0">
        <div className="w-[64px] shrink-0">
          <CamelotWheel keyStats={keyStats} />
        </div>
        <div className="w-full min-w-0 flex flex-col gap-[1px]">
          {keyStats.slice(0, 5).map(([k, count], i) => (
            <KeyRow key={k} keyName={k} count={count} rank={i + 1} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      <div className="w-[180px] shrink-0 flex items-center">
        <CamelotWheel keyStats={keyStats} />
      </div>
      <div
        className="flex-1 min-w-0 flex flex-col gap-[6px] overflow-y-auto self-center"
        style={{ maxHeight: '132px', scrollbarWidth: 'none' }}
      >
        {keyStats.map(([k, count], i) => (
          <KeyRow key={k} keyName={k} count={count} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

