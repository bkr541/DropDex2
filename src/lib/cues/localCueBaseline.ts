import type { CueDraftCue, CueDraftDocument } from './cueDraftDocument';
import { stableStringify } from './cueDraftDocument';

const HOT_KIND_BY_SLOT: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9 };
const MEMORY_COLOR_BY_NAME: Record<string, number> = {
  red: 1,
  orange: 2,
  yellow: 3,
  green: 4,
  aqua: 5,
  cyan: 5,
  blue: 6,
  purple: 7,
  violet: 7,
};

/**
 * Per-track cue semantics that DropDex can derive authoritatively from the
 * imported Device Library Plus cue rows and reproduce through the staging
 * writer. Track identity is verified independently during apply preflight, so
 * ContentID is intentionally not duplicated inside this fingerprint.
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

function cueColor(cue: CueDraftCue): number {
  if (cue.family === 'hot') return cue.pointType === 'loop' ? 255 : -1;
  if (cue.colorName) {
    const mapped = MEMORY_COLOR_BY_NAME[cue.colorName.trim().toLowerCase()];
    if (mapped != null) return mapped;
  }
  if (cue.colorTableIndex != null && cue.colorTableIndex >= 1 && cue.colorTableIndex <= 7) {
    return cue.colorTableIndex;
  }
  return -1;
}

function localCueRow(cue: CueDraftCue): LocalCueBaselineRow {
  const isLoop = cue.pointType === 'loop';
  const kind = cue.family === 'hot' && cue.hotCueSlot != null
    ? HOT_KIND_BY_SLOT[cue.hotCueSlot]
    : 0;
  if (kind == null) throw new Error('Imported Hot Cue baseline has an unsupported A-H slot.');

  return {
    InMsec: Math.trunc(cue.startMs),
    OutMsec: isLoop && cue.endMs != null ? Math.trunc(cue.endMs) : -1,
    Kind: kind,
    Color: cueColor(cue),
    ColorTableIndex: cue.colorTableIndex,
    ActiveLoop: isLoop ? (cue.isActiveLoop === true ? 1 : 0) : -1,
    Comment: cue.comment,
  };
}

export function createImportedLocalCueBaselinePayload(
  document: CueDraftDocument,
): LocalCueBaselinePayload | null {
  // The local-baseline claim is only comparable when every cue is anchored to
  // the imported database cue table. ANLZ-only/conflicting rows may still be
  // displayed and edited, but cannot prove what local master.db contained at
  // import time.
  if (document.cues.some((cue) => !cue.sourceDbPresent || cue.sourceConflict)) return null;

  const cues = document.cues
    .map((cue) => localCueRow(cue))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));

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
