import type { RekordboxAnalysisStatus, RekordboxImport } from '../../types';
import { describeAnalysisStatus } from './importLifecycle';

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
  analysisStatus: RekordboxAnalysisStatus | null = null,
): ImportHistoryPresentation {
  switch (status) {
    case 'completed': {
      if (analysisStatus === 'partial') {
        return {
          label: 'Completed with warnings',
          tone: 'warning',
          canActivate: true,
          canRetry: false,
          terminal: true,
        };
      }
      if (analysisStatus === 'failed') {
        return {
          label: 'Metadata imported',
          tone: 'warning',
          canActivate: true,
          canRetry: true,
          terminal: true,
        };
      }
      if (
        analysisStatus === 'awaiting_upload'
        || analysisStatus === 'uploading'
        || analysisStatus === 'uploaded'
        || analysisStatus === 'parsing'
        || analysisStatus === 'pause_requested'
        || analysisStatus === 'stopping'
      ) {
        return {
          label: describeAnalysisStatus(analysisStatus),
          tone: 'info',
          canActivate: true,
          canRetry: false,
          terminal: false,
        };
      }
      return {
        label: 'Completed',
        tone: 'success',
        canActivate: true,
        canRetry: false,
        terminal: true,
      };
    }
    case 'paused':
      return { label: 'Analysis paused', tone: 'warning', canActivate: true, canRetry: true, terminal: true };
    case 'interrupted':
      return { label: 'Analysis interrupted', tone: 'warning', canActivate: true, canRetry: true, terminal: true };
    case 'pause_requested':
      return { label: 'Stopping cloud analysis', tone: 'warning', canActivate: false, canRetry: false, terminal: false };
    case 'stopping':
      return { label: 'Stopping worker', tone: 'warning', canActivate: false, canRetry: false, terminal: false };
    case 'deleting':
      return { label: 'Deleting import', tone: 'warning', canActivate: false, canRetry: false, terminal: false };
    case 'running':
      return {
        label: analysisStatus ? describeAnalysisStatus(analysisStatus) : 'Running',
        tone: 'info',
        canActivate: false,
        canRetry: false,
        terminal: false,
      };
    case 'failed':
      return { label: 'Failed', tone: 'error', canActivate: false, canRetry: retryable, terminal: true };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'warning', canActivate: false, canRetry: false, terminal: true };
    case 'cancel_requested':
      return { label: 'Delete requested', tone: 'warning', canActivate: false, canRetry: false, terminal: false };
    case 'created':
      return { label: 'Created', tone: 'info', canActivate: false, canRetry: false, terminal: false };
    case 'uploading':
      return {
        label: analysisStatus ? describeAnalysisStatus(analysisStatus) : 'Uploading',
        tone: 'info',
        canActivate: false,
        canRetry: false,
        terminal: false,
      };
    case 'queued':
      return { label: 'Queued', tone: 'info', canActivate: false, canRetry: false, terminal: false };
    case 'processing':
      return {
        label: analysisStatus ? describeAnalysisStatus(analysisStatus) : 'Processing',
        tone: 'info',
        canActivate: false,
        canRetry: false,
        terminal: false,
      };
  }
}
