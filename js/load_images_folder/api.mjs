// Load Images from Folder Pixaroma — backend fetch helpers + client-side local
// file access (File System Access API for picking folders on the user's LOCAL
// machine, not the ComfyUI host).

// ── Server-side helpers (existing) ──────────────────────────────────────────

// List image files in a folder. Returns {ok, folder, files:[{file,name,size,mtime}], message?}.
export async function listFolder(folder, recursive) {
  try {
    const url =
      `/pixaroma/api/load_images_folder/list?path=${encodeURIComponent(folder)}` +
      `&recursive=${recursive ? 1 : 0}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e), files: [] };
  }
}

// Thumbnail URL for one image (served by the backend, scaled to <=192px).
// mtime is folded in as a cache key so an edited file refreshes.
export function thumbURL(folder, rel, mtime) {
  return (
    `/pixaroma/api/load_images_folder/thumb?path=${encodeURIComponent(folder)}` +
    `&file=${encodeURIComponent(rel)}&mt=${Math.floor(mtime || 0)}`
  );
}

// Browse the server filesystem for the in-app folder picker (fallback).
// Returns {ok, path, parent, dirs:[{name, path, images}], message?}.
export async function browseFolder(path) {
  try {
    const url = `/pixaroma/api/load_images_folder/browse?path=${encodeURIComponent(path || "")}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e), dirs: [] };
  }
}

// Pop the native OS folder dialog on the ComfyUI host. Returns {ok:true, path},
// {ok:false, cancelled} (user closed it), or {ok:false, unavailable} (non-Windows
// / remote) so the caller can fall back to the in-app browser.
export async function pickNativeFolder(startPath) {
  try {
    const url = `/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(startPath || "")}`;
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ── Client-side local folder (File System Access API) ───────────────────────
// These use `window.showDirectoryPicker()` to browse the USER'S local machine,
// not the ComfyUI host. Falls back to server-side browsing when unavailable
// (Firefox, Safari, older Chromium).

const LOCAL_IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif",
]);

function isImageFile(name) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return LOCAL_IMAGE_EXTS.has(name.slice(dot).toLowerCase());
}

/** Check if the browser supports the File System Access API for local folder picking. */
export function canUseLocalPicker() {
  return "showDirectoryPicker" in window;
}

/**
 * Open the native OS folder picker on the user's LOCAL machine.
 * Returns a FileSystemDirectoryHandle, or null if the user cancelled / the API
 * is unavailable.
 */
export async function pickLocalFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    return handle;
  } catch (e) {
    if (e.name === "AbortError" || e.name === "SecurityError") return null;
    console.warn("[LoadImagesFolder] showDirectoryPicker failed:", e);
    return null;
  }
}

/**
 * Recursively list image files inside a client-side directory handle.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {boolean} recursive
 * @param {string} [prefix=""] — relative path prefix for recursion
 * @returns {Promise<{file:string, name:string, size:number, mtime:number, handle:FileSystemFileHandle}[]>}
 */
export async function listLocalFolder(dirHandle, recursive, prefix = "") {
  const files = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === "file") {
      if (!isImageFile(name)) continue;
      const file = await entry.getFile();
      const rel = prefix ? `${prefix}/${name}` : name;
      files.push({
        file: rel,
        name,
        size: file.size,
        mtime: file.lastModified,
        handle: entry,
      });
    } else if (entry.kind === "directory" && recursive) {
      const sub = await listLocalFolder(entry, true, prefix ? `${prefix}/${name}` : name);
      files.push(...sub);
    }
  }
  return files;
}

/**
 * Read a local image file as a blob for client-side thumbnail display.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relPath — relative path to the file inside the folder
 * @returns {Promise<string|null>} — object URL or null
 */
export async function readLocalFileAsBlob(dirHandle, relPath) {
  try {
    const parts = relPath.split("/");
    let handle = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await handle.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch (e) {
    console.warn("[LoadImagesFolder] readLocalFileAsBlob failed:", relPath, e);
    return null;
  }
}

/**
 * Upload selected files from a local folder handle to the server.
 * Only the selected (relative-path) files are uploaded, one per multipart field.
 * Subdirectory separators in the path are replaced with '_' to produce flat
 * filenames (e.g. "subdir/photo.jpg" → "subdir_photo.jpg") so the server stores
 * them without needing nested directories.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string[]} selectedRelPaths — array of relative file paths
 * @param {string} [sessionId] — optional session ID to reuse a temp dir
 * @returns {Promise<{ok:boolean, folder?:string, session?:string, files?:Array, message?:string}>}
 */
export async function uploadLocalFiles(dirHandle, selectedRelPaths, sessionId) {
  try {
    const formData = new FormData();
    const nameMap = {}; // relPath → flatUploadName for remapping selected later
    let uploaded = 0;

    for (const relPath of selectedRelPaths) {
      try {
        const parts = relPath.split("/");
        let handle = dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          handle = await handle.getDirectoryHandle(parts[i]);
        }
        const fileHandle = await handle.getFileHandle(parts[parts.length - 1]);
        const file = await fileHandle.getFile();
        // Flatten subdirectory paths: "subdir/photo.jpg" → "subdir_photo.jpg"
        const flatName = relPath.replace(/\//g, "_");
        nameMap[relPath] = flatName;
        formData.append("file", file, flatName);
        uploaded++;
      } catch (e) {
        console.warn("[LoadImagesFolder] skipping unreadable file:", relPath, e);
      }
    }

    if (uploaded === 0) {
      return { ok: false, message: "No files could be read from the local folder." };
    }

    let url = "/pixaroma/api/load_images_folder/upload";
    if (sessionId) url += `?session=${encodeURIComponent(sessionId)}`;

    const r = await fetch(url, { method: "POST", body: formData });
    const result = await r.json();
    // Attach the name map so the caller can remap selected paths
    if (result.ok) result._nameMap = nameMap;
    return result;
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

/**
 * Clean up a temp upload directory on the server.
 * @param {string} sessionId — the session ID returned by uploadLocalFiles
 */
export async function cleanupUpload(sessionId) {
  try {
    await fetch(`/pixaroma/api/load_images_folder/cleanup?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
    });
  } catch { /* best-effort */ }
}
