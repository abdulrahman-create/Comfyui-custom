# Image Crop Pixaroma — Bug Fix + On-Node Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Image Crop Pixaroma's editor opening empty for non-LoadImage upstreams (VAE Decode etc.), and add a compact on-node panel for W/H/X/Y/Ratio/Center without opening the editor.

**Architecture:** Python node saves input tensor to `temp/` on each execution and emits a `pixaroma_crop_source` UI key; JS subscribes to the `executed` event and caches the URL on `node._pixaromaCropSourceURL` + `node.properties.pixaromaCropSourceURL`, prefers it in `getUpstreamImageURL`, and invalidates on wire change. A new `js/crop/panel.mjs` module provides a custom DOM widget that reads/writes the existing `cropJson` so it stays in sync with the editor.

**Tech Stack:** Python (PIL, torch, numpy), JavaScript (vanilla, ComfyUI extension API), no new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-06-image-crop-upgrade-design.md](../specs/2026-05-06-image-crop-upgrade-design.md)

**Working directory:** All file paths are relative to `D:\ComfyTest\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-Pixaroma\` — the main project dir on the `Ioan` branch (NOT a worktree). ComfyUI auto-loads from this dir.

**Testing model:** Project has no automated test suite (per CLAUDE.md). Each task uses manual verification: edit → restart ComfyUI / hard-refresh browser → run the verification scenario → commit.

**Commit policy:** One local commit per task on `Ioan` (no push). Use exact commit messages shown.

---

### File Structure

| File | Action | Responsibility |
|---|---|---|
| `nodes/node_crop.py` | Modify | Save input tensor to `temp/` and emit URL via `ui.pixaroma_crop_source` on execute. |
| `js/crop/index.js` | Modify | Subscribe to `executed`; cache URL; update `getUpstreamImageURL` priority; mount the new panel; sync editor save → panel refresh; track last-loaded image dims. |
| `js/crop/core.mjs` | Modify | Add one help-text hint line for the empty-canvas state. |
| `js/crop/panel.mjs` | **Create** | Compact DOM widget — W/H/Ratio/Center/(X,Y) controls. Source of truth = `cropJson`. ~200 lines. |

---

### Task 1: Python — emit upstream URL on execute

**Files:**
- Modify: `nodes/node_crop.py`

- [ ] **Step 1: Replace `nodes/node_crop.py` with the updated module**

```python
import os
import uuid
import torch
import numpy as np
from PIL import Image
import json
import folder_paths
from .node_ref import any_type, FlexibleOptionalInputType


class PixaromaCrop:
    @classmethod
    def INPUT_TYPES(self):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    FUNCTION = "load_crop"
    CATEGORY = "👑 Pixaroma"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Force re-execution when crop metadata changes.

        Upstream IMAGE changes are already detected by ComfyUI's input-hash
        mechanism, so we only need to bust the cache on rect edits. For the
        disk-composite fallback path, we additionally key on the file mtime.
        """
        crop_data = kwargs.get("CropWidget")
        if not crop_data:
            return ""
        try:
            crop_json = crop_data.get("crop_json", "{}") if isinstance(crop_data, dict) else str(crop_data)
            meta = json.loads(crop_json)
            rect_key = f"{meta.get('crop_x','')}-{meta.get('crop_y','')}-{meta.get('crop_w','')}-{meta.get('crop_h','')}"

            # If upstream is wired, the rect alone determines our output (the
            # upstream tensor is hashed by ComfyUI itself).
            if kwargs.get("image") is not None:
                return rect_key

            composite_path = meta.get("composite_path", "")
            if composite_path:
                input_dir = folder_paths.get_input_directory()
                full_path = os.path.join(input_dir, composite_path)
                if os.path.exists(full_path):
                    return f"{os.path.getmtime(full_path)}:{rect_key}"
        except Exception:
            pass
        return str(crop_data)

    def _save_source_temp(self, tensor):
        """Save the *input* tensor (full uncropped, batch slot 0) to ComfyUI's
        temp/ as a UUID-named PNG so the JS editor + mini-preview can fetch
        it via /view?type=temp. Best-effort — returns the filename or None
        on any failure (never raise; the workflow must keep running)."""
        try:
            if not isinstance(tensor, torch.Tensor) or tensor.dim() != 4 or tensor.shape[0] == 0:
                return None
            arr = tensor[0].clamp(0.0, 1.0).cpu().numpy()
            arr = (arr * 255.0 + 0.5).astype(np.uint8)
            img = Image.fromarray(arr)
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            fname = f"pixaroma_crop_src_{uuid.uuid4().hex}.png"
            img.save(os.path.join(temp_dir, fname), "PNG")
            return fname
        except Exception as e:
            print(f"[PixaromaCrop] temp source save failed: {e}")
            return None

    def load_crop(self, **kwargs):
        empty_image = torch.ones((1, 1024, 1024, 3), dtype=torch.float32)

        crop_data = kwargs.get("CropWidget")
        upstream = kwargs.get("image")

        # No widget AND no upstream → return empty
        if not crop_data and upstream is None:
            return (empty_image, 1024, 1024)

        # Parse crop metadata (may be empty if user just wired upstream and never opened editor)
        meta = {}
        if crop_data:
            crop_json = crop_data.get("crop_json", "{}") if isinstance(crop_data, dict) else str(crop_data)
            if crop_json and crop_json.strip() not in ("", "{}"):
                try:
                    parsed = json.loads(crop_json)
                    if isinstance(parsed, dict):
                        meta = parsed
                except Exception as e:
                    print(f"[PixaromaCrop] crop_json parse error: {e}")

        # Capture the *input* tensor URL for the JS editor + mini-preview.
        # Best-effort: failures don't block the crop.
        ui_payload = None
        if isinstance(upstream, torch.Tensor):
            src_fname = self._save_source_temp(upstream)
            if src_fname:
                ui_payload = {"pixaroma_crop_source": [
                    {"filename": src_fname, "subfolder": "", "type": "temp"}
                ]}

        # ── Apply the crop ────────────────────────────────────────────────────
        if isinstance(upstream, torch.Tensor):
            try:
                result = self._crop_tensor(upstream, meta)
            except Exception as e:
                print(f"[PixaromaCrop] upstream crop error: {e}")
                result = self._load_disk_composite(meta, empty_image)
        else:
            result = self._load_disk_composite(meta, empty_image)

        if ui_payload:
            return {"ui": ui_payload, "result": result}
        return result

    # ─────────────────────────────────────────────────────────────────────────

    def _crop_tensor(self, tensor, meta):
        """Crop an upstream IMAGE tensor [B,H,W,C] using the saved rect.

        Rect coords are scaled proportionally if upstream dims differ from the
        original_w/original_h captured at editor save time. If meta is empty
        (user wired upstream but never opened the editor), pass through unmodified.
        """
        if tensor.dim() != 4 or tensor.shape[0] == 0:
            # Unexpected shape -- pass through unmodified
            if tensor.dim() >= 3:
                return (tensor, int(tensor.shape[-2]), int(tensor.shape[-3]))
            return (tensor, 0, 0)

        b, h, w, c = tensor.shape

        # No saved rect → pass through (gives the user a sensible preview before
        # they open the editor for the first time).
        if not meta or meta.get("crop_w") in (None, 0):
            return (tensor, int(w), int(h))

        crop_x = float(meta.get("crop_x", 0))
        crop_y = float(meta.get("crop_y", 0))
        crop_w = float(meta.get("crop_w", w))
        crop_h = float(meta.get("crop_h", h))
        orig_w = float(meta.get("original_w", w))
        orig_h = float(meta.get("original_h", h))

        # Scale rect proportionally if upstream dims changed since save
        if orig_w > 0 and orig_h > 0 and (orig_w != w or orig_h != h):
            sx = w / orig_w
            sy = h / orig_h
            crop_x *= sx
            crop_y *= sy
            crop_w *= sx
            crop_h *= sy

        x0 = max(0, int(round(crop_x)))
        y0 = max(0, int(round(crop_y)))
        x1 = min(w, int(round(crop_x + crop_w)))
        y1 = min(h, int(round(crop_y + crop_h)))

        if x1 <= x0 or y1 <= y0:
            print(f"[PixaromaCrop] degenerate rect ({x0},{y0},{x1},{y1}) for {w}x{h} — passing through")
            return (tensor, int(w), int(h))

        cropped = tensor[:, y0:y1, x0:x1, :].contiguous()
        return (cropped, int(x1 - x0), int(y1 - y0))

    def _load_disk_composite(self, meta, empty_image):
        """Original behavior: load the editor-saved cropped PNG from input/pixaroma/."""
        doc_w = int(meta.get("doc_w", 1024))
        doc_h = int(meta.get("doc_h", 1024))

        composite_path = meta.get("composite_path", "")
        if not composite_path:
            arr = np.ones((doc_h, doc_w, 3), dtype=np.float32)
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)

        input_dir = os.path.realpath(folder_paths.get_input_directory())
        full_path = os.path.realpath(os.path.join(input_dir, composite_path))

        if not full_path.startswith(input_dir + os.sep):
            print("[PixaromaCrop] Security: composite_path escapes input directory, blocked.")
            return (empty_image, doc_w, doc_h)

        if not os.path.exists(full_path):
            return (empty_image, doc_w, doc_h)

        try:
            img = Image.open(full_path).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (torch.from_numpy(arr)[None,], doc_w, doc_h)
        except Exception as e:
            print(f"[PixaromaCrop] Load error: {e}")
            return (empty_image, 1024, 1024)


NODE_CLASS_MAPPINGS = {
    "PixaromaCrop": PixaromaCrop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaCrop": "Image Crop Pixaroma",
}
```

- [ ] **Step 2: Restart ComfyUI to pick up the Python change**

Stop ComfyUI (Ctrl+C in its console), then start it again. Wait for "Starting server" line.

- [ ] **Step 3: Verify via browser console**

In ComfyUI:
1. Build a workflow: `Load Image` → `Image Crop Pixaroma` → `Preview Image`
2. Open browser DevTools → Console tab.
3. Paste this snippet to log every `executed` event payload from our node:
   ```js
   const api = (await import("/scripts/api.js")).api;
   api.addEventListener("executed", (e) => {
     const o = e?.detail?.output;
     if (o?.pixaroma_crop_source) console.log("CROP SRC:", o.pixaroma_crop_source);
   });
   ```
4. Run the workflow (Queue Prompt).

Expected console output: `CROP SRC: [{filename: "pixaroma_crop_src_<hex>.png", subfolder: "", type: "temp"}]`.

Also check on disk:
```bash
ls "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/temp/" | grep pixaroma_crop_src | head -3
```
Expected: at least one `pixaroma_crop_src_*.png` file.

- [ ] **Step 4: Commit**

```bash
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" add nodes/node_crop.py
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" commit -m "fix(crop): emit input tensor URL via pixaroma_crop_source UI key

Save the upstream tensor to ComfyUI temp/ on every execute and return
its filename via the ui dict so the JS editor and mini-preview can
fetch it for any IMAGE source (VAE Decode etc.), not only LoadImage."
```

---

### Task 2: JS — capture URL via `executed` event, prefer cached URL

**Files:**
- Modify: `js/crop/index.js`

- [ ] **Step 1: Add cached-URL preference to `getUpstreamImageURL`**

Open `js/crop/index.js`. Locate the `getUpstreamImageURL(node)` function near the top (around line 23). Replace it with:

```js
function getUpstreamImageURL(node) {
  // Priority 1: cached source URL emitted by the Python node on its last
  // execute. Works for any upstream type (VAE Decode etc.), not just LoadImage.
  if (node._pixaromaCropSourceURL) return node._pixaromaCropSourceURL;

  const inputs = node.inputs || [];
  const input = inputs.find((inp) => inp.name === "image");
  if (!input || input.link == null) return null;
  const graph = node.graph;
  if (!graph) return null;

  // Vue Compat #3: graph.links can be a Map in newer ComfyUI versions.
  let link = graph.links?.[input.link];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(input.link);
  if (!link) return null;
  const srcNode = graph.getNodeById(link.origin_id);
  if (!srcNode) return null;

  // LoadImage: read filename from its "image" widget.
  if (srcNode.comfyClass === "LoadImage" || srcNode.type === "LoadImage") {
    const imgWidget = (srcNode.widgets || []).find((w) => w.name === "image");
    if (imgWidget && imgWidget.value) {
      return `/view?filename=${encodeURIComponent(imgWidget.value)}&type=input&t=${Date.now()}`;
    }
  }

  // Any node with cached preview images post-execution.
  if (srcNode.imgs && srcNode.imgs.length > 0) {
    const img = srcNode.imgs[link.origin_slot] || srcNode.imgs[0];
    if (typeof img === "string") return img;
    if (img && img.src) return img.src;
  }

  return null;
}
```

- [ ] **Step 2: Update `getUpstreamSnapshot` to include the cached URL**

In the same file, find `getUpstreamSnapshot(node)` (around line 61). Replace it with:

```js
function getUpstreamSnapshot(node) {
  // The cached source URL is part of the identity — when it arrives or
  // changes (new execute), we should rebuild the mini-preview.
  if (node._pixaromaCropSourceURL) return `cropSrc:${node._pixaromaCropSourceURL}`;

  const inputs = node.inputs || [];
  const input = inputs.find((inp) => inp.name === "image");
  if (!input || input.link == null) return "";
  const graph = node.graph;
  if (!graph) return "";
  let link = graph.links?.[input.link];
  if (!link && typeof graph.links?.get === "function") link = graph.links.get(input.link);
  if (!link) return "";
  const srcNode = graph.getNodeById(link.origin_id);
  if (!srcNode) return "";

  // LoadImage: stable identity = the filename widget value.
  if (srcNode.comfyClass === "LoadImage" || srcNode.type === "LoadImage") {
    const w = (srcNode.widgets || []).find((x) => x.name === "image");
    if (w && w.value) return `LoadImage:${w.value}`;
  }
  // Any node with cached preview images post-execution.
  if (srcNode.imgs && srcNode.imgs.length > 0) {
    const img = srcNode.imgs[link.origin_slot] || srcNode.imgs[0];
    const s = typeof img === "string" ? img : img?.src || "";
    if (s) return `imgs:${s}`;
  }
  return `link:${link.origin_id}/${link.origin_slot}`;
}
```

- [ ] **Step 3: Restore cached URL from `node.properties` in `onConfigure`**

In the same file, find the `nodeType.prototype.onConfigure = function (data) { ... }` block inside `beforeRegisterNodeDef`. Replace it with:

```js
    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const ret = originalOnConfigure?.apply(this, arguments);
      this.imgs = null; // prevent native preview flash on restore

      // Restore cached source URL from saved properties (Vue Compat #11).
      // node.properties is populated by LiteGraph deserialize before this fires.
      if (this.properties?.pixaromaCropSourceURL && !this._pixaromaCropSourceURL) {
        this._pixaromaCropSourceURL = this.properties.pixaromaCropSourceURL;
      }

      if (this._pixaromaCropRefresh) {
        queueMicrotask(() => this._pixaromaCropRefresh());
        setTimeout(() => this._pixaromaCropRefresh?.(), 250);
      }
      return ret;
    };
```

- [ ] **Step 4: Add `executed` event listener inside `nodeCreated`**

Locate the existing `api.addEventListener("execution_start", onStart);` line near the bottom of `nodeCreated`. INSERT the following block immediately above it (i.e. before the `let executionRunning = false;` line — keep the existing `onStart`/`onExecuting` block intact below):

```js
    // ── Cache source URL emitted by Python on each execute ──
    // Works for any IMAGE upstream (VAE Decode etc.) — without this, only
    // LoadImage chains can resolve a usable preview URL.
    const onExec = (event) => {
      const detail = event?.detail;
      if (!detail?.output) return;
      // Cross-version node-id resolution (Vue passes string, legacy passes number).
      const matched = app.graph.getNodeById(detail.node)
                  || app.graph.getNodeById(parseInt(detail.node, 10));
      if (matched !== node) return;
      const frames = detail.output.pixaroma_crop_source;
      if (!frames?.length) return;
      const f = frames[0];
      const url = `/view?filename=${encodeURIComponent(f.filename)}` +
                  `&subfolder=${encodeURIComponent(f.subfolder || "")}` +
                  `&type=${encodeURIComponent(f.type || "temp")}` +
                  `&t=${Date.now()}`;
      node._pixaromaCropSourceURL = url;
      if (!node.properties) node.properties = {};
      node.properties.pixaromaCropSourceURL = url;
      rebuildPreviewFromUpstream();
    };
    api.addEventListener("executed", onExec);
```

- [ ] **Step 5: Invalidate cached URL when wire changes**

Locate the existing `node.onConnectionsChange = (type, slotIndex, connected) => { ... }` block. Replace it with:

```js
    node.onConnectionsChange = (type, slotIndex, connected) => {
      if (type !== LiteGraph.INPUT) return;
      const inputName = node.inputs?.[slotIndex]?.name;
      if (inputName !== "image") return;
      // Wire changed → cached URL is stale.
      node._pixaromaCropSourceURL = null;
      if (node.properties) delete node.properties.pixaromaCropSourceURL;
      if (connected) {
        rebuildPreviewFromUpstream();
      }
    };
```

- [ ] **Step 6: Detach the new listener in `onRemoved`**

Locate the existing `node.onRemoved = () => { ... }` block. Replace with:

```js
    const origRemoved = node.onRemoved;
    node.onRemoved = () => {
      origRemoved?.call(node);
      clearInterval(pollInterval);
      try { api.removeEventListener("execution_start", onStart); } catch {}
      try { api.removeEventListener("executing", onExecuting); } catch {}
      try { api.removeEventListener("executed", onExec); } catch {}
    };
```

- [ ] **Step 7: Hard-reload the browser to pick up JS changes**

In the ComfyUI tab, press Ctrl+F5 (Windows) to bypass module cache.

- [ ] **Step 8: Verify — VAE Decode chain post-execution**

1. Build/load a workflow with: `Load Checkpoint → KSampler → VAE Decode → Image Crop Pixaroma → Preview Image`. (Any image-generating chain works.)
2. Run the workflow once (Queue Prompt). Wait for it to finish.
3. The Image Crop node body should show the generated image as the mini-preview within ~1 sec of completion.
4. Click **Open Crop**. The editor should open with the **full generated image** visible (not empty). Make a crop selection, click **Save**, run workflow → output is correctly cropped.

- [ ] **Step 9: Verify — cache invalidation on wire reconnect**

1. Disconnect the IMAGE wire from VAE Decode to Image Crop.
2. Wire a different IMAGE source (or another VAE Decode chain).
3. Run workflow. Mini-preview should update to the new source within ~1 sec, NOT show the old cached image.

- [ ] **Step 10: Verify — workflow tab switch persistence**

1. With a successfully-executed workflow open, save it as an API JSON or just leave it.
2. Open a second ComfyUI tab and create a different workflow.
3. Switch back to the first tab. Image Crop should still show the cached mini-preview (not blank). Click Open Crop → editor opens with the image (URL was restored from `node.properties`).

- [ ] **Step 11: Commit**

```bash
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" add js/crop/index.js
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" commit -m "fix(crop): cache pixaroma_crop_source URL on executed event

Subscribe to ComfyUI's executed event, pull the URL emitted by the
Python node, cache it on node._pixaromaCropSourceURL plus
node.properties for tab-switch persistence, and prefer it in the
upstream-URL resolver. Invalidate on wire reconnect."
```

---

### Task 3: JS — empty-state hint in editor

**Files:**
- Modify: `js/crop/core.mjs`

- [ ] **Step 1: Add a help-text hint and status-bar message for the no-source case**

Open `js/crop/core.mjs`. Locate the `_buildUI` method (around line 176). Find the `helpContent` template literal inside the `createEditorLayout({...})` call. Replace ONLY the `helpContent: ...` property with:

```js
      helpContent: `
                ${this._fromUpstream ? "" : "<b>Tip:</b> If you wired an upstream node (e.g. VAE Decode), run the workflow once to capture the source image.<br>"}<b>Load image:</b> Wire an <i>IMAGE</i> input, or click <kbd>Load Image</kbd> in the sidebar<br>
                <b>Drag crop region:</b> Click & drag inside the crop area<br>
                <b>Resize crop:</b> Drag orange corner/edge handles<br>
                <b>Reset crop:</b> Press <kbd>R</kbd> or click Reset<br>
                <b>Swap ratio:</b> Press <kbd>X</kbd> to flip W↔H ratio<br>
                <b>Free ratio:</b> Press <kbd>F</kbd><br>
                <b>Save:</b> <kbd>Ctrl+S</kbd><br>
                <b>Close:</b> <kbd>Escape</kbd>
            `,
```

- [ ] **Step 2: Show a status-bar hint when the editor opens with no source**

In the same file, locate the `open(jsonStr, upstreamUrl)` method (around line 78). Find the existing `if (sourceURL) { this._loadImageFromURL(...); }` block. Add an `else` branch immediately after it, BEFORE `this._bindKeys();`:

The block currently looks like this:
```js
    if (sourceURL) {
      this._loadImageFromURL(sourceURL, () => {
        // ... long callback ...
      });
    }
    this._bindKeys();
```

Change to:
```js
    if (sourceURL) {
      this._loadImageFromURL(sourceURL, () => {
        // ... existing callback unchanged ...
      });
    } else {
      // No source available — guide the user to either wire+run an upstream
      // or use Load Image. Visible at the bottom of the editor immediately.
      this._setStatus(
        "No source loaded. Wire an IMAGE input and run the workflow once, " +
        "or click Load Image in the left sidebar."
      );
    }
    this._bindKeys();
```

(Do NOT modify the long callback — leave its content as-is.)

- [ ] **Step 3: Hard-reload the browser**

Ctrl+F5 in the ComfyUI tab.

- [ ] **Step 4: Verify — pre-execution VAE Decode chain shows the hint**

1. Open a fresh workflow with: `EmptyLatentImage → KSampler → VAE Decode → Image Crop Pixaroma`.
2. Without running the workflow, click **Open Crop** on the Image Crop node.
3. Expected: editor opens with empty canvas. Status bar at the bottom shows: "No source loaded. Wire an IMAGE input and run the workflow once, or click Load Image in the left sidebar."
4. Click the **?** help button. Expected: the popup shows "**Tip:** If you wired an upstream node (e.g. VAE Decode), run the workflow once to capture the source image." as the first line.

- [ ] **Step 5: Verify no regression — when source loads, no hint**

1. Run the workflow once. Image Crop should now show the image in the editor's canvas.
2. Close and reopen the editor (it should now have the source URL from Task 2).
3. Status bar should NOT show the no-source hint (it'll show the existing "Loaded: WxH" message instead).
4. Open the help popup. The "Tip:" line should be ABSENT now (because `_fromUpstream` is true).

- [ ] **Step 6: Commit**

```bash
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" add js/crop/core.mjs
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" commit -m "feat(crop): empty-state hint when editor opens without a source

Adds a status-bar message and conditional help-text line guiding the
user to either run the workflow once (for non-LoadImage upstreams)
or use the Load Image button."
```

---

### Task 4: JS — create the on-node panel module

**Files:**
- Create: `js/crop/panel.mjs`

- [ ] **Step 1: Create `js/crop/panel.mjs` with the full module**

Create the new file with this exact content:

```js
// ============================================================
// Pixaroma Image Crop — On-Node Panel
// ============================================================
// Compact custom DOM widget for the node body. Exposes W, H, Ratio,
// a one-shot Center button, and a collapsible X/Y row.
// Source of truth = cropJson (read in refresh(), written on every commit).
// ============================================================

import { BRAND } from "../shared/index.mjs";
import { RATIOS } from "./core.mjs";

const PANEL_CSS = `
.pix-cropp {
  background: #2a2a2a;
  border-radius: 4px;
  margin: 4px 8px;
  padding: 5px 6px;
  font-family: 'Segoe UI', sans-serif;
  font-size: 11px;
  color: #ddd;
  user-select: none;
  box-sizing: border-box;
}
.pix-cropp-row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
.pix-cropp-row:last-child { margin-bottom: 0; }
.pix-cropp-cell {
  flex: 1;
  background: #1f1f1f;
  border-radius: 3px;
  padding: 2px 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  box-sizing: border-box;
}
.pix-cropp-cell label {
  font-size: 9px;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  flex: 0 0 auto;
}
.pix-cropp-cell input[type=number] {
  flex: 1;
  background: transparent;
  color: #fff;
  border: 0;
  outline: 0;
  width: 100%;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 0;
  font-family: inherit;
  text-align: right;
  -moz-appearance: textfield;
}
.pix-cropp-cell input[type=number]::-webkit-outer-spin-button,
.pix-cropp-cell input[type=number]::-webkit-inner-spin-button {
  -webkit-appearance: none; margin: 0;
}
.pix-cropp-times {
  flex: 0 0 auto;
  color: #777;
  padding: 0 2px;
  font-size: 12px;
}
.pix-cropp-combo {
  background: #1f1f1f;
  color: #ddd;
  border: 0;
  outline: 0;
  padding: 3px 4px;
  border-radius: 3px;
  font-size: 11px;
  font-family: inherit;
  flex: 1;
  cursor: pointer;
  min-height: 22px;
}
.pix-cropp-btn {
  flex: 1;
  background: #3a2218;
  color: ${BRAND};
  border: 0;
  border-radius: 3px;
  padding: 4px 6px;
  font-size: 11px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  min-height: 22px;
}
.pix-cropp-btn:hover { background: #4a2a1c; }
.pix-cropp-toggle {
  text-align: center;
  color: #777;
  font-size: 10px;
  padding: 3px 0;
  cursor: pointer;
  border-top: 1px solid #222;
  margin-top: 4px;
  user-select: none;
}
.pix-cropp-toggle:hover { color: #aaa; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const style = document.createElement("style");
  style.id = "pix-crop-panel-css";
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

// Returns { el, refresh } where el is the container DOM element (mount it
// via node.addDOMWidget) and refresh() re-reads cropJson + image dims.
//
// Required callbacks:
//   getCropJson()    -> string   (the hidden CropWidget's crop_json value)
//   setCropJson(s)   -> void     (write back to the hidden widget + state)
//   getImageDims()   -> {w,h}|null  (last loaded mini-preview image dims)
//   onChange()       -> void     (after a commit; trigger preview rebuild)
//   getExpanded()    -> boolean  (X/Y row expanded state, persisted)
//   setExpanded(b)   -> void     (persist expanded state)
export function createCropPanel(callbacks) {
  injectCSS();
  const { getCropJson, setCropJson, getImageDims, onChange, getExpanded, setExpanded } = callbacks;

  const root = document.createElement("div");
  root.className = "pix-cropp";

  // ── Row 1: W × H ──
  const row1 = document.createElement("div");
  row1.className = "pix-cropp-row";

  const wInput = makeNumberInput("W");
  const times = document.createElement("div");
  times.className = "pix-cropp-times";
  times.textContent = "×";
  const hInput = makeNumberInput("H");

  row1.append(wInput.cell, times, hInput.cell);

  // ── Row 2: Ratio + Center ──
  const row2 = document.createElement("div");
  row2.className = "pix-cropp-row";

  const ratioSelect = document.createElement("select");
  ratioSelect.className = "pix-cropp-combo";
  for (let i = 0; i < RATIOS.length; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = RATIOS[i].label;
    ratioSelect.appendChild(opt);
  }

  const centerBtn = document.createElement("button");
  centerBtn.className = "pix-cropp-btn";
  centerBtn.type = "button";
  centerBtn.textContent = "⊕ Center";

  row2.append(ratioSelect, centerBtn);

  // ── Toggle row ──
  const toggle = document.createElement("div");
  toggle.className = "pix-cropp-toggle";

  // ── Row 4: X / Y (collapsible) ──
  const row4 = document.createElement("div");
  row4.className = "pix-cropp-row";

  const xInput = makeNumberInput("X", 0);
  const yInput = makeNumberInput("Y", 0);
  row4.append(xInput.cell, yInput.cell);

  root.append(row1, row2, toggle, row4);

  // ── State sync helpers ──

  // Read cropJson, return parsed meta object (always a plain object).
  function readMeta() {
    let meta = {};
    try { meta = JSON.parse(getCropJson() || "{}") || {}; } catch {}
    return typeof meta === "object" && meta ? meta : {};
  }

  // Commit a partial update to cropJson. Stamps original_w/h from current
  // image dims so Python's proportional-rescale logic stays correct.
  function commit(partial) {
    const meta = readMeta();
    const dims = getImageDims?.() || null;
    Object.assign(meta, partial);
    if (dims) {
      meta.original_w = dims.w;
      meta.original_h = dims.h;
    }
    setCropJson(JSON.stringify(meta));
    onChange?.();
  }

  // Validation/clamp on commit values.
  function clampW(w) {
    const dims = getImageDims?.() || null;
    let v = Math.max(1, Math.round(w || 1));
    if (dims) v = Math.min(v, dims.w);
    return v;
  }
  function clampH(h) {
    const dims = getImageDims?.() || null;
    let v = Math.max(1, Math.round(h || 1));
    if (dims) v = Math.min(v, dims.h);
    return v;
  }
  function clampX(x, w) {
    const dims = getImageDims?.() || null;
    let v = Math.max(0, Math.round(x || 0));
    if (dims) v = Math.min(v, Math.max(0, dims.w - w));
    return v;
  }
  function clampY(y, h) {
    const dims = getImageDims?.() || null;
    let v = Math.max(0, Math.round(y || 0));
    if (dims) v = Math.min(v, Math.max(0, dims.h - h));
    return v;
  }

  // Apply ratio lock to (w, h) given ratioIdx; returns adjusted {w, h}.
  // driven = "w" or "h" indicates which the user just edited.
  function applyRatio(w, h, ratioIdx, driven) {
    const r = RATIOS[ratioIdx];
    if (!r || r.w === 0) return { w, h };
    const ratio = r.w / r.h;
    if (driven === "w") {
      return { w, h: Math.round(w / ratio) };
    } else {
      return { w: Math.round(h * ratio), h };
    }
  }

  // ── Event handlers ──

  function onWHCommit(driven) {
    const meta = readMeta();
    let w = parseFloat(wInput.input.value);
    let h = parseFloat(hInput.input.value);
    const ratioIdx = parseInt(ratioSelect.value, 10) || 0;
    const adjusted = applyRatio(w, h, ratioIdx, driven);
    w = clampW(adjusted.w);
    h = clampH(adjusted.h);
    const x = clampX(meta.crop_x ?? 0, w);
    const y = clampY(meta.crop_y ?? 0, h);
    commit({ crop_w: w, crop_h: h, crop_x: x, crop_y: y, ratio_idx: ratioIdx });
    refresh(); // re-display the clamped values
  }

  function onXYCommit() {
    const meta = readMeta();
    const w = clampW(meta.crop_w ?? wInput.input.value);
    const h = clampH(meta.crop_h ?? hInput.input.value);
    const x = clampX(parseFloat(xInput.input.value), w);
    const y = clampY(parseFloat(yInput.input.value), h);
    commit({ crop_x: x, crop_y: y });
    refresh();
  }

  function onRatioCommit() {
    const ratioIdx = parseInt(ratioSelect.value, 10) || 0;
    const meta = readMeta();
    let w = clampW(meta.crop_w ?? parseFloat(wInput.input.value));
    let h = clampH(meta.crop_h ?? parseFloat(hInput.input.value));
    const adjusted = applyRatio(w, h, ratioIdx, "w");
    w = clampW(adjusted.w);
    h = clampH(adjusted.h);
    const x = clampX(meta.crop_x ?? 0, w);
    const y = clampY(meta.crop_y ?? 0, h);
    commit({ ratio_idx: ratioIdx, crop_w: w, crop_h: h, crop_x: x, crop_y: y });
    refresh();
  }

  function onCenterClick() {
    const dims = getImageDims?.() || null;
    if (!dims) return; // nothing to center against
    const meta = readMeta();
    const w = clampW(meta.crop_w ?? wInput.input.value);
    const h = clampH(meta.crop_h ?? hInput.input.value);
    const x = Math.max(0, Math.round((dims.w - w) / 2));
    const y = Math.max(0, Math.round((dims.h - h) / 2));
    commit({ crop_w: w, crop_h: h, crop_x: x, crop_y: y });
    refresh();
  }

  function onToggleClick() {
    const next = !(getExpanded?.() ?? false);
    setExpanded?.(next);
    refresh();
  }

  wInput.input.addEventListener("change", () => onWHCommit("w"));
  hInput.input.addEventListener("change", () => onWHCommit("h"));
  xInput.input.addEventListener("change", onXYCommit);
  yInput.input.addEventListener("change", onXYCommit);
  ratioSelect.addEventListener("change", onRatioCommit);
  centerBtn.addEventListener("click", onCenterClick);
  toggle.addEventListener("click", onToggleClick);

  // Block keyboard from bubbling to ComfyUI canvas (would otherwise pan/zoom).
  for (const el of [wInput.input, hInput.input, xInput.input, yInput.input, ratioSelect]) {
    el.addEventListener("keydown", (e) => e.stopPropagation());
  }

  // ── Refresh: read cropJson + image dims, populate inputs ──
  function refresh() {
    const meta = readMeta();
    const dims = getImageDims?.() || null;

    let w, h, x, y;
    if (meta.crop_w) {
      w = Math.round(meta.crop_w);
      h = Math.round(meta.crop_h);
      x = Math.round(meta.crop_x ?? 0);
      y = Math.round(meta.crop_y ?? 0);
    } else if (dims) {
      w = dims.w;
      h = dims.h;
      x = 0;
      y = 0;
    } else {
      w = 1024;
      h = 1024;
      x = 0;
      y = 0;
    }

    if (document.activeElement !== wInput.input) wInput.input.value = w;
    if (document.activeElement !== hInput.input) hInput.input.value = h;
    if (document.activeElement !== xInput.input) xInput.input.value = x;
    if (document.activeElement !== yInput.input) yInput.input.value = y;
    ratioSelect.value = String(meta.ratio_idx ?? 0);

    const expanded = getExpanded?.() ?? false;
    row4.style.display = expanded ? "flex" : "none";
    toggle.textContent = expanded ? "▾ position (X, Y)" : "▸ position (X, Y)";
  }

  return { el: root, refresh };
}

// Internal helper — builds a labelled cell with a number input.
function makeNumberInput(label, defaultVal) {
  const cell = document.createElement("div");
  cell.className = "pix-cropp-cell";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "1";
  if (defaultVal != null) input.value = String(defaultVal);
  cell.append(lbl, input);
  return { cell, input };
}
```

- [ ] **Step 2: Sanity-check the module loads (no immediate verify)**

The file is unused at this point — its real verification is in Task 5. But quickly verify the file is syntactically valid:

```bash
node --check "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma/js/crop/panel.mjs" 2>&1 | head -5
```

Expected: no output (silent success). If you see `SyntaxError`, fix and re-run.

- [ ] **Step 3: Commit**

```bash
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" add js/crop/panel.mjs
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" commit -m "feat(crop): add panel.mjs module for on-node W/H/X/Y controls

Standalone module exporting createCropPanel({ ... }) which builds a
compact DOM widget. Source of truth is cropJson read on refresh and
written on every commit, so editor and panel stay in sync. Includes
ratio lock matching the editor's _computeWH semantics, a one-shot
Center button, and a collapsible X/Y row. Not yet wired into the
node — that lands in the next task."
```

---

### Task 5: JS — mount the panel, wire callbacks, sync editor save

**Files:**
- Modify: `js/crop/index.js`

- [ ] **Step 1: Add panel import at the top of the file**

Open `js/crop/index.js`. Locate the existing import block:
```js
import { CropEditor } from "./core.mjs";
import "./interaction.mjs"; // mixin: mouse/keyboard events
import "./render.mjs"; // mixin: canvas rendering, ratio, save
```

Add a new line below them:
```js
import { createCropPanel } from "./panel.mjs";
```

- [ ] **Step 2: Track last-loaded image dims and refresh the panel inside `rebuildPreviewFromUpstream`**

In the same file, locate `const rebuildPreviewFromUpstream = () => { ... }` inside `nodeCreated`. Find the `img.onload = () => { ... }` handler. The existing first line of that handler is:
```js
        const w = img.naturalWidth, h = img.naturalHeight;
```

Replace that single line with:
```js
        const w = img.naturalWidth, h = img.naturalHeight;
        node._pixaromaLastImageDims = { w, h };
        panel?.refresh();  // panel reads dims for default-fill
```

The rest of the `img.onload` body stays unchanged. (The `panel` reference is captured by closure and resolved at call time — `img.onload` fires after `panel` is created in Step 3, so the lookup succeeds; the optional chaining handles any edge case where it isn't yet.)

- [ ] **Step 3: Insert the panel mount block between the Open button and the existing CropWidget**

In the existing code, the structure under `nodeCreated` looks like:
```js
    // ── Open button ──
    node.addWidget("button", "Open Crop", null, () => { /* editor open */ });

    // ── DOM widget ──
    const widget = node.addDOMWidget("CropWidget", "custom", parts.container, { /* ... */ });
```

We need two modifications:
1. **Change `const widget = ...` to `widget = ...`** (lifting the declaration up so the panel callback can reference it).
2. **Insert the panel mount block between Open button and CropWidget.**

After both modifications the structure should be:

```js
    // ── Open button ──
    node.addWidget("button", "Open Crop", null, () => { /* editor open — unchanged */ });

    // Forward declaration so panel callbacks can reference widget (assigned below).
    let widget;

    // ── On-node panel (W/H/Ratio/Center + collapsible X/Y) ──
    // Mounted BEFORE the CropWidget DOM widget so it renders ABOVE the
    // mini-preview in the node body.
    const panel = createCropPanel({
      getCropJson: () => cropJson,
      setCropJson: (s) => {
        cropJson = s;
        if (widget) widget.value = { crop_json: cropJson };
      },
      getImageDims: () => node._pixaromaLastImageDims || null,
      onChange: () => {
        rebuildPreviewFromUpstream();
        if (app.graph) app.graph.setDirtyCanvas(true, true);
      },
      getExpanded: () => !!node.properties?.pixaromaCropPanelExpanded,
      setExpanded: (b) => {
        if (!node.properties) node.properties = {};
        node.properties.pixaromaCropPanelExpanded = !!b;
      },
    });
    node.addDOMWidget("CropPanel", "custom", panel.el, {
      serialize: false,
      getMinHeight: () => 88, // 3 rows + toggle + padding
      margin: 0,
    });

    // ── DOM widget (mini-preview) — was `const widget = ...`, now `widget = ...` ──
    widget = node.addDOMWidget("CropWidget", "custom", parts.container, {
      getValue: () => ({ crop_json: cropJson }),
      setValue: (v) => {
        // ... existing setValue body, unchanged for now (panel.refresh added in Step 4)
      },
      getMinHeight: () => 210,
      margin: 5,
    });
```

Concrete edit instructions:
1. Find `const widget = node.addDOMWidget("CropWidget", ...);` and change `const widget` to just `widget`.
2. Add `let widget;` on a new line directly under the Open Crop `node.addWidget(...)` block.
3. Add the panel-mount block (the `const panel = createCropPanel({...}); node.addDOMWidget("CropPanel", ...)`) between `let widget;` and `widget = node.addDOMWidget("CropWidget", ...)`.

- [ ] **Step 4: Refresh the panel from `setValue` (workflow restore path)**

In the same file, find the `setValue: (v) => { ... }` callback inside the existing `addDOMWidget("CropWidget", ...)`. Add a `panel?.refresh();` call at the END of `setValue` (after the existing `if (willHaveUpstream) { ... } else { restoreNodePreview(...); }` block):

```js
      setValue: (v) => {
        if (!v || typeof v !== "object") return;
        cropJson = v.crop_json || "{}";
        // ... existing rebuild dispatch ...
        if (willHaveUpstream) {
          queueMicrotask(() => {
            if (getUpstreamImageURL(node)) {
              rebuildPreviewFromUpstream();
            } else {
              restoreNodePreview(parts, cropJson, node);
            }
          });
        } else {
          restoreNodePreview(parts, cropJson, node);
        }
        panel?.refresh();
      },
```

- [ ] **Step 5: Refresh the panel after editor save**

In the same file, find the `editor.onSave = (jsonStr, dataURL) => { ... }` block inside the Open Crop button's click handler. Add `panel?.refresh();` at the end of the callback:

```js
      editor.onSave = (jsonStr, dataURL) => {
        cropJson = jsonStr;
        widget.value = { crop_json: jsonStr };

        if (app.graph) {
          app.graph.setDirtyCanvas(true, true);
          if (typeof app.graph.change === "function") app.graph.change();
        }

        if (dataURL) {
          showNodePreview(parts, dataURL, null, node);
        }
        panel?.refresh();
      };
```

- [ ] **Step 6: Refresh the panel from `_pixaromaCropRefresh`**

In the same file, find `node._pixaromaCropRefresh = () => { ... }`. Add `panel?.refresh();` at the end:

```js
    node._pixaromaCropRefresh = () => {
      lastSnap = "";
      if (getUpstreamImageURL(node)) {
        rebuildPreviewFromUpstream();
      } else {
        restoreNodePreview(parts, cropJson, node);
      }
      panel?.refresh();
    };
```

- [ ] **Step 7: Initial panel refresh after mount**

Inside `nodeCreated`, AFTER the line `activateNodePreview(parts, node);` (around line 258 in the existing file), add:

```js
    // Initial panel populate from cropJson (or defaults).
    panel.refresh();
```

- [ ] **Step 8: Increase the node's default height to fit the panel**

Locate `node.size = [300, 300];` near the top of `nodeCreated`. Replace with:

```js
    node.size = [300, 380];  // taller default to fit the new panel
```

- [ ] **Step 9: Hard-reload browser**

Ctrl+F5 in the ComfyUI tab.

- [ ] **Step 10: Verify — panel renders and reads from cropJson**

1. Add a fresh Image Crop Pixaroma node to the canvas.
2. Expected layout (top to bottom): IMAGE input slot, 3 output slots, **Open Crop** button, **panel** (W × H row, Ratio + Center row, collapsed "▸ position (X, Y)"), mini-preview placeholder.
3. Default values: W = 1024, H = 1024, Ratio = Free.

- [ ] **Step 11: Verify — edits update mini-preview**

1. Wire `Load Image` (any image) → `Image Crop Pixaroma`. Mini-preview shows the image.
2. Read the displayed dims. Type `512` into W on the panel and press Enter (or Tab out).
3. Expected: mini-preview re-renders within ~200 ms showing a 512-wide crop centered around the previous center. H may also change if a non-Free ratio is locked.
4. Open the editor. The W slider should also show 512.

- [ ] **Step 12: Verify — Center button**

1. Manually drag a small crop into the top-left of the editor and save → returns to node.
2. On the panel, click **Center**. The crop should snap to image-center; mini-preview rebuilds.
3. Expand X/Y row by clicking "▸ position (X, Y)". X and Y should reflect centered values: `X = (imgW - W) / 2`, `Y = (imgH - H) / 2`.

- [ ] **Step 13: Verify — ratio lock**

1. On the panel, change Ratio combo to `16:9`.
2. Type W = 1280 → H clamps to 720.
3. Type H = 600 → W clamps to ~1067.
4. Mini-preview reflects the locked aspect.

- [ ] **Step 14: Verify — X/Y collapse persists across tab switch**

1. Click `▸ position (X, Y)`. Row expands.
2. Open a second ComfyUI tab. Switch back to the first.
3. The X/Y row is still expanded. Edit a crop coordinate from the panel; mini-preview updates.

- [ ] **Step 15: Verify — editor save → panel refresh**

1. Open the editor. Drag the crop handles to a new size/position. Save (Ctrl+S).
2. The panel should immediately reflect the new W, H, X, Y values.

- [ ] **Step 16: Verify — no regression on LoadImage**

Build a `Load Image → Image Crop Pixaroma → Preview Image` workflow. Run it. Everything from before this work still functions: editor opens with image, save round-trips, etc.

- [ ] **Step 17: Commit**

```bash
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" add js/crop/index.js
git -C "D:/ComfyTest/ComfyUI-Easy-Install/ComfyUI/custom_nodes/ComfyUI-Pixaroma" commit -m "feat(crop): mount on-node panel above mini-preview

Wire createCropPanel from panel.mjs into the node body. Panel reads
cropJson on refresh and writes back on every commit; mini-preview
rebuild fires on change. Editor save and workflow restore both
trigger panel.refresh(). Default node height bumped to 380 to fit."
```

---

### Task 6: Manual QA pass against the spec's test scenarios

**Files:** none — this is a verification-only task that confirms the spec's "Testing" section behaves as expected. Fix any issues found with targeted commits.

- [ ] **Step 1: Run the spec's 10 scenarios in order**

Walk through each scenario from `docs/superpowers/specs/2026-05-06-image-crop-upgrade-design.md` § 5. For each, record PASS/FAIL:

1. **Regression — LoadImage chain**: editor opens with the image, mini-preview rebuilds, save round-trips correctly.
2. **Bug fix — VAE Decode chain (post-execution)**: workflow with `VAE Decode → Crop → Save Image`. Run. Click Open Crop → editor shows the full generated image. Make a crop, save, re-run → output cropped correctly.
3. **Bug fix — pre-execution VAE Decode chain**: fresh workflow with `VAE Decode → Crop`, click Open Crop *before* running. Editor shows empty state with "Run workflow once…" hint. Run. Re-open editor. Image now visible.
4. **Panel — W/H edit**: edit W on panel. Mini-preview updates within ~200 ms. cropJson reflects. Editor shows same W.
5. **Panel — ratio lock**: select 16:9 ratio combo. Type W = 1280 → H = 720. Type H = 600 → W = 1067.
6. **Panel — Center button**: with off-center crop, click Center → X/Y snap to image center. Mini-preview reflects.
7. **Panel — X/Y collapse**: click position row → X/Y inputs appear. Switch tab and back → expanded state persists.
8. **Sync — editor save**: open editor, drag crop, save → panel reflects new W/H/X/Y.
9. **Reconnect**: disconnect VAE Decode wire, connect a different IMAGE source, run → mini-preview shows new source.
10. **Workflow restore**: close + reopen ComfyUI tab on a previously-executed workflow → mini-preview comes back, panel shows correct values.

- [ ] **Step 2: Fix any failures**

For each FAIL: identify the root cause, apply a minimal fix, re-verify the failing scenario, and commit with a `fix(crop): ...` message describing the specific issue. If a fix invalidates earlier verifications, re-run those.

- [ ] **Step 3: Final summary commit (only if Step 2 produced no fixes)**

If all 10 scenarios pass without follow-up fixes, no commit is needed for this task. If fixes were needed, they were committed in Step 2.

---

## Self-Review Notes

- **Spec coverage:** Bug-fix flow (Tasks 1-3), panel (Tasks 4-5), edge cases and tab-switch persistence woven through Tasks 2/5, testing in Task 6. All spec sections covered.
- **No placeholders:** Every code block is complete and runnable; no "implement later" or "similar to above" references.
- **Type/name consistency:** `cropJson` (string state, in `index.js`), `crop_json` (the property name inside the JSON object and on the hidden widget value), `_pixaromaCropSourceURL` / `pixaromaCropSourceURL` (camel-case for runtime field, same key in `node.properties`), `pixaromaCropPanelExpanded` (boolean property). All used identically across tasks.
- **Idempotency:** `_pixaromaLastImageDims` and `_pixaromaCropSourceURL` checks use `||` defaults so multiple refreshes are safe.
