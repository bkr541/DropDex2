import { IMPORT_API_BASE } from './baseUrl';
import {
  ApiResponseValidationError,
  expectArray,
  expectBoolean,
  expectNullableNumber,
  expectNullableString,
  expectNumber,
  expectOptionalBoolean,
  expectOptionalNullableString,
  expectOptionalNumber,
  expectRecord,
  expectString,
  expectStringArray,
} from './responseValidation';

// ── Response types ────────────────────────────────────────────────────────────

export type DeleteActiveStrategy = 'activate_next' | 'start_over';

export type ImportJobState =
  | 'created' | 'uploading' | 'queued' | 'processing' | 'running'
  | 'pause_requested' | 'paused' | 'cancel_requested' | 'stopping'
  | 'deleting' | 'cancelled' | 'completed' | 'failed' | 'interrupted';

export interface ImportJob {
  import_id: string;
  status: ImportJobState;
  source_filename: string;
  source_bundle_type: string | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  analysis_status?: string | null;
  worker_status?: string | null;
  worker_stage?: string | null;
  worker_current_track_id?: string | null;
  worker_last_heartbeat?: string | null;
  worker_stopped_acknowledged?: boolean;
}

export interface ImportWorkerState {
  import_id: string;
  job_status: ImportJobState;
  analysis_status: string;
  worker_status: string;
  worker_active: boolean;
  current_track_id: string | null;
  processing_stage: string | null;
  last_heartbeat: string | null;
  stop_reason: 'pause' | 'delete' | null;
  stopped_acknowledged: boolean;
  stopped_at: string | null;
  error: string | null;
}

export interface ImportResult {
  import_id: string;
  status: string;
  source_filename: string;
  track_count: number;
  playlist_count: number;
  playlist_track_count: number;
  playlists: Array<{ name: string; track_count: number }>;
}

export interface ManifestEntry {
  track_id: string;
  rekordbox_content_id: string;
  dat_path: string | null;
  ext_path: string | null;
  two_ex_path: string | null;
  dat_required: boolean;
  ext_required?: boolean;
  required_asset_types?: string[];
  optional_archival_asset_types?: string[];
  source_fingerprint?: string | null;
  manifest_status?: string;
  reused_from_track_id?: string | null;
  reuse_reason?: string | null;
  cue_changed?: boolean;
  analysis_changed?: boolean;
  information_changed?: boolean;
}

export interface ImportStartResponse {
  import_id: string;
  analysis_status: string;
  expected_track_count: number;
  manifest: ManifestEntry[];
  tracks_reused?: number;
  tracks_needing_upload?: number;
  tracks_reparse_from_retained?: number;
  tracks_metadata_only?: number;
  required_analysis_file_count?: number;
  optional_archival_file_count?: number;
  tracks_already_reusable?: number;
  library_ready?: boolean;
  readiness_stage?: string;
}

export interface ReuseStats {
  tracksReused: number;
  tracksNeedingUpload: number;
  tracksReparsedFromRetained: number;
  tracksMetadataOnly: number;
}

export interface BatchFileResult {
  canonical_path: string;
  status: string; // received | already_received | rejected | error
  sha256: string | null;
  file_size: number | null;
  reject_reason: string | null;
}

export interface BatchUploadResponse {
  import_id: string;
  received_count: number;
  already_received_count: number;
  rejected_count: number;
  error_count: number;
  received_bytes: number;
  files: BatchFileResult[];
}

export interface TrackCompleteStatus {
  track_id: string;
  rekordbox_content_id: string;
  parse_status: string; // completed | partial | failed | missing_required
  assets_parsed: number;
  warnings: Record<string, unknown>[];
}

export interface CompleteResponse {
  import_id: string;
  analysis_status: string; // completed | partial | failed | not_requested
  total_tracks: number;
  completed_count: number;
  partial_count: number;
  failed_count: number;
  missing_required_count: number;
  missing_optional_ext_count: number;
  missing_optional_2ex_count: number;
  parser_version: string;
  tracks: TrackCompleteStatus[];
  background_started?: boolean;
  library_ready?: boolean;
  readiness_stage?: string;
  queued_track_count?: number;
  optional_archival_status?: string;
  raw_archival_status?: string;
}

/** Structured per-track unresolved target (new in v2 API). */
export interface ResumeTargetResponse {
  track_id: string;
  rekordbox_content_id: string | null;
  relative_path: string;
  asset_type: 'DAT' | 'EXT' | '2EX';
  required: boolean;
  status: 'missing' | 'upload_failed' | 'parse_failed' | 'optional_missing';
  reason: string | null;
  attempt_count: number | null;
}

export interface AnalysisStatusResponse {
  import_id: string;
  analysis_status: string;
  expected_track_count: number;
  matched_track_count: number;
  parsed_track_count: number;
  completed_track_count?: number;
  partial_track_count?: number;
  failed_track_count: number;
  asset_count: number;
  // Legacy path arrays — still present for backward compat.
  missing_required_paths: string[];
  missing_optional_ext: string[];
  missing_optional_2ex: string[];
  parser_version: string | null;
  warnings: Record<string, unknown>[];
  current_track_id?: string | null;
  current_track_title?: string | null;
  current_track_artist?: string | null;
  current_track_label?: string | null;
  progress_percent?: number;
  // Structured targets (new) — empty array on older backends.
  unresolved_targets: ResumeTargetResponse[];
  missing_required_count: number;
  missing_optional_count: number;
  failed_upload_count: number;
  failed_parse_count: number;
  affected_track_count: number;
  job_status?: ImportJobState;
  worker_status?: string;
  worker_active?: boolean;
  worker_stage?: string | null;
  worker_last_heartbeat?: string | null;
  worker_stopped_acknowledged?: boolean;
  library_ready?: boolean;
  readiness_stage?: string;
  required_analysis_file_count?: number;
  optional_archival_file_count?: number;
  tracks_ready_count?: number;
  tracks_remaining_count?: number;
  tracks_queued_count?: number;
  tracks_running_count?: number;
  optional_archival_status?: string;
  raw_archival_status?: string;
  measured_tracks_per_second?: number | null;
  estimated_seconds_remaining?: number | null;
  performance_metrics?: Record<string, unknown>;
}

/** One ANLZ file to upload — carries its canonical Storage path. */
export interface AnalysisFileUpload {
  file: File;
  canonicalPath: string;
}

// ── Structured import error ───────────────────────────────────────────────────

/** Structured diagnostic returned by the backend when a write stage fails. */
export interface ImportWriteError {
  error_code: string;
  /** The specific write stage that failed (e.g. "insert_tracks"). */
  stage?: string;
  table?: string;
  /** Safe user-facing explanation. */
  detail: string;
  /** Short technical hint for developers. */
  diagnostic?: string;
  retryable?: boolean;
  status?: string;
}

/** An Error subclass that carries structured backend diagnostic info. */
export class RekordboxImportError extends Error {
  readonly structured: ImportWriteError | null;
  readonly status: number | null;

  constructor(
    message: string,
    structured: ImportWriteError | null = null,
    status: number | null = null,
  ) {
    super(message);
    this.name = 'RekordboxImportError';
    this.structured = structured;
    this.status = status;
  }
}

export function isUnauthorizedRekordboxImportError(error: unknown): boolean {
  return error instanceof RekordboxImportError && error.status === 401;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const API_BASE = IMPORT_API_BASE;

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');
}

type Validator<T> = (value: unknown) => T;

function validateImportJob(value: unknown): ImportJob {
  const contract = 'import job';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  expectString(row.status, contract, '$.status');
  expectString(row.source_filename, contract, '$.source_filename');
  expectNullableString(row.source_bundle_type, contract, '$.source_bundle_type');
  expectNullableString(row.error_code, contract, '$.error_code');
  expectNullableString(row.error_message, contract, '$.error_message');
  expectBoolean(row.retryable, contract, '$.retryable');
  expectOptionalNullableString(row.analysis_status, contract, '$.analysis_status');
  expectOptionalNullableString(row.worker_status, contract, '$.worker_status');
  expectOptionalNullableString(row.worker_stage, contract, '$.worker_stage');
  expectOptionalNullableString(row.worker_current_track_id, contract, '$.worker_current_track_id');
  expectOptionalNullableString(row.worker_last_heartbeat, contract, '$.worker_last_heartbeat');
  expectOptionalBoolean(row.worker_stopped_acknowledged, contract, '$.worker_stopped_acknowledged');
  return row as unknown as ImportJob;
}

function validateImportResult(value: unknown): ImportResult {
  const contract = 'import result';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  expectString(row.status, contract, '$.status');
  expectString(row.source_filename, contract, '$.source_filename');
  expectNumber(row.track_count, contract, '$.track_count');
  expectNumber(row.playlist_count, contract, '$.playlist_count');
  expectNumber(row.playlist_track_count, contract, '$.playlist_track_count');
  expectArray(row.playlists, contract, '$.playlists').forEach((item, index) => {
    const playlist = expectRecord(item, contract, `$.playlists[${index}]`);
    expectString(playlist.name, contract, `$.playlists[${index}].name`);
    expectNumber(playlist.track_count, contract, `$.playlists[${index}].track_count`);
  });
  return row as unknown as ImportResult;
}

function validateImportStart(value: unknown): ImportStartResponse {
  const contract = 'import start';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  expectString(row.analysis_status, contract, '$.analysis_status');
  expectNumber(row.expected_track_count, contract, '$.expected_track_count');
  expectOptionalNumber(row.tracks_reused, contract, '$.tracks_reused');
  expectOptionalNumber(row.tracks_needing_upload, contract, '$.tracks_needing_upload');
  expectOptionalNumber(row.tracks_reparse_from_retained, contract, '$.tracks_reparse_from_retained');
  expectOptionalNumber(row.tracks_metadata_only, contract, '$.tracks_metadata_only');
  expectOptionalNumber(row.required_analysis_file_count, contract, '$.required_analysis_file_count');
  expectOptionalNumber(row.optional_archival_file_count, contract, '$.optional_archival_file_count');
  expectOptionalNumber(row.tracks_already_reusable, contract, '$.tracks_already_reusable');
  expectOptionalBoolean(row.library_ready, contract, '$.library_ready');
  if (row.readiness_stage !== undefined) expectString(row.readiness_stage, contract, '$.readiness_stage');
  expectArray(row.manifest, contract, '$.manifest').forEach((item, index) => {
    const path = `$.manifest[${index}]`;
    const manifest = expectRecord(item, contract, path);
    expectString(manifest.track_id, contract, `${path}.track_id`);
    expectString(manifest.rekordbox_content_id, contract, `${path}.rekordbox_content_id`);
    expectNullableString(manifest.dat_path, contract, `${path}.dat_path`);
    expectNullableString(manifest.ext_path, contract, `${path}.ext_path`);
    expectNullableString(manifest.two_ex_path, contract, `${path}.two_ex_path`);
    expectBoolean(manifest.dat_required, contract, `${path}.dat_required`);
    expectOptionalBoolean(manifest.ext_required, contract, `${path}.ext_required`);
    if (manifest.required_asset_types !== undefined) expectStringArray(manifest.required_asset_types, contract, `${path}.required_asset_types`);
    if (manifest.optional_archival_asset_types !== undefined) expectStringArray(manifest.optional_archival_asset_types, contract, `${path}.optional_archival_asset_types`);
    expectOptionalNullableString(manifest.source_fingerprint, contract, `${path}.source_fingerprint`);
    if (manifest.manifest_status !== undefined) expectString(manifest.manifest_status, contract, `${path}.manifest_status`);
    expectOptionalNullableString(manifest.reused_from_track_id, contract, `${path}.reused_from_track_id`);
    expectOptionalNullableString(manifest.reuse_reason, contract, `${path}.reuse_reason`);
    expectOptionalBoolean(manifest.cue_changed, contract, `${path}.cue_changed`);
    expectOptionalBoolean(manifest.analysis_changed, contract, `${path}.analysis_changed`);
    expectOptionalBoolean(manifest.information_changed, contract, `${path}.information_changed`);
  });
  return row as unknown as ImportStartResponse;
}

function validateBatchUpload(value: unknown): BatchUploadResponse {
  const contract = 'analysis batch';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  for (const key of ['received_count', 'already_received_count', 'rejected_count', 'error_count', 'received_bytes']) {
    expectNumber(row[key], contract, `$.${key}`);
  }
  expectArray(row.files, contract, '$.files').forEach((item, index) => {
    const path = `$.files[${index}]`;
    const file = expectRecord(item, contract, path);
    expectString(file.canonical_path, contract, `${path}.canonical_path`);
    expectString(file.status, contract, `${path}.status`);
    expectNullableString(file.sha256, contract, `${path}.sha256`);
    expectNullableNumber(file.file_size, contract, `${path}.file_size`);
    expectNullableString(file.reject_reason, contract, `${path}.reject_reason`);
  });
  return row as unknown as BatchUploadResponse;
}

function validateComplete(value: unknown): CompleteResponse {
  const contract = 'import completion';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  expectString(row.analysis_status, contract, '$.analysis_status');
  for (const key of [
    'total_tracks', 'completed_count', 'partial_count', 'failed_count',
    'missing_required_count', 'missing_optional_ext_count', 'missing_optional_2ex_count',
  ]) {
    expectNumber(row[key], contract, `$.${key}`);
  }
  expectString(row.parser_version, contract, '$.parser_version');
  expectOptionalBoolean(row.background_started, contract, '$.background_started');
  expectOptionalBoolean(row.library_ready, contract, '$.library_ready');
  if (row.readiness_stage !== undefined) expectString(row.readiness_stage, contract, '$.readiness_stage');
  expectOptionalNumber(row.queued_track_count, contract, '$.queued_track_count');
  if (row.optional_archival_status !== undefined) expectString(row.optional_archival_status, contract, '$.optional_archival_status');
  if (row.raw_archival_status !== undefined) expectString(row.raw_archival_status, contract, '$.raw_archival_status');
  expectArray(row.tracks, contract, '$.tracks').forEach((item, index) => {
    const path = `$.tracks[${index}]`;
    const track = expectRecord(item, contract, path);
    expectString(track.track_id, contract, `${path}.track_id`);
    expectString(track.rekordbox_content_id, contract, `${path}.rekordbox_content_id`);
    expectString(track.parse_status, contract, `${path}.parse_status`);
    expectNumber(track.assets_parsed, contract, `${path}.assets_parsed`);
    expectArray(track.warnings, contract, `${path}.warnings`);
  });
  return row as unknown as CompleteResponse;
}

function validateAnalysisStatus(value: unknown): AnalysisStatusResponse {
  const contract = 'analysis status';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  expectString(row.analysis_status, contract, '$.analysis_status');
  for (const key of [
    'expected_track_count', 'matched_track_count', 'parsed_track_count',
    'failed_track_count', 'asset_count', 'missing_required_count',
    'missing_optional_count', 'failed_upload_count', 'failed_parse_count',
    'affected_track_count',
  ]) {
    expectNumber(row[key], contract, `$.${key}`);
  }
  expectOptionalNumber(row.completed_track_count, contract, '$.completed_track_count');
  expectOptionalNumber(row.partial_track_count, contract, '$.partial_track_count');
  expectStringArray(row.missing_required_paths, contract, '$.missing_required_paths');
  expectStringArray(row.missing_optional_ext, contract, '$.missing_optional_ext');
  expectStringArray(row.missing_optional_2ex, contract, '$.missing_optional_2ex');
  expectNullableString(row.parser_version, contract, '$.parser_version');
  expectArray(row.warnings, contract, '$.warnings');
  expectOptionalNullableString(row.current_track_id, contract, '$.current_track_id');
  expectOptionalNullableString(row.current_track_title, contract, '$.current_track_title');
  expectOptionalNullableString(row.current_track_artist, contract, '$.current_track_artist');
  expectOptionalNullableString(row.current_track_label, contract, '$.current_track_label');
  expectOptionalNumber(row.progress_percent, contract, '$.progress_percent');
  if (row.job_status !== undefined) expectString(row.job_status, contract, '$.job_status');
  if (row.worker_status !== undefined) expectString(row.worker_status, contract, '$.worker_status');
  expectOptionalBoolean(row.worker_active, contract, '$.worker_active');
  expectOptionalNullableString(row.worker_stage, contract, '$.worker_stage');
  expectOptionalNullableString(row.worker_last_heartbeat, contract, '$.worker_last_heartbeat');
  expectOptionalBoolean(row.worker_stopped_acknowledged, contract, '$.worker_stopped_acknowledged');
  expectOptionalBoolean(row.library_ready, contract, '$.library_ready');
  if (row.readiness_stage !== undefined) expectString(row.readiness_stage, contract, '$.readiness_stage');
  for (const key of [
    'required_analysis_file_count', 'optional_archival_file_count', 'tracks_ready_count',
    'tracks_remaining_count', 'tracks_queued_count', 'tracks_running_count',
  ]) expectOptionalNumber(row[key], contract, `$.${key}`);
  if (row.optional_archival_status !== undefined) expectString(row.optional_archival_status, contract, '$.optional_archival_status');
  if (row.raw_archival_status !== undefined) expectString(row.raw_archival_status, contract, '$.raw_archival_status');
  if (row.measured_tracks_per_second !== undefined) expectNullableNumber(row.measured_tracks_per_second, contract, '$.measured_tracks_per_second');
  if (row.estimated_seconds_remaining !== undefined) expectNullableNumber(row.estimated_seconds_remaining, contract, '$.estimated_seconds_remaining');
  if (row.performance_metrics !== undefined) expectRecord(row.performance_metrics, contract, '$.performance_metrics');
  expectArray(row.unresolved_targets, contract, '$.unresolved_targets').forEach((item, index) => {
    const path = `$.unresolved_targets[${index}]`;
    const target = expectRecord(item, contract, path);
    expectString(target.track_id, contract, `${path}.track_id`);
    expectNullableString(target.rekordbox_content_id, contract, `${path}.rekordbox_content_id`);
    expectString(target.relative_path, contract, `${path}.relative_path`);
    expectString(target.asset_type, contract, `${path}.asset_type`);
    expectBoolean(target.required, contract, `${path}.required`);
    expectString(target.status, contract, `${path}.status`);
    expectNullableString(target.reason, contract, `${path}.reason`);
    expectNullableNumber(target.attempt_count, contract, `${path}.attempt_count`);
  });
  return row as unknown as AnalysisStatusResponse;
}

function validateWorkerState(value: unknown): ImportWorkerState {
  const contract = 'import worker state';
  const row = expectRecord(value, contract);
  expectString(row.import_id, contract, '$.import_id');
  expectString(row.job_status, contract, '$.job_status');
  expectString(row.analysis_status, contract, '$.analysis_status');
  expectString(row.worker_status, contract, '$.worker_status');
  expectBoolean(row.worker_active, contract, '$.worker_active');
  expectNullableString(row.current_track_id, contract, '$.current_track_id');
  expectNullableString(row.processing_stage, contract, '$.processing_stage');
  expectNullableString(row.last_heartbeat, contract, '$.last_heartbeat');
  expectNullableString(row.stop_reason, contract, '$.stop_reason');
  expectBoolean(row.stopped_acknowledged, contract, '$.stopped_acknowledged');
  expectNullableString(row.stopped_at, contract, '$.stopped_at');
  expectNullableString(row.error, contract, '$.error');
  return row as unknown as ImportWorkerState;
}


async function parseResponse<T>(
  response: Response,
  validator: Validator<T>,
): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const bodyObj = body as Record<string, unknown> | null;
    const rawDetail = bodyObj?.['detail'];
    if (rawDetail && typeof rawDetail === 'object' && 'error_code' in (rawDetail as object)) {
      const structured = rawDetail as ImportWriteError;
      throw new RekordboxImportError(structured.detail, structured, response.status);
    }
    const message = typeof rawDetail === 'string' ? rawDetail : `HTTP ${response.status}`;
    throw new RekordboxImportError(message, null, response.status);
  }
  if (body === null) {
    throw new ApiResponseValidationError('import API', '$', 'valid JSON');
  }
  return validator(body);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createRekordboxImportJob(
  sourceFilename: string,
  sourceBundleType: 'database_only' | 'usb_folder' | 'zip_bundle',
  accessToken: string,
  options?: { deviceName?: string; signal?: AbortSignal },
): Promise<ImportJob> {
  const response = await fetch(`${API_BASE}/api/rekordbox/import/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_filename: sourceFilename,
      source_bundle_type: sourceBundleType,
      device_name: options?.deviceName,
    }),
    signal: options?.signal,
  });
  return parseResponse(response, validateImportJob);
}

export async function cancelRekordboxImport(
  importId: string, accessToken: string, signal?: AbortSignal,
): Promise<ImportJob> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/cancel`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse(response, validateImportJob);
}

export async function pauseRekordboxAnalysis(
  importId: string, accessToken: string, signal?: AbortSignal,
): Promise<ImportJob> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/pause`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse(response, validateImportJob);
}

export async function deleteRekordboxImport(
  importId: string,
  accessToken: string,
  signal?: AbortSignal,
  activeStrategy: DeleteActiveStrategy = 'activate_next',
): Promise<ImportJob> {
  const params = new URLSearchParams({ active_strategy: activeStrategy });
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}?${params.toString()}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse(response, validateImportJob);
}

export async function fetchRekordboxWorkerState(
  importId: string, accessToken: string, signal?: AbortSignal,
): Promise<ImportWorkerState> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/worker-state`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse(response, validateWorkerState);
}


export async function fetchRekordboxImportJob(
  importId: string, accessToken: string, signal?: AbortSignal,
): Promise<ImportJob> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/job-status`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse(response, validateImportJob);
}

/** Legacy: upload exportLibrary.db and import metadata only (no analysis). */
export async function uploadRekordboxDb(
  file: File,
  accessToken: string,
  options?: { deviceName?: string; signal?: AbortSignal; importId?: string },
): Promise<ImportResult> {
  throwIfSignalAborted(options?.signal);
  const formData = new FormData();
  formData.append('file', file);
  if (options?.deviceName) formData.append('device_name', options.deviceName);
  if (options?.importId) formData.append('import_id', options.importId);
  throwIfSignalAborted(options?.signal);

  const response = await fetch(`${API_BASE}/api/rekordbox/import`, {
    method: 'POST',
    headers: {
      // Do NOT set Content-Type — the browser sets it with the correct multipart boundary.
      // Do NOT include any user_id — user identity is determined by the backend from this token.
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
    signal: options?.signal,
  });
  return parseResponse(response, validateImportResult);
}

/**
 * Stage 1 of USB folder import: upload exportLibrary.db and receive the ANLZ manifest.
 * Read-only contract: File/FormData reads are the only local operations. This
 * client never requests a writable handle and never modifies the source drive.
 */
export async function startRekordboxImport(
  file: File,
  accessToken: string,
  signal?: AbortSignal,
  deviceName?: string,
  importId?: string,
): Promise<ImportStartResponse> {
  throwIfSignalAborted(signal);
  const formData = new FormData();
  formData.append('file', file);
  if (deviceName) formData.append('device_name', deviceName);
  if (importId) formData.append('import_id', importId);
  throwIfSignalAborted(signal);

  const response = await fetch(`${API_BASE}/api/rekordbox/import/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
    signal,
  });
  return parseResponse(response, validateImportStart);
}

/**
 * Stage 2: upload a batch of ANLZ analysis files for an existing import.
 * The browser reads immutable File objects supplied by the folder picker; no
 * USB-side write, delete, rename, or database mutation API is used.
 */
export async function uploadRekordboxAnalysisBatch(
  importId: string,
  files: AnalysisFileUpload[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<BatchUploadResponse> {
  throwIfSignalAborted(signal);
  const formData = new FormData();
  formData.append('file_metadata', JSON.stringify(files.map((item) => ({
    canonical_path: item.canonicalPath,
    size: item.file.size,
    last_modified_ms: item.file.lastModified || 0,
  }))));
  for (const item of files) {
    // Use the full canonical path (e.g. PIONEER/USBANLZ/P001/ANLZ0000.DAT) as
    // the multipart filename so the backend can validate and store it correctly.
    formData.append('files', item.file, item.canonicalPath);
  }
  throwIfSignalAborted(signal);

  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/analysis-batch`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      signal,
    },
  );
  return parseResponse(response, validateBatchUpload);
}

/** Stage 3: trigger server-side ANLZ parsing and get per-track results. */
export async function completeRekordboxImport(
  importId: string,
  accessToken: string,
  options?: {
    affectedTrackIds?: string[];
    clientMetrics?: Record<string, Record<string, number>>;
    signal?: AbortSignal;
  },
): Promise<CompleteResponse> {
  const body = JSON.stringify({
    affected_track_ids: options?.affectedTrackIds?.length ? options.affectedTrackIds : null,
    background: true,
    client_metrics: options?.clientMetrics ?? null,
  });

  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/complete`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: options?.signal,
    },
  );
  return parseResponse(response, validateComplete);
}

export async function resumeRekordboxAnalysis(
  importId: string,
  accessToken: string,
  options?: {
    affectedTrackIds?: string[];
    clientMetrics?: Record<string, Record<string, number>>;
    signal?: AbortSignal;
  },
): Promise<CompleteResponse> {
  const body = JSON.stringify({
    affected_track_ids: options?.affectedTrackIds?.length ? options.affectedTrackIds : null,
    background: true,
    client_metrics: options?.clientMetrics ?? null,
  });
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/resume`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: options?.signal,
    },
  );
  return parseResponse(response, validateComplete);
}


/** Poll analysis status for an existing import. */
export async function fetchRekordboxAnalysisStatus(
  importId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<AnalysisStatusResponse> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/analysis-status`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse(response, validateAnalysisStatus);
}

/**
 * Upload a ZIP bundle containing exportLibrary.db + ANLZ files.
 * Uses XHR so upload progress can be reported via onProgress(0–100).
 * Abortable via AbortSignal.
 */
export async function uploadRekordboxZipBundle(
  file: File,
  accessToken: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  importId?: string,
): Promise<CompleteResponse> {
  throwIfSignalAborted(signal);

  return new Promise<CompleteResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    if (importId) formData.append('import_id', importId);
    try {
      throwIfSignalAborted(signal);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;

    const handleSignalAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', handleSignalAbort);
    const resolveOnce = (value: CompleteResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Handled below: successful imports must still return a valid response body.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (!body || typeof body !== 'object') {
          rejectOnce(new RekordboxImportError('The import server returned an invalid response.'));
          return;
        }
        try {
          resolveOnce(validateComplete(body));
        } catch (error) {
          rejectOnce(error);
        }
        return;
      }

      const rawDetail = (body as { detail?: string | ImportWriteError } | null)?.detail;
      if (rawDetail && typeof rawDetail === 'object') {
        rejectOnce(new RekordboxImportError(rawDetail.detail, rawDetail, xhr.status));
      } else {
        rejectOnce(new RekordboxImportError(
          typeof rawDetail === 'string' ? rawDetail : `HTTP ${xhr.status}`,
          null,
          xhr.status,
        ));
      }
    });

    xhr.addEventListener('error', () => {
      rejectOnce(new Error('Network error during bundle upload'));
    });
    xhr.addEventListener('abort', () => {
      rejectOnce(new DOMException('Upload aborted', 'AbortError'));
    });

    signal?.addEventListener('abort', handleSignalAbort, { once: true });

    try {
      xhr.open('POST', `${API_BASE}/api/rekordbox/import/bundle`);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.send(formData);
    } catch (error) {
      rejectOnce(error);
    }
  });
}
