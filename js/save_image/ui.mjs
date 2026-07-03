// Save Image Pixaroma — node-body DOM + CSS (both renderers).
// Layout follows the user's Photoshop mockup (2026-07-03): minimal labels,
// one wrapping button row (format seg + mode seg + Copy/Open/Open Folder),
// and a Preview-Image-style viewer that gets most of the node: single image
// fills the area, batches show as a GRID (click a cell to expand, ✕ back).
// The flex column lives on an INNER absolute layer (.pix-si-inner) because
// ComfyUI forces the addDOMWidget ROOT to inline display:block on rebuild /
// collapse (see the Nodes 2.0 clobber note in CLAUDE.md).

import { DEFAULT_STATE } from "./state.mjs";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let _cssDone = false;
export function injectCSS() {
  if (_cssDone || document.getElementById("pix-si-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-si-css";
  s.textContent = [
    ".pix-si-root{position:relative;width:100%;height:100%;box-sizing:border-box;}",
    ".pix-si-inner{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;padding:8px 10px 4px;box-sizing:border-box;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;}",
    ".pix-si-lab{display:block;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#f66744;margin-bottom:4px;}",
    ".pix-si-row{display:flex;gap:6px;align-items:center;}",
    ".pix-si-field{flex:1;min-width:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#e0e0e0;padding:5px 8px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;width:100%;}",
    ".pix-si-field:focus{border-color:#f66744;}",
    ".pix-si-field.mono{font-family:Consolas,ui-monospace,monospace;font-size:12px;}",
    ".pix-si-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#ccc;border-radius:4px;padding:5px 10px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:0 0 auto;font-family:inherit;user-select:none;}",
    ".pix-si-btn:hover{background:#f66744;border-color:#f66744;color:#fff;}",
    ".pix-si-btn:disabled{opacity:.5;cursor:default;}",
    ".pix-si-btn:disabled:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.16);color:#ccc;}",
    // solid BRAND action buttons (Preview Image parity)
    ".pix-si-primary{background:#f66744;border-color:#f66744;color:#fff;}",
    ".pix-si-primary:hover{background:#ff7d58;border-color:#ff7d58;color:#fff;}",
    ".pix-si-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}",
    ".pix-si-chip{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#ccc;border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-si-chip:hover{border-color:#f66744;color:#eee;}",
    ".pix-si-prev{background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:6px 8px;margin-top:8px;}",
    ".pix-si-prevlab{font-size:10px;color:#8f8f8f;margin-bottom:2px;}",
    ".pix-si-prevpath{font-family:Consolas,ui-monospace,monospace;font-size:11px;color:#ffb59e;word-break:break-all;line-height:1.45;}",
    ".pix-si-hint{font-size:10px;color:#8f8f8f;margin-top:4px;line-height:1.5;}",
    // toggles are rounded PILLS so they read as switches, not action buttons
    // (the rectangular orange buttons are the actions - user request)
    ".pix-si-seg{display:inline-flex;border:1px solid #444;border-radius:999px;overflow:hidden;flex:0 0 auto;}",
    ".pix-si-seg button{background:#1d1d1d;color:#aaa;border:none;padding:4px 11px;font-size:12px;cursor:pointer;font-family:inherit;}",
    ".pix-si-seg button.on{background:#f66744;color:#fff;}",
    // the action buttons share the leftover row space EQUALLY and the row
    // ends flush with the right edge (flex-wrap only as a narrow fallback)
    ".pix-si-btnrow{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch;}",
    ".pix-si-grow{flex:1 1 0;min-width:0;justify-content:center;}",
    // ── the viewer ──
    ".pix-si-saved{flex:1 1 0;min-height:0;display:flex;flex-direction:column;gap:3px;}",
    ".pix-si-view{position:relative;flex:1 1 0;min-height:120px;background:#151515;border:1px solid #3c3c3c;border-radius:4px;overflow:hidden;}",
    ".pix-si-view.has{background:transparent;border-color:transparent;}",
    ".pix-si-big{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;cursor:pointer;display:none;}",
    ".pix-si-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#777;font-size:11px;padding:8px;text-align:center;}",
    ".pix-si-grid{position:absolute;inset:0;display:none;gap:4px;}",
    ".pix-si-view.gridmode .pix-si-grid{display:grid;}",
    ".pix-si-cell{position:relative;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;}",
    ".pix-si-cell img{width:100%;height:100%;object-fit:contain;display:block;}",
    ".pix-si-cell:hover{outline:1px solid #f66744;outline-offset:-1px;border-radius:3px;}",
    ".pix-si-cellbadge{position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.55);color:#ddd;font-size:10px;padding:0 5px;border-radius:3px;pointer-events:none;}",
    ".pix-si-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.18);color:#ddd;border-radius:4px;padding:4px 7px;font-size:11px;cursor:pointer;display:none;}",
    ".pix-si-view.has:hover .pix-si-nav.show{display:block;}",
    ".pix-si-nav.prev{left:6px;}",
    ".pix-si-nav.next{right:6px;}",
    ".pix-si-nav:hover{background:#f66744;border-color:#f66744;color:#fff;}",
    ".pix-si-count{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.55);color:#ddd;font-size:11px;padding:1px 7px;border-radius:3px;display:none;}",
    ".pix-si-x{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.18);color:#ddd;border-radius:4px;padding:2px 9px;font-size:11px;cursor:pointer;display:none;}",
    ".pix-si-x:hover{background:#f66744;border-color:#f66744;color:#fff;}",
    // one small info line under the image: dims + save summary + flashes
    ".pix-si-info{flex:0 0 auto;text-align:center;font-size:11px;color:#8f8f8f;min-height:12px;line-height:1.25;word-break:break-word;}",
    // right-click settings panel (Run Timer palette; DROPPED by mistake in
    // the mockup-v2 rewrite - the panel rendered as an invisible unstyled
    // div at the page bottom. Keep this block when restyling the face!)
    ".pix-si-panel{position:fixed;z-index:10010;width:300px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-si-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-si-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-si-px:hover{color:#fff;}",
    ".pix-si-pbody{padding:12px;display:flex;flex-direction:column;gap:12px;color:#ddd;}",
    ".pix-si-prow{display:flex;align-items:center;gap:9px;}",
    ".pix-si-plab{font-size:12px;color:#ddd;}",
    ".pix-si-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}",
    ".pix-si-qval{font-size:12px;color:#f66744;min-width:24px;text-align:right;}",
    ".pix-si-qsl{flex:1;min-width:0;}",
    '.pix-si-sw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;}',
    '.pix-si-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#ccc;transition:left .15s;}',
    ".pix-si-sw.on{background:#f66744;}",
    ".pix-si-sw.on::after{left:16px;background:#fff;}",
    // right-click menu on the preview image (Open / Copy / Save image)
    ".pix-si-menu{position:fixed;z-index:10011;background:#1a1a1a;border:1px solid #444;border-radius:6px;padding:4px;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;}",
    ".pix-si-mitem{padding:6px 12px;font-size:12px;color:#ddd;border-radius:4px;cursor:pointer;white-space:nowrap;user-select:none;}",
    ".pix-si-mitem:hover{background:#f66744;color:#fff;}",
    // Nodes 2.0: hide the native output-image preview panel for this node
    ".lg-node:has(.pix-si-root) .image-preview{display:none !important;}",
  ].join("\n");
  document.head.appendChild(s);
}

export function buildRoot() {
  const root = el("div", "pix-si-root");
  const inner = el("div", "pix-si-inner");
  root.appendChild(inner);

  // ── folder (no label - the placeholder + hint say it all) ──
  const secFolder = el("div");
  const rowF = el("div", "pix-si-row");
  const folderInput = el("input", "pix-si-field");
  folderInput.type = "text";
  folderInput.spellcheck = false;
  folderInput.placeholder = "ComfyUI output folder";
  folderInput.title = "Where the images are saved. Type or paste any path on your computer, or click Browse. Empty = ComfyUI's output folder.";
  const browseBtn = el("button", "pix-si-btn");
  browseBtn.type = "button";
  const browseLbl = el("span", null, "Browse");
  browseBtn.appendChild(browseLbl);
  browseBtn.title = "Pick a folder with the system folder dialog";
  rowF.appendChild(folderInput);
  rowF.appendChild(browseBtn);
  secFolder.appendChild(rowF);
  secFolder.appendChild(
    el("div", "pix-si-hint", "Leave empty to use the ComfyUI output folder. You can paste any path.")
  );
  inner.appendChild(secFolder);

  // ── filename ──
  const secName = el("div");
  secName.appendChild(el("span", "pix-si-lab", "Filename"));
  const patternInput = el("input", "pix-si-field mono");
  patternInput.type = "text";
  patternInput.spellcheck = false;
  patternInput.placeholder = DEFAULT_STATE.pattern;
  patternInput.title = "Filename pattern. Click the chips to insert tokens; the line below shows the exact next file. Files never overwrite: the counter continues from the highest number already in the folder.";
  secName.appendChild(patternInput);
  const chipsWrap = el("div", "pix-si-chips");
  secName.appendChild(chipsWrap);
  const prev = el("div", "pix-si-prev");
  prev.appendChild(el("div", "pix-si-prevlab", "Will save as"));
  const prevPath = el("div", "pix-si-prevpath", "");
  prev.appendChild(prevPath);
  secName.appendChild(prev);
  secName.appendChild(el("div", "pix-si-hint", "Type / in the name to create subfolders."));
  inner.appendChild(secName);

  // ── one wrapping button row: format + mode + actions (user's mockup) ──
  const secBtns = el("div");
  const btnRow = el("div", "pix-si-btnrow");
  const segFmt = el("div", "pix-si-seg");
  const fmtPng = el("button", null, "PNG");
  fmtPng.type = "button";
  fmtPng.title = "Lossless PNG. Keeps transparency and embeds the workflow for drag-back reload.";
  const fmtJpg = el("button", null, "JPG");
  fmtJpg.type = "button";
  fmtJpg.title = "Smaller JPG files. Quality is in the right-click settings. No transparency. Workflows reload from PNG only.";
  segFmt.appendChild(fmtPng);
  segFmt.appendChild(fmtJpg);
  btnRow.appendChild(segFmt);
  const segMode = el("div", "pix-si-seg");
  const modeSave = el("button", null, "Save");
  modeSave.type = "button";
  modeSave.title = "Write the files on every run";
  const modePreview = el("button", null, "Preview");
  modePreview.type = "button";
  modePreview.title = "Show the images on the node without writing anything to your folder";
  segMode.appendChild(modeSave);
  segMode.appendChild(modePreview);
  btnRow.appendChild(segMode);
  const btnCopy = el("button", "pix-si-btn pix-si-primary pix-si-grow", "Copy");
  btnCopy.type = "button";
  btnCopy.title = "Copy the shown image to the clipboard";
  const btnOpen = el("button", "pix-si-btn pix-si-primary pix-si-grow", "Open");
  btnOpen.type = "button";
  btnOpen.title = "Open the shown image in a new browser tab";
  const btnFolder = el("button", "pix-si-btn pix-si-primary pix-si-grow", "Folder");
  btnFolder.type = "button";
  btnFolder.title = "Open the save folder in your file explorer (the window can appear on the taskbar)";
  btnRow.appendChild(btnCopy);
  btnRow.appendChild(btnOpen);
  btnRow.appendChild(btnFolder);
  secBtns.appendChild(btnRow);
  inner.appendChild(secBtns);

  // ── the viewer: single image fills, batches show a grid ──
  const secSaved = el("div", "pix-si-saved");
  const view = el("div", "pix-si-view");
  const bigImg = el("img", "pix-si-big");
  const grid = el("div", "pix-si-grid");
  const ph = el("div", "pix-si-ph", "Run the workflow to save and preview the result here");
  const navPrev = el("button", "pix-si-nav prev", "◀");
  navPrev.type = "button";
  navPrev.title = "Previous image";
  const navNext = el("button", "pix-si-nav next", "▶");
  navNext.type = "button";
  navNext.title = "Next image";
  const counter = el("div", "pix-si-count", "");
  const closeX = el("button", "pix-si-x", "✕");
  closeX.type = "button";
  closeX.title = "Back to the grid";
  view.appendChild(bigImg);
  view.appendChild(grid);
  view.appendChild(ph);
  view.appendChild(navPrev);
  view.appendChild(navNext);
  view.appendChild(counter);
  view.appendChild(closeX);
  secSaved.appendChild(view);
  const infoLine = el("div", "pix-si-info", "");
  secSaved.appendChild(infoLine);
  inner.appendChild(secSaved);

  return {
    root,
    inner,
    folderInput,
    browseBtn,
    browseLbl,
    patternInput,
    chipsWrap,
    prevPath,
    fmtPng,
    fmtJpg,
    modeSave,
    modePreview,
    btnCopy,
    btnOpen,
    btnFolder,
    savedSec: secSaved,
    view,
    grid,
    bigImg,
    ph,
    navPrev,
    navNext,
    counter,
    closeX,
    infoLine,
  };
}
