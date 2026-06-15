/**
 * Camelot Wheel relationship classification.
 *
 * The Camelot Wheel is a circular layout of 24 keys (12 minor "A" positions,
 * 12 major "B" positions) arranged so that harmonically compatible keys are
 * adjacent.  Positions 1–12 wrap: 12 + 1 = 1.
 *
 * Relationship types defined here:
 *   exact        – same key (12A → 12A)
 *   relative     – same number, opposite mode (12A → 12B)
 *   adjacent_up  – number + 1, same mode (12A → 1A)
 *   adjacent_down– number − 1, same mode (12A → 11A)
 *   energy_boost – number + 2, same mode (12A → 2A)
 *   incompatible – anything else
 *   unknown      – source or candidate is null / unparseable
 *
 * Energy-boost direction: +2 steps forward on the wheel (same mode only).
 * This is a whole-tone jump in the circle of fifths and conventionally raises
 * the perceived energy level of a mix.  The inverse (−2) is not modelled as a
 * named relationship in this version.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type CamelotMode = 'A' | 'B'; // A = minor, B = major

export interface CamelotKey {
  /** 1–12 */
  number: number;
  /** 'A' (minor) or 'B' (major) */
  mode: CamelotMode;
  /** Canonical string representation, e.g. "8A" */
  code: string;
}

export type CamelotRelationship =
  | 'exact'
  | 'relative'
  | 'adjacent_up'
  | 'adjacent_down'
  | 'energy_boost'
  | 'incompatible'
  | 'unknown';

export interface CompatibleKey {
  code: string;
  relationship: Exclude<CamelotRelationship, 'incompatible' | 'unknown'>;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const _RE_CAMELOT = /^\s*(1[0-2]|[1-9])([ABab])\s*$/;

/** Wraps a 1-based Camelot number into the [1, 12] range. */
function _wrap12(n: number): number {
  return ((n - 1 + 12) % 12) + 1;
}

function _opposite(mode: CamelotMode): CamelotMode {
  return mode === 'A' ? 'B' : 'A';
}

function _toCode(number: number, mode: CamelotMode): string {
  return `${number}${mode}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a Camelot key string (e.g. "8A", "12b", " 1A ") into a structured
 * CamelotKey, or return null for null / blank / invalid input.
 */
export function parseCamelotKey(value: string | null | undefined): CamelotKey | null {
  if (value == null) return null;
  const m = _RE_CAMELOT.exec(value);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  const mode = m[2].toUpperCase() as CamelotMode;
  return { number, mode, code: _toCode(number, mode) };
}

/**
 * Classify the harmonic relationship between two Camelot keys.
 *
 * Both `source` and `candidate` may be raw strings (e.g. "8A") or null.
 * Returns 'unknown' when either value cannot be parsed.
 */
export function classifyCamelotRelationship(
  source: string | null | undefined,
  candidate: string | null | undefined,
): CamelotRelationship {
  const src = parseCamelotKey(source);
  const cnd = parseCamelotKey(candidate);
  if (!src || !cnd) return 'unknown';

  const { number: sn, mode: sm } = src;
  const { number: cn, mode: cm } = cnd;

  if (cn === sn && cm === sm) return 'exact';
  if (cn === sn && cm === _opposite(sm)) return 'relative';
  if (cn === _wrap12(sn + 1) && cm === sm) return 'adjacent_up';
  if (cn === _wrap12(sn - 1) && cm === sm) return 'adjacent_down';
  if (cn === _wrap12(sn + 2) && cm === sm) return 'energy_boost';
  return 'incompatible';
}

/**
 * Return all harmonically compatible keys for a given source key, ordered by
 * relationship quality (exact → relative → adjacent → energy_boost).
 *
 * Returns an empty array when the source key cannot be parsed.
 */
export function getCompatibleCamelotKeys(
  value: string | null | undefined,
): CompatibleKey[] {
  const src = parseCamelotKey(value);
  if (!src) return [];

  const { number: n, mode: m } = src;

  return [
    { code: _toCode(n, m),              relationship: 'exact'         },
    { code: _toCode(n, _opposite(m)),   relationship: 'relative'      },
    { code: _toCode(_wrap12(n + 1), m), relationship: 'adjacent_up'   },
    { code: _toCode(_wrap12(n - 1), m), relationship: 'adjacent_down' },
    { code: _toCode(_wrap12(n + 2), m), relationship: 'energy_boost'  },
  ];
}

/** Human-readable label for each relationship type. */
export function getCamelotRelationshipLabel(relationship: CamelotRelationship): string {
  switch (relationship) {
    case 'exact':         return 'Perfect Match';
    case 'relative':      return 'Relative Key';
    case 'adjacent_up':   return 'Step Up';
    case 'adjacent_down': return 'Step Down';
    case 'energy_boost':  return 'Energy Boost';
    case 'incompatible':  return 'Incompatible';
    case 'unknown':       return 'Unknown';
  }
}

/**
 * Harmonic compatibility score in [0, 1].
 *
 * Default scale:
 *   exact         1.00
 *   relative      0.95
 *   adjacent_up   0.92
 *   adjacent_down 0.90
 *   energy_boost  0.72
 *   incompatible  0
 *   unknown       0
 */
export function getCamelotRelationshipScore(relationship: CamelotRelationship): number {
  switch (relationship) {
    case 'exact':         return 1.00;
    case 'relative':      return 0.95;
    case 'adjacent_up':   return 0.92;
    case 'adjacent_down': return 0.90;
    case 'energy_boost':  return 0.72;
    case 'incompatible':  return 0;
    case 'unknown':       return 0;
  }
}
