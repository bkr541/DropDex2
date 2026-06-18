export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

const READ_MODE: { mode: FileSystemPermissionMode } = { mode: 'read' };

export async function queryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  return handle.queryPermission(READ_MODE);
}

export async function requestPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  return handle.requestPermission(READ_MODE);
}

/**
 * Returns the current permission state. If it is 'prompt', requests it.
 *
 * IMPORTANT: must be called from a user-gesture handler (click, keydown)
 * to satisfy browser security requirements for requestPermission.
 */
export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const current = await queryPermission(handle);
  if (current !== 'prompt') return current;
  return requestPermission(handle);
}
