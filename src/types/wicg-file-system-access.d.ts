// Type augmentation for WICG File System Access API
// Permission methods and directory picker are not in TypeScript's built-in DOM lib.

type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface ShowDirectoryPickerOptions {
  id?: string;
  mode?: FileSystemPermissionMode;
  startIn?:
    | FileSystemHandle
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos';
}

declare function showDirectoryPicker(
  options?: ShowDirectoryPickerOptions,
): Promise<FileSystemDirectoryHandle>;

interface Window {
  showDirectoryPicker?: typeof showDirectoryPicker;
}
