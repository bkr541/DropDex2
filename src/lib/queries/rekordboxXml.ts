import { supabase } from '../supabase';
import type { RekordboxXmlHeader } from '../rekordboxXml/xmlHeader';

export const XML_BUCKET = 'rekordbox-xml';

export interface RekordboxXmlRecord {
  id: string;
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  trackCount: number | null;
  rekordboxVersion: string | null;
  sourceModifiedAt: string | null;
  createdAt: string;
}

interface XmlRow {
  id: string; file_name: string; storage_path: string; size_bytes: number | string; track_count: number | null;
  rekordbox_version: string | null; source_modified_at: string | null; created_at: string;
}

export function toXmlRecord(row: XmlRow): RekordboxXmlRecord {
  return {
    id: row.id, fileName: row.file_name, storagePath: row.storage_path, sizeBytes: Number(row.size_bytes), trackCount: row.track_count,
    rekordboxVersion: row.rekordbox_version, sourceModifiedAt: row.source_modified_at, createdAt: row.created_at,
  };
}

/** The user's saved Rekordbox XML files, newest first. */
export async function fetchRekordboxXmlFiles(): Promise<RekordboxXmlRecord[]> {
  const { data, error } = await supabase.from('rekordbox_xml_files').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as XmlRow[]).map(toXmlRecord);
}

/**
 * Saves a copy of the file to the user's private cloud folder and records it. Every save is a new copy, so the user can keep
 * several. If recording it fails, the uploaded copy is removed again so nothing is left behind.
 */
export async function saveRekordboxXml(userId: string, file: File, header: RekordboxXmlHeader): Promise<RekordboxXmlRecord> {
  const storagePath = `${userId}/${crypto.randomUUID()}.xml`;
  const upload = await supabase.storage.from(XML_BUCKET).upload(storagePath, file, { contentType: 'application/xml', upsert: false });
  if (upload.error) throw new Error(upload.error.message);

  const { data, error } = await supabase
    .from('rekordbox_xml_files')
    .insert({
      user_id: userId,
      file_name: file.name,
      storage_path: storagePath,
      size_bytes: file.size,
      track_count: header.trackCount,
      rekordbox_version: header.rekordboxVersion,
      source_modified_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    })
    .select('*')
    .single();
  if (error) {
    await supabase.storage.from(XML_BUCKET).remove([storagePath]);
    throw new Error(error.message);
  }
  return toXmlRecord(data as XmlRow);
}

/** Deletes a saved file and its record. The file goes first, so a failure never leaves a record pointing at nothing. */
export async function deleteRekordboxXml(record: RekordboxXmlRecord): Promise<void> {
  const removed = await supabase.storage.from(XML_BUCKET).remove([record.storagePath]);
  if (removed.error) throw new Error(removed.error.message);
  const { error } = await supabase.from('rekordbox_xml_files').delete().eq('id', record.id);
  if (error) throw new Error(error.message);
}

/** A temporary link (five minutes) that downloads the file under its original name. */
export async function createXmlDownloadUrl(record: RekordboxXmlRecord): Promise<string> {
  const { data, error } = await supabase.storage.from(XML_BUCKET).createSignedUrl(record.storagePath, 300, { download: record.fileName });
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'The download link could not be created.');
  return data.signedUrl;
}

/** Reads a private saved XML snapshot without needing the source USB or local audio files. */
export async function readRekordboxXml(record: RekordboxXmlRecord): Promise<string> {
  const { data, error } = await supabase.storage.from(XML_BUCKET).download(record.storagePath);
  if (error || !data) throw new Error('The saved XML file could not be read. Check your connection and try again.');
  return data.text();
}
