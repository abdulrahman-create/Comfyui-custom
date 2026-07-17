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

// ── Client-side local folder (webkitdirectory input) ────────────────────────
// Uses a hidden `<input type="file" webkitdirectory>` to open the native folder
// picker on the USER'S local machine. Works in ALL modern browsers (Chrome,
// Edge, Firefox, Safari) and over HTTP (not just HTTPS), unlike the File System
// Access API (`showDirectoryPicker`). Falls back to server-side browsing when
// the browser doesn't support `webkitdirectory`.

const LOCAL_IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif",
]);

function isImageFile(name) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return LOCAL_IMAGE_EXTS.has(name.slice(dot).toLowerCase());
}

/**
 * Open the native folder picker on the user's LOCAL machine using a hidden
 * `<input type="file" webkitdirectory>`. Works in all modern browsers
 * (Chrome 31+, Edge 79+, Firefox 50+, Safari 11.1+) and over HTTP.
 *
 * Returns `{ folderName, files:[{file, name, size, mtime, fileObj}] }` on
 * success, or `null` if the user cancelled.
 */
export function pickLocalFolder() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;width:1px;height:1px;pointer-events:none";
    document.body.appendChild(input);

    // NO cancel detection — the `change` event is the ONLY reliable signal
    // across all browsers. Focus/blur events race with change and can cause
    // premature cancellation. The caller (Browse handler) uses a timeout
    // as a safety net instead.
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (input.parentNode) document.body.removeChild(input);
    };

    input.addEventListener("change", () => {
      if (done) { console.log("[LoadImagesFolder change] already done"); return; }
      cleanup();
      const rawFiles = Array.from(input.files || []);
      console.log("[LoadImagesFolder change]", rawFiles.length, "files in input");
      if (!rawFiles.length) {
        resolve(null);
        return;
      }

      // Derive the top-level folder name from the first file's webkitRelativePath
      const firstPath = rawFiles[0].webkitRelativePath || "";
      const folderName = firstPath.split("/")[0] || "Local Folder";

      // Filter to image files and build our standard file-info list
      const imageFiles = [];
      const seen = new Set();
      for (const f of rawFiles) {
        if (!isImageFile(f.name)) continue;
        const relPath = f.webkitRelativePath || f.name;
        if (seen.has(relPath)) continue;
        seen.add(relPath);
        imageFiles.push({
          file: relPath,
          name: f.name,
          size: f.size,
          mtime: f.lastModified,
          fileObj: f, // keep a reference to the File object
        });
      }
      resolve({ folderName, files: imageFiles });
    });

    // Trigger the native folder picker
    input.click();
  });
}

/**
 * Upload selected files (from a `webkitdirectory` pick) to the server.
 * Subdirectory separators are replaced with '_' for flat storage
 * (e.g. "subdir/photo.jpg" → "subdir_photo.jpg").
 *
 * @param {{file:string, fileObj:File}[]} selectedFiles — file info objects
 *        that each have a `fileObj` property (the native File reference).
 * @param {string} [sessionId] — optional session ID to reuse a temp dir
 * @returns {Promise<{ok, folder?, session?, files?, _nameMap?, message?}>}
 */
export async function uploadLocalFiles(selectedFiles, sessionId) {
  try {
    const formData = new FormData();
    const nameMap = {};
    let uploaded = 0;

    for (const info of selectedFiles) {
      const f = info.fileObj;
      if (!f) continue;
      // Flatten subdirectory paths
      const flatName = info.file.replace(/\//g, "_");
      nameMap[info.file] = flatName;
      formData.append("file", f, flatName);
      uploaded++;
    }

    if (uploaded === 0) {
      return { ok: false, message: "No files could be read from the local folder." };
    }

    let url = "/pixaroma/api/load_images_folder/upload";
    if (sessionId) url += `?session=${encodeURIComponent(sessionId)}`;

    const r = await fetch(url, { method: "POST", body: formData });
    const result = await r.json();
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
