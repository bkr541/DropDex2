import type { CueDraftCue, CueDraftDocument } from './cueDraftDocument';
import { stableStringify } from './cueDraftDocument';
import { isSupportedMemoryDjmdCueColor } from './rekordboxCueColorCodec';

const HOT_KIND_BY_SLOT: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9 };
const RECONCILIATION_KEY = '_dropdex_cue_reconciliation';

/**
 * Per-track cue semantics that DropDex can prove from the imported Rekordbox
 * database evidence and compare with the guarded current-local master.db read.
 * Track identity is verified independently during apply preflight.
 */
export interface LocalCueBaselineRow {
  InMsec: number;
  OutMsec: number;
  Kind: number;
  Color: number;
  ColorTableIndex: number | null;
  ActiveLoop: number;
  Comment: string | null;
}

export interface LocalCueBaselinePayload {
  schemaVersion: 1;
  cues: LocalCueBaselineRow[];
}

type Evidence = Record<string, unknown>;

function record(value: unknown): Evidence | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Evidence
    : null;
}

function hasOwn(value: Evidence, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableIntegerEvidence(evidence: Evidence, key: string): number | null | undefined {
  if (!hasOwn(evidence, key)) return undefined;
  const value = evidence[key];
  if (value == null) return null;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function nullableStringEvidence(evidence: Evidence, key: string): string | null | undefined {
  if (!hasOwn(evidence, key)) return undefined;
  const value = evidence[key];
  return value == null || typeof value === 'string' ? value as string | null : undefined;
}

function booleanEvidence(evidence: Evidence, key: string): boolean | null {
  if (!hasOwn(evidence, key)) return null;
  return typeof evidence[key] === 'boolean' ? evidence[key] as boolean : null;
}

/**
 * Return only preserved database evidence. Reconciled/editor fields are never a
 * fallback here because ANLZ may already have changed their semantics.
 */
function importedDbEvidence(cue: CueDraftCue): Evidence | null {
  if (!cue.sourceDbPresent) return null;
  const payload = record(cue.sourcePayload);
  if (!payload) return null;

  const reconciliation = record(payload[RECONCILIATION_KEY]);
  if (reconciliation) {
    const db = record(reconciliation.db);
    return db;
  }

  // Fresh importer payloads preserve the pre-reconciliation DB row explicitly.
  // A legacy row that already contains ANLZ evidence is not safe to reverse-engineer.
  if (cue.sourceAnlzPresent) return null;
  return hasOwn(payload, 'provisional_cue_family') ? payload : null;
}

function writerKind(cue: CueDraftCue): number | null {
  // DLP DB evidence cannot prove Memory-vs-Hot/A-H ownership. That identity may
  // be augmented by ANLZ only after reconciliation has made it authoritative.
  if (cue.cueFamilyAuthority !== 'anlz' || !cue.sourceAnlzPresent) return null;
  if (cue.family === 'memory') return 0;
  if (cue.hotCueSlot == null) return null;
  return HOT_KIND_BY_SLOT[cue.hotCueSlot] ?? null;
}

function memoryDbColor(evidence: Evidence): number | null | undefined {
  // These names are intentionally explicit future-compatible raw-DB aliases.
  // PCO2 color_id/color_hex/color_name are not accepted as local DjmdCue.Color.
  for (const key of ['rekordbox_color', 'djmdcue_color', 'local_rekordbox_color', 'Color']) {
    const value = nullableIntegerEvidence(evidence, key);
    if (value !== undefined) {
      if (value == null || isSupportedMemoryDjmdCueColor(value)) return value;
      return undefined;
    }
  }
  return undefined;
}

function localCueRow(cue: CueDraftCue): LocalCueBaselineRow | null {
  if (cue.sourceConflict) return null;
  const evidence = importedDbEvidence(cue);
  const kind = writerKind(cue);
  if (!evidence || kind == null) return null;

  const pointType = evidence.point_type;
  if (pointType !== 'cue' && pointType !== 'loop') return null;
  const startMs = finiteNumber(evidence.start_ms);
  if (startMs == null || startMs < 0) return null;

  const comment = nullableStringEvidence(evidence, 'comment');
  const colorTableIndex = nullableIntegerEvidence(evidence, 'color_table_index');
  if (comment === undefined || colorTableIndex === undefined || (colorTableIndex != null && colorTableIndex < 0)) return null;

  let endMs = -1;
  let activeLoop = -1;
  if (pointType === 'loop') {
    const rawEnd = finiteNumber(evidence.end_ms);
    const rawActive = booleanEvidence(evidence, 'is_active_loop');
    if (rawEnd == null || rawEnd <= startMs || rawActive == null) return null;
    endMs = Math.trunc(rawEnd);
    activeLoop = rawActive ? 1 : 0;
  }

  let color: number;
  if (cue.family === 'hot') {
    color = pointType === 'loop' ? 255 : -1;
  } else {
    const rawColor = memoryDbColor(evidence);
    if (rawColor === undefined || rawColor == null) return null;
    color = rawColor;
  }

  return {
    InMsec: Math.trunc(startMs),
    OutMsec: endMs,
    Kind: kind,
    Color: color,
    ColorTableIndex: colorTableIndex,
    ActiveLoop: activeLoop,
    Comment: comment,
  };
}

export function createImportedLocalCueBaselinePayload(
  document: CueDraftDocument,
): LocalCueBaselinePayload | null {
  const cues: LocalCueBaselineRow[] = [];
  for (const cue of document.cues) {
    const row = localCueRow(cue);
    if (!row) return null;
    cues.push(row);
  }
  cues.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  return { schemaVersion: 1, cues };
}

export async function fingerprintImportedLocalCueBaseline(
  document: CueDraftDocument,
): Promise<string | null> {
  const payload = createImportedLocalCueBaselinePayload(document);
  if (!payload) return null;
  const bytes = new TextEncoder().encode(stableStringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
