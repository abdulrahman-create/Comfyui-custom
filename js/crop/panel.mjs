// ============================================================
// Pixaroma Image Crop — On-Node Panel
// ============================================================
// Compact custom DOM widget for the node body. Exposes W, H, X, Y,
// Ratio combo, and a one-shot Center button. Always-visible layout
// (no collapse). Source of truth = cropJson (read in refresh(),
// written on every commit).
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
export function createCropPanel(callbacks) {
  injectCSS();
  const { getCropJson, setCropJson, getImageDims, onChange } = callbacks;

  const root = document.createElement("div");
  root.className = "pix-cropp";

  // ── Row 1: W × H ──
  const row1 = document.createElement("div");
  row1.className = "pix-cropp-row";

  const wInput = makeNumberInput("W");
  const times1 = document.createElement("div");
  times1.className = "pix-cropp-times";
  times1.textContent = "×";
  const hInput = makeNumberInput("H");

  row1.append(wInput.cell, times1, hInput.cell);

  // ── Row 2: X / Y ──
  const row2 = document.createElement("div");
  row2.className = "pix-cropp-row";

  const xInput = makeNumberInput("X", 0);
  const yInput = makeNumberInput("Y", 0);
  row2.append(xInput.cell, yInput.cell);

  // ── Row 3: Ratio + Center ──
  const row3 = document.createElement("div");
  row3.className = "pix-cropp-row";

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

  row3.append(ratioSelect, centerBtn);

  root.append(row1, row2, row3);

  // ── State sync helpers ──

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
    refresh();
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
    if (!dims) return;
    const meta = readMeta();
    const w = clampW(meta.crop_w ?? wInput.input.value);
    const h = clampH(meta.crop_h ?? hInput.input.value);
    const x = Math.max(0, Math.round((dims.w - w) / 2));
    const y = Math.max(0, Math.round((dims.h - h) / 2));
    commit({ crop_w: w, crop_h: h, crop_x: x, crop_y: y });
    refresh();
  }

  wInput.input.addEventListener("change", () => onWHCommit("w"));
  hInput.input.addEventListener("change", () => onWHCommit("h"));
  xInput.input.addEventListener("change", onXYCommit);
  yInput.input.addEventListener("change", onXYCommit);
  ratioSelect.addEventListener("change", onRatioCommit);
  centerBtn.addEventListener("click", onCenterClick);

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
