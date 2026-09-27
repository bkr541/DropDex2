import { useState, useMemo } from 'react';
import { CircleDash, ChevronDown, ChevronRight, Renew } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { fetchRouletteCandidateAnalysis, fetchReadyRouletteStemAssets } from '../../lib/queries/rouletteCandidates';
import type { StemAssetRecord } from '../../features/roulette/stemAssets';
import {
  hasUsableRouletteBeatGrid,
  rankRoulettePairsBoundedWithMetadata,
  rouletteDirectTempoDifference,
  ROULETTE_DIRECT_BPM_TOLERANCE,
  type RouletteCandidateAnalysis,
  type RoulettePairScore,
  type RouletteBoundedPairResult,
} from '../../features/roulette/rouletteMatching';
import {
  parseCamelotKey,
  classifyCamelotRelationship,
  camelotKeyFromTonicMode,
} from '../../lib/music/camelot';
import type { RekordboxTrack } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

type SelfBlockingIssue =
  | 'source-unavailable'
  | 'missing-bpm'
  | 'missing-key'
  | 'variable-tempo'
  | 'missing-beat-grid';

const SELF_ISSUE_LABELS: Record<SelfBlockingIssue, string> = {
  'source-unavailable': 'No file path',
  'missing-bpm': 'BPM not set',
  'missing-key': 'No key data',
  'variable-tempo': 'Variable tempo',
  'missing-beat-grid': 'No beat grid',
};

type TrackFilter = 'all' | 'issues' | 'clean';

interface MergedTrack {
  vocalCandidate: RouletteCandidateAnalysis;
  instrumentalCandidate: RouletteCandidateAnalysis | undefined;
  camelotCode: string | null;
  selfIssues: SelfBlockingIssue[];
  downbeatCount: number;
}

interface DiagnosticsData {
  merged: MergedTrack[];
  pairs: RoulettePairScore[];
  isTruncated: boolean;
  totalTracks: number;
  cleanCount: number;
  vocalStemReadyCount: number;
  instrumentalStemReadyCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveCamelotCode(track: RekordboxTrack): string | null {
  return parseCamelotKey(track.camelot_key)?.code
    ?? camelotKeyFromTonicMode(track.key_tonic, track.key_mode)
    ?? null;
}

function pairKeyRelationship(
  vocalTrack: RekordboxTrack,
  instrumentalTrack: RekordboxTrack,
): 'exact' | 'compatible' | 'unknown' {
  const vCode = resolveCamelotCode(vocalTrack);
  const iCode = resolveCamelotCode(instrumentalTrack);
  if (!vCode || !iCode) return 'unknown';
  const rel = classifyCamelotRelationship(vCode, iCode);
  if (rel === 'exact') return 'exact';
  if (rel === 'relative' || rel === 'adjacent_up' || rel === 'adjacent_down') return 'compatible';
  return 'unknown';
}

function getSelfIssues(candidate: RouletteCandidateAnalysis): SelfBlockingIssue[] {
  const issues: SelfBlockingIssue[] = [];
  if (!(candidate.track.file_path_normalized ?? candidate.track.file_path)?.trim()) {
    issues.push('source-unavailable');
  }
  if (
    typeof candidate.track.bpm !== 'number'
    || !Number.isFinite(candidate.track.bpm)
    || candidate.track.bpm <= 0
  ) {
    issues.push('missing-bpm');
  }
  if (!resolveCamelotCode(candidate.track)) {
    issues.push('missing-key');
  }
  if (candidate.beatGrid?.is_variable_tempo === true) {
    issues.push('variable-tempo');
  }
  if (!hasUsableRouletteBeatGrid(candidate.beatGrid)) {
    issues.push('missing-beat-grid');
  }
  return issues;
}

function getDownbeatCount(candidate: RouletteCandidateAnalysis): number {
  if (!candidate.beatGrid) return 0;
  return candidate.beatGrid.downbeat_count
    ?? candidate.beatGrid.beats.filter((b) => b.isDownbeat).length;
}

function normalizedText(value: string | null | undefined): string | null {
  const n = value?.trim().toLowerCase();
  return n || null;
}

interface ScoreSide {
  keyPts: number;
  keyLabel: string;
  bpmPts: number;
  phrasePts: number;
  beatGridPts: number;
  stemPts: number;
  genrePts: number;
  labelPts: number;
  total: number;
}

function computePairScoreBreakdown(pair: RoulettePairScore): { vocal: ScoreSide; instrumental: ScoreSide } {
  const { vocal, instrumental } = pair;
  const bpmDiff = rouletteDirectTempoDifference(vocal.track.bpm, instrumental.track.bpm) ?? Infinity;
  const proximity = Number.isFinite(bpmDiff)
    ? Math.max(0, 1 - bpmDiff / Math.max(ROULETTE_DIRECT_BPM_TOLERANCE, 1e-9))
    : 0;
  const bpmPts = proximity * 60;

  function keyPoints(refTrack: RekordboxTrack, candTrack: RekordboxTrack): { pts: number; label: string } {
    const refCode = resolveCamelotCode(refTrack);
    const candCode = resolveCamelotCode(candTrack);
    if (!refCode || !candCode) return { pts: 0, label: 'unknown' };
    const rel = classifyCamelotRelationship(refCode, candCode);
    if (rel === 'exact') return { pts: 140, label: 'Exact match' };
    if (rel === 'relative') return { pts: 110, label: 'Relative key' };
    if (rel === 'adjacent_up') return { pts: 110, label: 'Step up (+1)' };
    if (rel === 'adjacent_down') return { pts: 110, label: 'Step down (-1)' };
    return { pts: 0, label: rel };
  }

  function genrePts(t1: RekordboxTrack, t2: RekordboxTrack): number {
    const g1 = normalizedText(t1.genre);
    const g2 = normalizedText(t2.genre);
    return (g1 && g2 && g1 === g2) ? 6 : 0;
  }
  function labelPts(t1: RekordboxTrack, t2: RekordboxTrack): number {
    const l1 = normalizedText(t1.label);
    const l2 = normalizedText(t2.label);
    return (l1 && l2 && l1 === l2) ? 3 : 0;
  }

  const vocalKey = keyPoints(instrumental.track, vocal.track);
  const instrKey = keyPoints(vocal.track, instrumental.track);

  const vSide: ScoreSide = {
    keyPts: vocalKey.pts,
    keyLabel: vocalKey.label,
    bpmPts,
    phrasePts: vocal.phraseCount > 0 ? 10 : 0,
    beatGridPts: getDownbeatCount(vocal) > 0 ? 6 : 0,
    stemPts: vocal.stemAsset?.status === 'ready' ? 6 : 0,
    genrePts: genrePts(vocal.track, instrumental.track),
    labelPts: labelPts(vocal.track, instrumental.track),
    total: 0,
  };
  vSide.total = vSide.keyPts + vSide.bpmPts + vSide.phrasePts + vSide.beatGridPts + vSide.stemPts + vSide.genrePts + vSide.labelPts;

  const iSide: ScoreSide = {
    keyPts: instrKey.pts,
    keyLabel: instrKey.label,
    bpmPts,
    phrasePts: instrumental.phraseCount > 0 ? 10 : 0,
    beatGridPts: getDownbeatCount(instrumental) > 0 ? 6 : 0,
    stemPts: instrumental.stemAsset?.status === 'ready' ? 6 : 0,
    genrePts: genrePts(instrumental.track, vocal.track),
    labelPts: labelPts(instrumental.track, vocal.track),
    total: 0,
  };
  iSide.total = iSide.keyPts + iSide.bpmPts + iSide.phrasePts + iSide.beatGridPts + iSide.stemPts + iSide.genrePts + iSide.labelPts;

  return { vocal: vSide, instrumental: iSide };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="glass rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-black tabular-nums leading-none', accent ?? 'text-foreground')}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground font-mono">{sub}</p>}
    </div>
  );
}

function StemBadge({ status }: { status: string | undefined | null }) {
  if (!status || status === null) {
    return <span className="text-[9px] font-mono text-muted-foreground/50">—</span>;
  }
  const colors: Record<string, string> = {
    ready: 'text-emerald-400',
    processing: 'text-blue-400',
    pending: 'text-amber-400',
    failed: 'text-red-400',
  };
  return (
    <span className={cn('text-[9px] font-bold uppercase tracking-wide', colors[status] ?? 'text-muted-foreground')}>
      {status}
    </span>
  );
}

function BeatGridBadge({ candidate }: { candidate: RouletteCandidateAnalysis }) {
  if (!candidate.beatGrid) {
    return <span className="text-[9px] font-mono text-red-400">none</span>;
  }
  if (candidate.beatGrid.is_variable_tempo === true) {
    return <span className="text-[9px] font-mono text-amber-400">variable</span>;
  }
  if (!hasUsableRouletteBeatGrid(candidate.beatGrid)) {
    return <span className="text-[9px] font-mono text-red-400">invalid</span>;
  }
  return <span className="text-[9px] font-mono text-emerald-400">stable</span>;
}

function TrackTableRow({ merged }: { merged: MergedTrack }) {
  const [expanded, setExpanded] = useState(false);
  const { vocalCandidate: cand, instrumentalCandidate: instrCand } = merged;
  const bpm = cand.track.bpm != null ? cand.track.bpm.toFixed(1) : '—';
  const hasIssues = merged.selfIssues.length > 0;
  const instrStemStatus = instrCand?.stemAsset?.status ?? null;

  return (
    <div className="border-b border-[var(--color-border-faint)] last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[16px_1fr_52px_52px_60px_52px_56px_56px_auto] gap-x-2 items-center px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>

        {/* Title / Artist */}
        <div className="min-w-0 text-left">
          <p className="text-xs font-semibold truncate leading-tight">{cand.track.title ?? '—'}</p>
          <p className="text-[10px] text-muted-foreground truncate leading-tight">{cand.track.artist ?? '—'}</p>
        </div>

        {/* BPM */}
        <span className="text-[10px] font-mono text-right">{bpm}</span>

        {/* Key */}
        <span className="text-[10px] font-mono text-center text-secondary">{merged.camelotCode ?? '—'}</span>

        {/* Beat Grid */}
        <span className="text-center"><BeatGridBadge candidate={cand} /></span>

        {/* Phrases */}
        <span className="text-[10px] font-mono text-center">{cand.phraseCount > 0 ? cand.phraseCount : '—'}</span>

        {/* Vocal stem */}
        <span className="text-center"><StemBadge status={cand.stemAsset?.status} /></span>

        {/* Instr stem */}
        <span className="text-center"><StemBadge status={instrStemStatus} /></span>

        {/* Status */}
        <span className="text-right min-w-0">
          {hasIssues ? (
            <span className="text-[9px] font-bold text-red-400 uppercase tracking-wide">
              {merged.selfIssues.length} issue{merged.selfIssues.length > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Clean</span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="px-7 pb-3 space-y-2">
          <div className="glass rounded-xl overflow-hidden divide-y divide-[var(--color-border-faint)]">

            {/* Identity */}
            <ExpandedRow label="Track ID" value={cand.track.id} />
            <ExpandedRow label="File Path" value={(cand.track.file_path_normalized ?? cand.track.file_path) || '(none)'} />
            <ExpandedRow label="Genre" value={cand.track.genre ?? '—'} />
            <ExpandedRow label="Label" value={cand.track.label ?? '—'} />
            <ExpandedRow label="Format" value={[cand.track.file_format, cand.track.bitrate_kbps ? `${cand.track.bitrate_kbps} kbps` : null, cand.track.bit_depth ? `${cand.track.bit_depth}-bit` : null, cand.track.sample_rate_hz ? `${(cand.track.sample_rate_hz / 1000).toFixed(1)} kHz` : null].filter(Boolean).join(' · ') || '—'} />

            {/* Tempo / Key */}
            <ExpandedRow label="BPM" value={cand.track.bpm != null ? cand.track.bpm.toFixed(3) : '—'} />
            <ExpandedRow label="Camelot Key" value={merged.camelotCode ?? '—'} sub={cand.track.camelot_key ? `stored: ${cand.track.camelot_key}` : cand.track.key_tonic ? `derived: ${cand.track.key_tonic} ${cand.track.key_mode}` : undefined} />
            <ExpandedRow label="BPM Tolerance" value={`± ${ROULETTE_DIRECT_BPM_TOLERANCE} BPM (range: ${cand.track.bpm != null ? `${(cand.track.bpm - ROULETTE_DIRECT_BPM_TOLERANCE).toFixed(1)} – ${(cand.track.bpm + ROULETTE_DIRECT_BPM_TOLERANCE).toFixed(1)}` : '—'})`} />

            {/* Beat Grid */}
            <ExpandedRow label="Beat Grid" value={!cand.beatGrid ? 'Missing' : cand.beatGrid.is_variable_tempo ? 'Variable tempo' : hasUsableRouletteBeatGrid(cand.beatGrid) ? 'Stable & usable' : 'Present but not usable'} />
            <ExpandedRow label="Beat Count" value={cand.beatGrid?.beat_count?.toLocaleString() ?? '—'} />
            <ExpandedRow label="Downbeats" value={merged.downbeatCount > 0 ? String(merged.downbeatCount) : '0 (no downbeat bonus)'} />
            <ExpandedRow label="Phrases" value={cand.phraseCount > 0 ? String(cand.phraseCount) : '0 (no phrase bonus)'} />

            {/* Stems */}
            <ExpandedRow label="Vocal Stem" value={cand.stemAsset ? `${cand.stemAsset.status}${cand.stemAsset.failure_code ? ` · ${cand.stemAsset.failure_code}` : ''}` : 'No stem record'} />
            <ExpandedRow label="Instr Stem" value={instrCand?.stemAsset ? `${instrCand.stemAsset.status}${instrCand.stemAsset.failure_code ? ` · ${instrCand.stemAsset.failure_code}` : ''}` : 'No stem record'} />

            {/* Score bonuses */}
            <ExpandedRow label="Phrase Bonus" value={cand.phraseCount > 0 ? '+10 pts' : '+0 pts'} accent={cand.phraseCount > 0 ? 'text-emerald-400' : undefined} />
            <ExpandedRow label="Downbeat Bonus" value={merged.downbeatCount > 0 ? '+6 pts' : '+0 pts'} accent={merged.downbeatCount > 0 ? 'text-emerald-400' : undefined} />
            <ExpandedRow label="Vocal Stem Bonus" value={cand.stemAsset?.status === 'ready' ? '+6 pts' : '+0 pts'} accent={cand.stemAsset?.status === 'ready' ? 'text-emerald-400' : undefined} />
            <ExpandedRow label="Instr Stem Bonus" value={instrCand?.stemAsset?.status === 'ready' ? '+6 pts' : '+0 pts'} accent={instrCand?.stemAsset?.status === 'ready' ? 'text-emerald-400' : undefined} />
            <ExpandedRow label="Key Bonus" value="Exact match: +140 pts · Compatible (relative/adjacent): +110 pts" />
            <ExpandedRow label="BPM Prox. Bonus" value="Up to +60 pts · formula: (1 − Δbpm/5) × 60" />
            <ExpandedRow label="Genre Bonus" value="+6 pts if genre matches reference" />
            <ExpandedRow label="Label Bonus" value="+3 pts if label matches reference" />

            {/* Self-blocking issues */}
            {merged.selfIssues.length > 0 && (
              <div className="px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-red-400 mb-1">Blocking Issues</p>
                <ul className="space-y-0.5">
                  {merged.selfIssues.map((issue) => (
                    <li key={issue} className="text-[10px] font-mono text-red-300">• {SELF_ISSUE_LABELS[issue]}</li>
                  ))}
                </ul>
                <p className="text-[9px] text-muted-foreground mt-1.5 leading-relaxed">
                  These are self-contained problems. The track cannot form any Roulette pair regardless of other tracks in the library.
                </p>
              </div>
            )}

            {merged.selfIssues.length === 0 && (
              <div className="px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Eligible</p>
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  No self-blocking issues. This track can pair with any other eligible track whose key (exact/adjacent/relative) and BPM (±5) are compatible.
                  Key and BPM compatibility checks are reference-dependent and shown in the Compatible Pairs section below.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExpandedRow({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="px-3 py-1.5 flex items-baseline gap-3 min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 w-36">{label}</span>
      <div className="min-w-0">
        <span className={cn('text-xs font-mono break-all', accent ?? 'text-foreground')}>{value}</span>
        {sub && <span className="ml-2 text-[9px] font-mono text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function PairTableRow({ pair, rank }: { pair: RoulettePairScore; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const bpmDiff = rouletteDirectTempoDifference(pair.vocal.track.bpm, pair.instrumental.track.bpm);
  const keyRel = pairKeyRelationship(pair.vocal.track, pair.instrumental.track);
  const breakdown = useMemo(() => computePairScoreBreakdown(pair), [pair]);

  const keyColors: Record<string, string> = {
    exact: 'text-emerald-400',
    compatible: 'text-blue-400',
    unknown: 'text-muted-foreground',
  };

  return (
    <div className="border-b border-[var(--color-border-faint)] last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-[20px_1fr_1fr_52px_64px_52px_16px] gap-x-2 items-center px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="text-[9px] font-mono text-muted-foreground">{rank}</span>

        {/* Vocal */}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold truncate">{pair.vocal.track.title ?? '—'}</p>
          <p className="text-[9px] font-mono text-muted-foreground truncate">
            {resolveCamelotCode(pair.vocal.track) ?? '—'} · {pair.vocal.track.bpm?.toFixed(1) ?? '—'}
          </p>
        </div>

        {/* Instrumental */}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold truncate">{pair.instrumental.track.title ?? '—'}</p>
          <p className="text-[9px] font-mono text-muted-foreground truncate">
            {resolveCamelotCode(pair.instrumental.track) ?? '—'} · {pair.instrumental.track.bpm?.toFixed(1) ?? '—'}
          </p>
        </div>

        {/* BPM diff */}
        <span className="text-[10px] font-mono text-right">{bpmDiff != null ? `Δ${bpmDiff.toFixed(2)}` : '—'}</span>

        {/* Key relationship */}
        <span className={cn('text-[9px] font-bold uppercase tracking-wide text-center', keyColors[keyRel])}>
          {keyRel}
        </span>

        {/* Combined score */}
        <span className="text-[10px] font-mono font-bold text-right text-primary">{pair.score.toFixed(1)}</span>

        <span className="text-muted-foreground">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {expanded && (
        <div className="px-7 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {/* Vocal breakdown */}
            <ScoreBreakdownCard label="Vocal score" side={breakdown.vocal} track={pair.vocal.track} />
            {/* Instrumental breakdown */}
            <ScoreBreakdownCard label="Instrumental score" side={breakdown.instrumental} track={pair.instrumental.track} />
          </div>
          <div className="glass rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Combined Score</span>
            <span className="text-sm font-black text-primary">{pair.score.toFixed(1)} pts</span>
          </div>
          <p className="text-[9px] text-muted-foreground px-1 leading-relaxed">
            Weighted random selection favours higher scores but lower-ranked pairs retain a chance.
            Position in this list does not guarantee selection — it reflects descending probability weight.
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreBreakdownCard({ label, side, track }: { label: string; side: ScoreSide; track: RekordboxTrack }) {
  const rows: Array<{ name: string; pts: number; max: number }> = [
    { name: 'Key match', pts: side.keyPts, max: 140 },
    { name: 'BPM proximity', pts: side.bpmPts, max: 60 },
    { name: 'Phrase bonus', pts: side.phrasePts, max: 10 },
    { name: 'Beat grid bonus', pts: side.beatGridPts, max: 6 },
    { name: 'Stem ready', pts: side.stemPts, max: 6 },
    { name: 'Genre match', pts: side.genrePts, max: 6 },
    { name: 'Label match', pts: side.labelPts, max: 3 },
  ];

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-3 py-1.5 border-b border-[var(--color-border-faint)]">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-xs font-semibold truncate">{track.title ?? '—'}</p>
        <p className="text-[9px] font-mono text-muted-foreground">{side.keyLabel} · {track.bpm?.toFixed(1) ?? '—'} BPM</p>
      </div>
      <div className="divide-y divide-[var(--color-border-faint)]">
        {rows.map(({ name, pts, max }) => (
          <div key={name} className="px-3 py-1 flex items-center justify-between gap-2">
            <span className="text-[9px] text-muted-foreground">{name}</span>
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-16 h-1 bg-[var(--color-surface)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? (pts / max) * 100 : 0}%` }}
                />
              </div>
              <span className={cn('text-[9px] font-mono w-8 text-right', pts > 0 ? 'text-primary font-bold' : 'text-muted-foreground/50')}>
                {pts > 0 ? `+${pts.toFixed(0)}` : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-[var(--color-border-faint)] flex justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Total</span>
        <span className="text-xs font-black text-primary">{side.total.toFixed(1)} pts</span>
      </div>
    </div>
  );
}

// ── Column Header ─────────────────────────────────────────────────────────────

function TrackTableHeader() {
  return (
    <div className="grid grid-cols-[16px_1fr_52px_52px_60px_52px_56px_56px_auto] gap-x-2 px-3 py-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <span />
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Track</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-right">BPM</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-center">Key</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-center">Beat Grid</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-center">Phrases</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-center">Vocal Stem</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-center">Instr Stem</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-right">Status</span>
    </div>
  );
}

function PairTableHeader() {
  return (
    <div className="grid grid-cols-[20px_1fr_1fr_52px_64px_52px_16px] gap-x-2 px-3 py-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">#</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Vocal Track</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Instrumental Track</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-right">BPM Δ</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-center">Key</span>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground text-right">Score</span>
      <span />
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'done' | 'error';

export function RouletteDiagnosticsPanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>('all');
  const [trackSearch, setTrackSearch] = useState('');
  const [showAllPairs, setShowAllPairs] = useState(false);

  const runDiagnostics = async () => {
    setStatus('loading');
    setError(null);
    try {
      // Fetch vocal candidates (tracks + beat grids + phrases + vocal stems).
      // Then fetch only instrumental stems separately to avoid re-querying the
      // same track/beat-grid/phrase data a second time.
      const [vocals, instrStemAssets] = await Promise.all([
        fetchRouletteCandidateAnalysis('vocal'),
        fetchReadyRouletteStemAssets('instrumental').catch((): StemAssetRecord[] => []),
      ]);

      const instrStemMap = new Map(instrStemAssets.map((a) => [a.track_id, a]));
      const instrumentals: RouletteCandidateAnalysis[] = vocals.map((v) => ({
        ...v,
        stemAsset: instrStemMap.get(v.track.id) ?? null,
      }));

      const instrMap = new Map(instrumentals.map((c) => [c.track.id, c]));
      const merged: MergedTrack[] = vocals.map((v) => {
        const instrCand = instrMap.get(v.track.id);
        const code = resolveCamelotCode(v.track);
        const issues = getSelfIssues(v);
        return {
          vocalCandidate: v,
          instrumentalCandidate: instrCand,
          camelotCode: code,
          selfIssues: issues,
          downbeatCount: getDownbeatCount(v),
        };
      });

      const pairResult: RouletteBoundedPairResult = rankRoulettePairsBoundedWithMetadata(vocals, instrumentals, { maxPairs: 512 });

      const cleanCount = merged.filter((m) => m.selfIssues.length === 0).length;
      const vocalStemReadyCount = merged.filter((m) => m.vocalCandidate.stemAsset?.status === 'ready').length;
      const instrumentalStemReadyCount = merged.filter((m) => m.instrumentalCandidate?.stemAsset?.status === 'ready').length;

      setData({
        merged,
        pairs: pairResult.pairs,
        isTruncated: pairResult.isTruncated,
        totalTracks: vocals.length,
        cleanCount,
        vocalStemReadyCount,
        instrumentalStemReadyCount,
      });
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const filteredTracks = useMemo(() => {
    if (!data) return [];
    const q = trackSearch.trim().toLowerCase();
    return data.merged.filter((m) => {
      if (trackFilter === 'issues' && m.selfIssues.length === 0) return false;
      if (trackFilter === 'clean' && m.selfIssues.length > 0) return false;
      if (q) {
        const hay = `${m.vocalCandidate.track.title ?? ''} ${m.vocalCandidate.track.artist ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, trackFilter, trackSearch]);

  const visiblePairs = showAllPairs ? data?.pairs ?? [] : (data?.pairs ?? []).slice(0, 30);

  const filterTabClass = (f: TrackFilter) => cn(
    'px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors',
    trackFilter === f
      ? 'bg-primary/15 text-primary'
      : 'text-muted-foreground hover:text-foreground',
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-secondary/60 inline-block" />
          Roulette Diagnostics
        </h2>
        <button
          type="button"
          onClick={() => { void runDiagnostics(); }}
          disabled={status === 'loading'}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all',
            status === 'loading'
              ? 'opacity-50 cursor-not-allowed border-[var(--color-border-subtle)] text-muted-foreground'
              : 'border-secondary/40 text-secondary hover:bg-secondary/10',
          )}
        >
          {status === 'loading'
            ? <><CircleDash size={12} className="animate-spin" /> Running…</>
            : <><Renew size={12} /> {status === 'done' ? 'Re-run' : 'Run Diagnostics'}</>}
        </button>
      </div>

      {status === 'idle' && (
        <div className="glass rounded-2xl px-4 py-8 text-center">
          <p className="text-xs text-muted-foreground">Press Run Diagnostics to analyse your current library against the Roulette matching engine.</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            This reads every track in your active import and ranks all compatible pairs — the same logic the live Roulette UI uses.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="glass rounded-2xl px-4 py-6 border border-red-500/20">
          <p className="text-xs text-red-400 font-bold">Failed to load diagnostics</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">{error}</p>
        </div>
      )}

      {status === 'done' && data && (
        <>
          {/* ── Summary ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <StatCard label="Total Tracks" value={data.totalTracks.toLocaleString()} />
            <StatCard
              label="Self-Clean"
              value={data.cleanCount.toLocaleString()}
              sub={`${data.totalTracks > 0 ? Math.round((data.cleanCount / data.totalTracks) * 100) : 0}% of library`}
              accent={data.cleanCount === 0 ? 'text-red-400' : 'text-emerald-400'}
            />
            <StatCard
              label="Vocal Stems Ready"
              value={data.vocalStemReadyCount.toLocaleString()}
              sub="optional (+6 pts each)"
              accent={data.vocalStemReadyCount > 0 ? 'text-emerald-400' : 'text-muted-foreground'}
            />
            <StatCard
              label="Instr Stems Ready"
              value={data.instrumentalStemReadyCount.toLocaleString()}
              sub="optional (+6 pts each)"
              accent={data.instrumentalStemReadyCount > 0 ? 'text-emerald-400' : 'text-muted-foreground'}
            />
            <StatCard
              label="Compatible Pairs"
              value={data.pairs.length.toLocaleString()}
              sub={data.isTruncated ? 'pool capped at 512' : 'exact count'}
              accent={data.pairs.length === 0 ? 'text-red-400' : 'text-primary'}
            />
          </div>

          {data.pairs.length === 0 && (
            <div className="glass rounded-2xl px-4 py-4 border border-amber-500/20">
              <p className="text-xs font-bold text-amber-300">No compatible pairs found</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                Roulette requires at least one pair of tracks with a matching Camelot key (exact, adjacent, or relative)
                and BPM within ±{ROULETTE_DIRECT_BPM_TOLERANCE} of each other, both with usable beat grids.
                Check the track table below for blocking issues.
              </p>
            </div>
          )}

          {/* ── Track Table ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                All Tracks ({filteredTracks.length}{filteredTracks.length !== data.totalTracks ? ` / ${data.totalTracks}` : ''})
              </h3>
              <div className="flex gap-1 ml-auto">
                {(['all', 'issues', 'clean'] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setTrackFilter(f)} className={filterTabClass(f)}>
                    {f === 'all' ? 'All' : f === 'issues' ? `Issues (${data.merged.filter((m) => m.selfIssues.length > 0).length})` : `Clean (${data.cleanCount})`}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={trackSearch}
                onChange={(e) => setTrackSearch(e.target.value)}
                placeholder="Filter by title or artist…"
                className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-lg py-1 px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50 w-48"
              />
            </div>

            <div className="glass rounded-2xl overflow-hidden">
              <TrackTableHeader />
              <div className="max-h-[420px] overflow-y-auto">
                {filteredTracks.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">No tracks match the current filter.</div>
                ) : (
                  filteredTracks.map((m) => <TrackTableRow key={m.vocalCandidate.track.id} merged={m} />)
                )}
              </div>
            </div>
          </div>

          {/* ── Compatible Pairs Table ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Compatible Pairs ({data.pairs.length}{data.isTruncated ? ', pool capped at 512' : ''})
              </h3>
              {data.pairs.length > 30 && (
                <button
                  type="button"
                  onClick={() => setShowAllPairs((v) => !v)}
                  className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                >
                  {showAllPairs ? 'Show fewer' : `Show all ${data.pairs.length}`}
                </button>
              )}
            </div>

            {data.pairs.length === 0 ? (
              <div className="glass rounded-2xl px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No compatible pairs to display.</p>
              </div>
            ) : (
              <div className="glass rounded-2xl overflow-hidden">
                <PairTableHeader />
                <div className="max-h-[500px] overflow-y-auto divide-y divide-[var(--color-border-faint)]">
                  {visiblePairs.map((pair, i) => (
                    <PairTableRow
                      key={`${pair.vocal.track.id}:${pair.instrumental.track.id}`}
                      pair={pair}
                      rank={i + 1}
                    />
                  ))}
                  {!showAllPairs && data.pairs.length > 30 && (
                    <div className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setShowAllPairs(true)}
                        className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                      >
                        Show {data.pairs.length - 30} more pairs…
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
