/**
 * IndexedDB wrapper for persisting a FileSystemDirectoryHandle across sessions.
 *
 * Privacy contract: stores only the FileSystemDirectoryHandle and connection
 * metadata. No audio Blobs, ArrayBuffers, Base64, or track file data are ever
 * written here.
 */

const DB_NAME = 'dropdex-usb-v1';
const DB_VERSION = 1;
const STORE_NAME = 'usb-handles';
const PRIMARY_KEY = 'primary';

export interface UsbConnectionMetadata {
  volumeName: string;
  connectedAt: string; // ISO 8601
}

interface StoredEntry {
  handle: FileSystemDirectoryHandle;
  metadata: UsbConnectionMetadata;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredUsbHandle(): Promise<{
  handle: FileSystemDirectoryHandle;
  metadata: UsbConnectionMetadata;
} | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const result = await idbRequest<StoredEntry | undefined>(tx.objectStore(STORE_NAME).get(PRIMARY_KEY));
  db.close();
  return result ?? null;
}

export async function saveUsbHandle(
  handle: FileSystemDirectoryHandle,
  metadata: UsbConnectionMetadata,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const entry: StoredEntry = { handle, metadata };
  await idbRequest(tx.objectStore(STORE_NAME).put(entry, PRIMARY_KEY));
  db.close();
}

export async function removeUsbHandle(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await idbRequest(tx.objectStore(STORE_NAME).delete(PRIMARY_KEY));
  db.close();
}

export async function getUsbConnectionMetadata(): Promise<UsbConnectionMetadata | null> {
  const stored = await getStoredUsbHandle();
  return stored?.metadata ?? null;
}
