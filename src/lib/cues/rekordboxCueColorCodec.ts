/**
 * Rekordbox cue color encodings are distinct domains.
 *
 * - Memory `DjmdCue.Color`: local master.db values -1 (clear) or 1..7.
 * - `ColorTableIndex`: an independent integer field, primarily used by Hot Cues.
 * - ANLZ PCO2 color data: export/display evidence, never a local DB baseline field.
 *
 * This module intentionally accepts PCO2 RGB/name evidence only for a supported
 * canonical desired Memory color. It never accepts a PCO2/color-table integer
 * as a Memory `DjmdCue.Color` value and is never used to prove imported DB truth.
 */
export const REKORDBOX_MEMORY_CUE_COLORS = Object.freeze([
  { index: 1, label: 'Red', name: 'Red', hex: '#ef4444', pco2Hex: '#FF0000' },
  { index: 2, label: 'Orange', name: 'Orange', hex: '#f97316', pco2Hex: '#FF8000' },
  { index: 3, label: 'Yellow', name: 'Yellow', hex: '#eab308', pco2Hex: '#FFFF00' },
  { index: 4, label: 'Green', name: 'Green', hex: '#22c55e', pco2Hex: '#00FF00' },
  { index: 5, label: 'Aqua', name: 'Aqua', hex: '#06b6d4', pco2Hex: '#00FFFF' },
  { index: 6, label: 'Blue', name: 'Blue', hex: '#3b82f6', pco2Hex: '#0000FF' },
  { index: 7, label: 'Purple', name: 'Purple', hex: '#a855f7', pco2Hex: '#8000FF' },
] as const);

export function isSupportedMemoryDjmdCueColor(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && (value === -1 || (value >= 1 && value <= 7));
}

export function memoryDjmdCueColorFromImportedDisplayEvidence(input: {
  colorHex: string | null;
  colorName: string | null;
}): number | null {
  const hex = input.colorHex?.trim().toUpperCase() ?? null;
  if (hex) {
    return REKORDBOX_MEMORY_CUE_COLORS.find((option) => option.pco2Hex === hex)?.index ?? null;
  }

  const name = input.colorName?.trim().toLowerCase() ?? null;
  if (!name) return null;
  const normalized = name === 'cyan' ? 'aqua' : name === 'violet' ? 'purple' : name;
  return REKORDBOX_MEMORY_CUE_COLORS.find((option) => option.name.toLowerCase() === normalized)?.index ?? null;
}
