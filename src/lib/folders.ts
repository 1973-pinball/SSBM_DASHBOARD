/** A stable namespace keeps equal relative filenames in separate roots distinct. */
export interface ReplayFolder {
  /** Empty only for the migrated single folder, preserving its cached file ids. */
  id: string;
  handle: FileSystemDirectoryHandle;
}

/** Re-picking a connected directory refreshes it instead of adding another root. */
export async function addReplayFolder(folders: readonly ReplayFolder[], handle: FileSystemDirectoryHandle) {
  for (const folder of folders) {
    try {
      if (await folder.handle.isSameEntry(handle)) return { folders: [...folders], folder };
    } catch {
      // A disconnected drive must not prevent connecting a different folder.
    }
  }
  const folder: ReplayFolder = { id: `folder-${crypto.randomUUID()}`, handle };
  return { folders: [...folders, folder], folder };
}

/** Start every permission request in the click's activation, before awaiting any. */
export async function accessibleReplayFolders(folders: readonly ReplayFolder[], request = false) {
  const results = await Promise.allSettled(folders.map(async (folder) =>
    request
      ? folder.handle.requestPermission({ mode: "read" })
      : folder.handle.queryPermission({ mode: "read" }),
  ));
  const granted: ReplayFolder[] = [];
  const unavailable: ReplayFolder[] = [];
  results.forEach((result, index) => {
    (result.status === "fulfilled" && result.value === "granted" ? granted : unavailable).push(folders[index]!);
  });
  return { granted, unavailable };
}
