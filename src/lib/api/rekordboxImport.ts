// ── Response types ────────────────────────────────────────────────────────────

export type ImportJobState =
  | 'created' | 'uploading' | 'queued' | 'processing'
  | 'cancel_requested' | 'cancelled' | 'completed' | 'failed';

export interface ImportJob {
  import_id: string;
  status: ImportJobState;
  source_filename: string;
  source_bundle_type: string | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
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

  constructor(message: string, structured: ImportWriteError | null = null) {
    super(message);
    this.name = 'RekordboxImportError';
    this.structured = structured;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_IMPORT_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const bodyObj = body as Record<string, unknown> | null;
    const rawDetail = bodyObj?.['detail'];
    // Structured error: detail is an object with error_code
    if (rawDetail && typeof rawDetail === 'object' && 'error_code' in (rawDetail as object)) {
      const structured = rawDetail as ImportWriteError;
      throw new RekordboxImportError(structured.detail, structured);
    }
    // Legacy flat error: detail is a string
    const message = typeof rawDetail === 'string' ? rawDetail : `HTTP ${response.status}`;
    throw new RekordboxImportError(message, null);
  }
  return body as T;
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
  return parseResponse<ImportJob>(response);
}

export async function cancelRekordboxImport(
  importId: string, accessToken: string, signal?: AbortSignal,
): Promise<ImportJob> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/cancel`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse<ImportJob>(response);
}

export async function fetchRekordboxImportJob(
  importId: string, accessToken: string, signal?: AbortSignal,
): Promise<ImportJob> {
  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/job-status`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  );
  return parseResponse<ImportJob>(response);
}

/** Legacy: upload exportLibrary.db and import metadata only (no analysis). */
export async function uploadRekordboxDb(
  file: File,
  accessToken: string,
  options?: { deviceName?: string; signal?: AbortSignal; importId?: string },
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (options?.deviceName) formData.append('device_name', options.deviceName);
  if (options?.importId) formData.append('import_id', options.importId);

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
  return parseResponse<ImportResult>(response);
}

/** Stage 1 of USB folder import: upload exportLibrary.db and receive the ANLZ manifest. */
export async function startRekordboxImport(
  file: File,
  accessToken: string,
  signal?: AbortSignal,
  deviceName?: string,
  importId?: string,
): Promise<ImportStartResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (deviceName) formData.append('device_name', deviceName);
  if (importId) formData.append('import_id', importId);

  const response = await fetch(`${API_BASE}/api/rekordbox/import/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
    signal,
  });
  return parseResponse<ImportStartResponse>(response);
}

/** Stage 2: upload a batch of ANLZ analysis files for an existing import. */
export async function uploadRekordboxAnalysisBatch(
  importId: string,
  files: AnalysisFileUpload[],
  accessToken: string,
  signal?: AbortSignal,
): Promise<BatchUploadResponse> {
  const formData = new FormData();
  for (const item of files) {
    // Use the full canonical path (e.g. PIONEER/USBANLZ/P001/ANLZ0000.DAT) as
    // the multipart filename so the backend can validate and store it correctly.
    formData.append('files', item.file, item.canonicalPath);
  }

  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/analysis-batch`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      signal,
    },
  );
  return parseResponse<BatchUploadResponse>(response);
}

/** Stage 3: trigger server-side ANLZ parsing and get per-track results. */
export async function completeRekordboxImport(
  importId: string,
  accessToken: string,
  options?: { affectedTrackIds?: string[]; signal?: AbortSignal },
): Promise<CompleteResponse> {
  const body =
    options?.affectedTrackIds && options.affectedTrackIds.length > 0
      ? JSON.stringify({ affected_track_ids: options.affectedTrackIds })
      : undefined;

  const response = await fetch(
    `${API_BASE}/api/rekordbox/import/${encodeURIComponent(importId)}/complete`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      signal: options?.signal,
    },
  );
  return parseResponse<CompleteResponse>(response);
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
  return parseResponse<AnalysisStatusResponse>(response);
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
  return new Promise<CompleteResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    if (importId) formData.append('import_id', importId);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ignore parse failure
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as CompleteResponse);
      } else {
        const rawDetail = (body as { detail?: string | ImportWriteError } | null)?.detail;
        if (rawDetail && typeof rawDetail === 'object') {
          reject(new RekordboxImportError(rawDetail.detail, rawDetail));
        } else {
          reject(new RekordboxImportError(typeof rawDetail === 'string' ? rawDetail : `HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during bundle upload')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.open('POST', `${API_BASE}/api/rekordbox/import/bundle`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.send(formData);
  });
}
