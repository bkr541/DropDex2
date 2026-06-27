import type { RekordboxImport } from '../../types';

export type ImportHistoryTone = 'success' | 'info' | 'warning' | 'error';

export interface ImportHistoryPresentation {
  label: string;
  tone: ImportHistoryTone;
  canActivate: boolean;
  canRetry: boolean;
  terminal: boolean;
}

export function getImportHistoryPresentation(
  status: RekordboxImport['status'],
  retryable = false,
): ImportHistoryPresentation {
  switch (status) {
    case 'completed':
      return { label: 'Completed', tone: 'success', canActivate: true, canRetry: false, terminal: true };
    case 'failed':
      return { label: 'Failed', tone: 'error', canActivate: false, canRetry: retryable, terminal: true };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'warning', canActivate: false, canRetry: false, terminal: true };
    case 'cancel_requested':
      return { label: 'Cancelling', tone: 'warning', canActivate: false, canRetry: false, terminal: false };
    case 'created':
      return { label: 'Created', tone: 'info', canActivate: false, canRetry: false, terminal: false };
    case 'uploading':
      return { label: 'Uploading', tone: 'info', canActivate: false, canRetry: false, terminal: false };
    case 'queued':
      return { label: 'Queued', tone: 'info', canActivate: false, canRetry: false, terminal: false };
    case 'processing':
      return { label: 'Processing', tone: 'info', canActivate: false, canRetry: false, terminal: false };
  }
}
