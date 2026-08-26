import type { UsbFileResolutionError } from '../lib/usb/resolveUsbFile';
import type { CueApplyScope } from '../lib/cues/cueApplyScope';

export type DesktopUsbStatus =
  | 'disconnected'
  | 'connected'
  | 'released'
  | 'wrong_root'
  | 'unavailable'
  | 'error';

export interface DesktopUsbState {
  status: DesktopUsbStatus;
  volumeName: string | null;
  connectedAt: string | null;
  structureWarning: string | null;
  error: string | null;
}


export interface DesktopUsbActivityState {
  connected: boolean;
  activeStreamCount: number;
  pendingRequestCount: number;
  activePlaybackCount: number;
  releasing: boolean;
  released: boolean;
  lastError: string | null;
}

export interface DesktopUsbReleaseResult {
  allStreamsClosed: boolean;
  timedOut: boolean;
  destroyedStreamCount: number;
  remainingStreamCount: number;
  pendingRequestCount: number;
  disconnected: boolean;
  state: DesktopUsbState;
  activity: DesktopUsbActivityState;
}

export type DesktopTrackSourceResult =
  | {
      ok: true;
      source: {
        kind: 'url';
        url: string;
        size: number;
      };
    }
  | {
      ok: false;
      error: UsbFileResolutionError;
    };


export interface DesktopCueApplyDraft {
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  revision: number;
  desiredFingerprint: string;
  importedBaselineFingerprint: string;
  importedBaselineLocalCueFingerprint: string | null;
  currentBaselineFingerprint?: string;
  currentBaselineLocalCueFingerprint?: string | null;
  masterDbId: string | null;
  masterContentId: string | null;
  desiredDocument: Record<string, unknown>;
}

export interface DesktopCueApplyDiagnostic { code: string; message: string; }

export type DesktopCueApplyScope = CueApplyScope;

export interface DesktopCueDiffCue {
  identity: string | null;
  family: string;
  hot_cue_slot: number | null;
  point_type: string;
  start_ms: number;
  end_ms: number | null;
  color: number | null;
  color_table_index: number | null;
  comment: string | null;
  is_active_loop: boolean | null;
}

export interface DesktopCueDiffChange {
  before: DesktopCueDiffCue;
  after: DesktopCueDiffCue;
  match_basis: string;
  changes: string[];
}

export interface DesktopCueTrackDiff {
  current_count: number;
  desired_count: number;
  added: DesktopCueDiffCue[];
  removed: DesktopCueDiffCue[];
  changed: DesktopCueDiffChange[];
  conflicts: string[];
  blocking: boolean;
}

export interface DesktopCueApplyPreflightTrack {
  content_id: string;
  exists: boolean;
  current_cue_fingerprint: string | null;
  draft_revision: number;
  desired_fingerprint: string;
  imported_baseline_fingerprint: string;
  imported_baseline_comparison: 'match' | 'diverged' | 'missing' | 'not-comparable';
  identity_comparison: 'match' | 'missing' | 'mismatch' | 'not-comparable';
  diff: DesktopCueTrackDiff | null;
}

export interface DesktopCueApplyPreflightResult {
  ok: boolean;
  preflight_id: string;
  plan_fingerprint: string;
  source_identity: string | null;
  tracks: DesktopCueApplyPreflightTrack[];
  blockers: DesktopCueApplyDiagnostic[];
  warnings: DesktopCueApplyDiagnostic[];
  token: string | null;
  expires_at: string | null;
}

export interface DesktopCueApplyTrackResult {
  content_id: string;
  state: 'verified' | 'not-verified';
  expected_count: number;
  actual_count: number;
  details: string | null;
  local_cue_fingerprint: string | null;
}

export interface DesktopCueApplyResult {
  ok: boolean;
  operation_id: string;
  state: 'applied' | 'rejected' | 'rolled-back' | 'recovery-unverified';
  plan_fingerprint: string;
  source_identity_before: string | null;
  source_identity_after: string | null;
  backup_identity: string | null;
  tracks: DesktopCueApplyTrackResult[];
  blockers: DesktopCueApplyDiagnostic[];
  warnings: DesktopCueApplyDiagnostic[];
  rollback_verified: boolean | null;
  recovery: Record<string, string> | null;
}

export interface DropDexDesktopBridge {
  readonly isElectron: true;
  getRuntimeInfo(): Promise<{ platform: string; version: string }>;
  getUsbState(): Promise<DesktopUsbState>;
  getUsbActivityState(): Promise<DesktopUsbActivityState>;
  selectUsbRoot(): Promise<{ cancelled: boolean; state: DesktopUsbState; error?: string }>;
  releaseUsb(): Promise<DesktopUsbReleaseResult>;
  disconnectUsb(): Promise<DesktopUsbReleaseResult>;
  resolveTrackSource(segments: string[]): Promise<DesktopTrackSourceResult>;
  cueApplyAvailability(): Promise<{ available: boolean; reason: string | null }>;
  cueApplyPreflight(scope: DesktopCueApplyScope, savedDrafts: DesktopCueApplyDraft[]): Promise<DesktopCueApplyPreflightResult>;
  cueApply(token: string, scope: DesktopCueApplyScope, savedDrafts: DesktopCueApplyDraft[]): Promise<DesktopCueApplyResult>;
  openExternal(url: string): Promise<boolean>;
}

declare global {
  interface Window {
    dropdexDesktop?: DropDexDesktopBridge;
  }
}

export {};
