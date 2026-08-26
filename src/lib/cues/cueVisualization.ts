import type { WorkingCue } from '../music/cueEditorState';
import { REKORDBOX_MEMORY_CUE_COLORS } from './rekordboxCueColorCodec';

export type CueDisplayColorSource = 'canonical-hex' | 'canonical-name' | 'canonical-index' | 'unknown' | 'fallback';

export interface CueDisplayColor {
  hex: string;
  label: string;
  source: CueDisplayColorSource;
}

export interface CueLoopRangeGeometry {
  visible: boolean;
  leftPercent: number;
  widthPercent: number;
  startClipped: boolean;
  endClipped: boolean;
}

export interface CueProvenanceSummary {
  sources: string;
  resolution: string;
  conflict: string | null;
  blocking: boolean;
}

const FAMILY_FALLBACK = Object.freeze({
  hot: '#238df2',
  memory: '#9b5de5',
});

const UNKNOWN_COLOR = '#f59e0b';

const CANONICAL_COLOR_NAMES: Readonly<Record<string, string>> = Object.freeze({
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  aqua: '#06b6d4',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  purple: '#a855f7',
  violet: '#8b5cf6',
  pink: '#ec4899',
  magenta: '#d946ef',
  white: '#f8fafc',
});

function normalizedHex(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function resolveCueDisplayColor(cue: WorkingCue): CueDisplayColor {
  const hex = normalizedHex(cue.colorHex);
  if (hex) {
    return {
      hex,
      label: cue.colorName?.trim() || hex,
      source: 'canonical-hex',
    };
  }

  const colorName = cue.colorName?.trim();
  if (colorName) {
    const mapped = CANONICAL_COLOR_NAMES[colorName.toLowerCase()];
    if (mapped) return { hex: mapped, label: colorName, source: 'canonical-name' };
    return { hex: UNKNOWN_COLOR, label: `${colorName} · unsupported display color`, source: 'unknown' };
  }

  if (cue.family === 'memory' && cue.rekordboxColor != null && cue.rekordboxColor !== -1) {
    const mapped = REKORDBOX_MEMORY_CUE_COLORS.find((candidate) => candidate.index === cue.rekordboxColor);
    if (mapped) return { hex: mapped.hex, label: mapped.name, source: 'canonical-index' };
    return { hex: UNKNOWN_COLOR, label: `Unsupported Memory Color ${cue.rekordboxColor}`, source: 'unknown' };
  }

  if (cue.colorTableIndex != null) {
    return {
      hex: UNKNOWN_COLOR,
      label: `Rekordbox color index ${cue.colorTableIndex}`,
      source: 'unknown',
    };
  }

  return {
    hex: FAMILY_FALLBACK[cue.family],
    label: cue.family === 'hot' ? 'Hot Cue fallback' : 'Memory Cue fallback',
    source: 'fallback',
  };
}

export function cueLoopRangeGeometry(
  cue: WorkingCue,
  viewStart: number,
  viewEnd: number,
): CueLoopRangeGeometry | null {
  if (cue.pointType !== 'loop' || cue.startMs == null || cue.endMs == null || cue.endMs <= cue.startMs || viewEnd <= viewStart) {
    return null;
  }

  if (cue.endMs <= viewStart || cue.startMs >= viewEnd) {
    return {
      visible: false,
      leftPercent: 0,
      widthPercent: 0,
      startClipped: cue.startMs < viewStart,
      endClipped: cue.endMs > viewEnd,
    };
  }

  const visibleStart = Math.max(viewStart, cue.startMs);
  const visibleEnd = Math.min(viewEnd, cue.endMs);
  const viewDuration = viewEnd - viewStart;
  return {
    visible: visibleEnd > visibleStart,
    leftPercent: ((visibleStart - viewStart) / viewDuration) * 100,
    widthPercent: Math.max(0, ((visibleEnd - visibleStart) / viewDuration) * 100),
    startClipped: cue.startMs < viewStart,
    endClipped: cue.endMs > viewEnd,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function conflictLabel(reason: unknown): string | null {
  switch (reason) {
    case 'ambiguous_db_timing_match':
      return 'DB and ANLZ could not be matched to one unique cue. Apply remains blocked.';
    case 'anlz_removed_legacy_db_baseline_unrecoverable':
      return 'The legacy DB baseline cannot be reconstructed after ANLZ removal. Apply remains blocked.';
    default:
      return typeof reason === 'string' && reason.trim()
        ? `Canonical reconciliation reported ${reason.replace(/_/g, ' ')}. Apply remains blocked.`
        : null;
  }
}

export function summarizeCueProvenance(cue: WorkingCue): CueProvenanceSummary {
  const sourceNames = [cue.sourceDbPresent ? 'DB' : null, cue.sourceAnlzPresent ? 'ANLZ' : null]
    .filter((value): value is string => value != null);
  const payload = asRecord(cue.sourcePayload);
  const reconciliation = asRecord(payload?._dropdex_cue_reconciliation);
  const authority = typeof reconciliation?.authority === 'string'
    ? reconciliation.authority
    : cue.cueFamilyAuthority;
  const conflict = asRecord(reconciliation?.conflict);
  const reason = conflictLabel(conflict?.reason);

  let resolution = 'No imported source authority recorded.';
  if (authority === 'anlz') {
    resolution = cue.sourceConflict
      ? 'ANLZ evidence is present, but canonical reconciliation did not accept a destructive resolution.'
      : 'ANLZ cue semantics are the canonical resolution.';
  } else if (authority === 'provisional' || cue.sourceDbPresent) {
    resolution = cue.sourceConflict
      ? 'DB evidence is retained provisionally because reconciliation is unresolved.'
      : 'DB cue semantics are retained provisionally until authoritative ANLZ semantics are available.';
  } else if (cue.source === 'manual') {
    resolution = 'Manual DropDex cue; no imported source reconciliation applies.';
  } else if (cue.source === 'auto') {
    resolution = 'Auto Cue proposal in the DropDex draft; no imported source reconciliation applies.';
  }

  return {
    sources: sourceNames.length > 0 ? sourceNames.join(' + ') : cue.source === 'imported' ? 'Imported source unspecified' : 'DropDex draft',
    resolution,
    conflict: cue.sourceConflict ? reason ?? 'DB/ANLZ source reconciliation is unresolved. Apply remains blocked.' : null,
    blocking: cue.sourceConflict,
  };
}
