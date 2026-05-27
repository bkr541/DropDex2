export interface ImportResult {
  import_id: string;
  status: string;
  source_filename: string;
  track_count: number;
  playlist_count: number;
  playlist_track_count: number;
  playlists: Array<{ name: string; track_count: number }>;
}

const API_BASE = (import.meta.env.VITE_IMPORT_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export async function uploadRekordboxDb(
  file: File,
  accessToken: string,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/api/rekordbox/import`, {
    method: 'POST',
    headers: {
      // Do NOT set Content-Type — the browser sets it with the correct multipart boundary.
      // Do NOT include any user_id — user identity is determined by the backend from this token.
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  // Parse response body once regardless of status
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = body?.detail ?? `Import failed (HTTP ${response.status})`;
    throw new Error(detail);
  }

  return body as ImportResult;
}
