import type { RekordboxTrack } from '../../types';

export function metadataValue(value: unknown): string {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function metadataLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function importMetadataFields(tracks: readonly RekordboxTrack[]) {
  const fields = new Map<string, string>();
  for (const track of tracks) {
    for (const name of Object.keys(track)) {
      if (name !== 'source_metadata') fields.set(`track:${name}`, metadataLabel(name));
    }
    for (const name of Object.keys(track.source_metadata ?? {})) fields.set(`source:${name}`, `Source: ${name}`);
  }
  return [...fields].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function importMetadataValue(track: RekordboxTrack, field: string): unknown {
  if (field.startsWith('source:')) return track.source_metadata?.[field.slice(7)];
  return (track as unknown as Record<string, unknown>)[field.slice(6)];
}
