import { useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import {
  createXmlDownloadUrl, deleteRekordboxXml, fetchRekordboxXmlFiles, saveRekordboxXml, type RekordboxXmlRecord,
} from '../lib/queries/rekordboxXml';
import { friendlyXmlUploadError, type RekordboxXmlHeader } from '../lib/rekordboxXml/xmlHeader';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The signed-in user's saved Rekordbox XML files, with saving, downloading and removing. */
export function useRekordboxXmlFiles(userId: string | null, enabled: boolean) {
  const [files, setFiles] = useState<RekordboxXmlRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    fetchRekordboxXmlFiles()
      .then((rows) => { if (!cancelled) setFiles(rows); })
      .catch((error: unknown) => {
        logger.error('rekordbox.xml.load_failed', { message: errorText(error) });
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /** Returns null on success, or a plain-language problem. */
  const save = useCallback(async (file: File, header: RekordboxXmlHeader): Promise<string | null> => {
    if (!userId) return 'Sign in to save files to DropDex.';
    setSaving(true);
    logger.info('rekordbox.xml.save_started', { fileName: file.name, sizeBytes: file.size, trackCount: header.trackCount });
    try {
      const record = await saveRekordboxXml(userId, file, header);
      setFiles((current) => [record, ...current]);
      logger.info('rekordbox.xml.saved', { id: record.id, fileName: file.name, sizeBytes: file.size });
      return null;
    } catch (error) {
      const message = errorText(error);
      logger.error('rekordbox.xml.save_failed', { fileName: file.name, sizeBytes: file.size, message });
      return friendlyXmlUploadError(message);
    } finally {
      setSaving(false);
    }
  }, [userId]);

  const remove = useCallback(async (record: RekordboxXmlRecord): Promise<boolean> => {
    try {
      await deleteRekordboxXml(record);
      setFiles((current) => current.filter((item) => item.id !== record.id));
      logger.info('rekordbox.xml.removed', { id: record.id, fileName: record.fileName });
      return true;
    } catch (error) {
      logger.error('rekordbox.xml.remove_failed', { id: record.id, message: errorText(error) });
      return false;
    }
  }, []);

  /** A temporary link that downloads the file, or null if it could not be made. */
  const downloadUrl = useCallback(async (record: RekordboxXmlRecord): Promise<string | null> => {
    try {
      return await createXmlDownloadUrl(record);
    } catch (error) {
      logger.error('rekordbox.xml.download_failed', { id: record.id, message: errorText(error) });
      return null;
    }
  }, []);

  return { files, loading, loadFailed, saving, reload, save, remove, downloadUrl };
}
