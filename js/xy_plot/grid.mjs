// XY Plot Pixaroma - in-node grid preview (an <img> showing Python's latest
// assembled grid PNG) + the Save Disk / Save Output / Copy / Open button row.
//
// Python owns all grid rendering, so this is just display + save plumbing.
// An <img> is resolution-independent, so it stays crisp at any zoom in both
// renderers (the Nodes 2.0 canvas-blur rule doesn't apply to <img>).

import { app } from "/scripts/app.js";
import { readState } from "./core.mjs";

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function toast(summary, detail, severity = "info") {
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try { tm.add({ severity, summary, detail, life: 3500 }); return; } catch (_e) {}
  }
  try {
    const b = el("div", null, `${summary}: ${detail}`);
    b.style.cssText = "position:fixed;top:60px;right:20px;background:#1d1d1d;color:#fff;font:13px sans-serif;padding:10px 14px;border-radius:6px;border:2px solid #f66744;z-index:99999;";
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3500);
  } catch (_e) {}
}

function prefixOf(node) {
  const w = node.widgets?.find((x) => x && x.name === "filename_prefix");
  const v = (w && typeof w.value === "string") ? w.value.trim() : "";
  return v || "xy_plot";
}

async function fetchGridBlob(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.url) return null;
  try {
    const resp = await fetch(last.url, { cache: "no-store" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    // Force image/png so ClipboardItem (strict) accepts it.
    return blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  } catch (_e) { return null; }
}

async function doCopy(node) {
  const blob = await fetchGridBlob(node);
  if (!blob) { toast("XY Plot", "No grid to copy yet.", "warn"); return; }
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast("XY Plot", "Clipboard image copy isn't supported in this browser.", "warn"); return;
  }
  try {
    await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
    toast("XY Plot", "Grid copied to clipboard.");
  } catch (_e) { toast("XY Plot", "Copy failed.", "error"); }
}

function doOpen(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.url) { toast("XY Plot", "No grid to open yet.", "warn"); return; }
  // Use an <a target="_blank"> click rather than window.open(...,"noopener"):
  // Chrome returns null from window.open when "noopener" is set even on
  // success, which made the old code falsely report "popup blocked".
  const a = el("a");
  a.href = last.url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Ask the server to re-assemble the grid at the chosen Save resolution and
// return the PNG bytes (with the run's workflow embedded), for Save Disk. Returns
// a Blob, or null when there's no live session (caller falls back to the capped
// preview file). The size is built on demand, so it costs nothing until you Save.
async function fetchFullResBlob(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.sessionId) return null;
  const state = readState(node);
  // Prefer the EXECUTION-time prompt/workflow (locked seed) - same as Save Output.
  let prompt = node._pixXyExecPrompt || null;
  let workflow = node._pixXyExecWorkflow || null;
  if (!workflow && !prompt) {
    try { const gp = await app.graphToPrompt(); prompt = gp?.output || null; workflow = gp?.workflow || null; } catch (_e) {}
  }
  try {
    const resp = await fetch("/pixaroma/api/xy_plot/render_full", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: last.sessionId,
        save_max_size: state.saveMaxSize || "4096",
        prompt, workflow,
      }),
    });
    if (!resp.ok) return null;   // 404 = session evicted -> caller uses the preview
    const blob = await resp.blob();
    return blob && blob.size ? blob : null;
  } catch (_e) { return null; }
}

async function doSaveDisk(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.url) { toast("XY Plot", "No grid to save yet.", "warn"); return; }
  const name = prefixOf(node).split("/").pop() + "_grid.png";

  if (window.showSaveFilePicker) {
    // Open the picker FIRST, while the user-gesture activation is still valid - a
    // slow full-res encode could otherwise outlast it and the picker would throw.
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
      });
    } catch (e) {
      if (e && e.name === "AbortError") return;   // user cancelled the dialog
      toast("XY Plot", "Save to disk failed.", "error"); return;
    }
    let blob = await fetchFullResBlob(node);
    let capped = false;
    if (!blob) { blob = await fetchGridBlob(node); capped = true; }   // session expired
    if (!blob) { toast("XY Plot", "No grid to save.", "error"); return; }
    try {
      const ws = await handle.createWritable();
      await ws.write(blob); await ws.close();
      toast("XY Plot", capped
        ? "Grid saved to disk (preview size - re-run the plot for full resolution)."
        : "Grid saved to disk.", capped ? "warn" : "info");
    } catch (_e) {
      toast("XY Plot", "Save to disk failed.", "error");
    }
    return;
  }

  // Fallback (no File System Access API): fetch then anchor-download.
  let blob = await fetchFullResBlob(node);
  let capped = false;
  if (!blob) { blob = await fetchGridBlob(node); capped = true; }
  if (!blob) { toast("XY Plot", "No grid to save yet.", "warn"); return; }
  try {
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
    toast("XY Plot", capped
      ? "Saved at preview size (session expired - re-run for full resolution)."
      : "Grid saved to disk.", capped ? "warn" : "info");
  } catch (_e) {
    toast("XY Plot", "Save to disk failed.", "error");
  }
}

async function doSaveOutput(node) {
  const last = node._pixXyLastGrid;
  if (!last || !last.filename) { toast("XY Plot", "No grid to save yet.", "warn"); return; }
  const state = readState(node);
  // Prefer the EXECUTION-time prompt/workflow captured when the grid ran, so
  // the embedded metadata reproduces the grid's actual (locked) seed. Fall back
  // to the live graph only if no run happened this session (Preview Pattern #13).
  let prompt = node._pixXyExecPrompt || null;
  let workflow = node._pixXyExecWorkflow || null;
  if (!workflow && !prompt) {
    try {
      const gp = await app.graphToPrompt();
      prompt = gp?.output || null;
      workflow = gp?.workflow || null;
    } catch (_e) {}
  }
  const wantCells = state.saveCells === true;
  try {
    const resp = await fetch("/pixaroma/api/xy_plot/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grid_filename: last.filename,
        session_id: last.sessionId || null,
        filename_prefix: prefixOf(node),
        save_cells: wantCells,
        save_max_size: state.saveMaxSize || "4096",
        prompt, workflow,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) { toast("XY Plot", data.error || "Save to output failed.", "error"); return; }
    const extra = data.saved_cells ? ` (+${data.saved_cells} cells)` : "";
    const dims = (data.width && data.height) ? ` — ${data.width}×${data.height}` : "";
    toast("XY Plot", `Saved to output/${data.subfolder ? data.subfolder + "/" : ""}${data.filename}${extra}${dims}`);
    // If cells were requested but none were written (session expired), say so.
    if (wantCells && !data.saved_cells) {
      toast("XY Plot", "Grid saved, but cells couldn't be saved (session expired) - re-run the plot to save cells.", "warn");
    }
  } catch (_e) {
    toast("XY Plot", "Save to output failed.", "error");
  }
}

// Build the preview + button row into `mount` (the .pix-xy-gridmount element).
// Returns an API object cached on the node by index.js.
export function buildGridPreview(node, mount) {
  mount.innerHTML = "";
  const box = el("div", "pix-xy-gridbox");
  const hint = el("div", "pix-xy-gridhint", "The labeled grid appears here after you hit Run.");
  const img = el("img", "pix-xy-gridimg");
  img.style.display = "none";
  // On load, only RE-FIT the node when the grid's pixel dimensions actually
  // changed (a new plot shape). A theme re-skin is the exact same size, so
  // re-fitting there just made fitNode and ComfyUI's own layout fight over a
  // few px forever (the flicker). Always repaint, twice, so the frame settles.
  img.addEventListener("load", () => {
    const dims = (img.naturalWidth || 0) + "x" + (img.naturalHeight || 0);
    if (dims !== node._pixXyGridDims) {
      node._pixXyGridDims = dims;
      try { node._pixXyFit?.(); } catch (_e) {}
    }
    try { node.setDirtyCanvas?.(true, true); } catch (_e) {}
    requestAnimationFrame(() => { try { node.setDirtyCanvas?.(true, true); } catch (_e) {} });
  });
  box.appendChild(hint);
  box.appendChild(img);
  mount.appendChild(box);

  const bar = el("div", "pix-xy-savebar");
  const mk = (label, fn) => { const b = el("div", "pix-xy-sb", label); b.addEventListener("click", () => fn(node)); return b; };
  const bSave = mk("Save Disk", doSaveDisk);
  const bOut = mk("Save Output", doSaveOutput);
  const bCopy = mk("Copy", doCopy);
  const bOpen = mk("Open", doOpen);
  bar.appendChild(bSave); bar.appendChild(bOut); bar.appendChild(bCopy); bar.appendChild(bOpen);
  mount.appendChild(bar);

  const setEnabled = (on) => {
    [bSave, bOut, bCopy, bOpen].forEach((b) => b.classList.toggle("disabled", !on));
  };
  setEnabled(false);

  let gridReq = 0;   // bumped per setGrid so a stale preload can't swap a stale grid

  return {
    setGrid(url) {
      // Preload the new grid, then swap the VISIBLE img only once it's ready.
      // This keeps the old grid (same size) on screen during a theme re-skin so
      // the <img> never collapses -> the node doesn't shrink-then-grow -> no
      // flicker and the bottom buttons never poke out of the frame.
      // A request token guards against two rapid setGrid calls (e.g. theme
      // spam): only the LATEST preload is allowed to swap, and only if the
      // node/img is still alive.
      const token = (gridReq += 1);
      const show = () => {
        if (token !== gridReq) return;          // a newer setGrid superseded this
        if (!img.isConnected) return;            // node/img torn down meanwhile
        img.src = url;
        img.style.display = "block";
        hint.style.display = "none";
        setEnabled(true);
      };
      const pre = new Image();
      pre.onload = show;
      pre.onerror = show;   // show anyway; the visible img will surface the error
      pre.src = url;
    },
    clear() {
      img.removeAttribute("src");
      img.style.display = "none";
      hint.style.display = "";
      setEnabled(false);
      node._pixXyGridDims = null;   // so the next grid re-fits the node
    },
  };
}
