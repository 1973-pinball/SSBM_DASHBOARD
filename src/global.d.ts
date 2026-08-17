/**
 * Short commit the running bundle was built from, inlined at build time (see
 * `define` in vite.config.ts). Shown in the footer so "am I on the latest
 * build?" is answerable at a glance instead of by comparing asset hashes —
 * which matters because the service worker can keep serving a previous shell.
 * "dev" in a local dev server.
 */
declare const __BUILD_ID__: string;

// Minimal File System Access API surface used by the app (Chromium).
interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

type WellKnownDirectory = "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: WellKnownDirectory;
  }): Promise<FileSystemDirectoryHandle>;
}
