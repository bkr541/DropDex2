import type { RekordboxAnalysisStatus } from '../../types';

export type HeroImportTone = 'complete' | 'paused' | 'working' | 'incomplete' | 'failed';

export interface HeroImportState {
  tone: HeroImportTone;
  label: string;
  /** The import has analysis still to finish, so the word opens the list of tracks that need it. */
  needsAttention: boolean;
}

/** Where the latest import stands, in the words the hero shows. */
export function heroImportState(status: RekordboxAnalysisStatus | string | null | undefined): HeroImportState {
  switch (status) {
    case 'failed': return { tone: 'failed', label: 'Import failed', needsAttention: true };
    case 'paused':
    case 'pause_requested':
    case 'stopping':
    case 'cancelled':
    case 'interrupted': return { tone: 'paused', label: 'Import paused', needsAttention: true };
    case 'partial': return { tone: 'incomplete', label: 'Analysis incomplete', needsAttention: true };
    case 'awaiting_upload':
    case 'uploading':
    case 'uploaded':
    case 'parsing':
    case 'queued': return { tone: 'working', label: 'Analysing', needsAttention: true };
    default: return { tone: 'complete', label: 'Import complete', needsAttention: false };
  }
}

/** A count for a figure: a number with thousands separators, or a dash while it is unknown. */
export function heroFigure(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString();
}
