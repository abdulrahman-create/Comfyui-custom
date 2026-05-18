// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Text Editor Panel (simplified v2)                  ║
// ║  Properties UI for ONE text overlay.                         ║
// ║  Mounted twice: on the node body AND in the editor sidebar.  ║
// ║                                                              ║
// ║  All numeric controls use the framework's createSliderRow    ║
// ║  (slider + number input combo) for parity with other         ║
// ║  Pixaroma editors (3D Builder, Audio Studio, etc).           ║
// ╚═══════════════════════════════════════════════════════════════╝

import { getFontCatalog, loadFontForLayer } from "./fonts.mjs";
import { createSliderRow } from "./components.mjs";
import { openPixaromaColorPickerPopup } from "../shared/color_picker.mjs";

const BRAND = "#f66744";

/** Create the text editor panel.
 *  @param {Object} opts
 *  @param {HTMLElement} opts.mount  - container to render into
 *  @param {Function} opts.onChange  - called with (layer) on any property change
 *  @returns {{ setLayer(layer), setCanvasBounds(w,h), destroy() }}
 */
export function createTextEditorPanel({ mount, onChange }) {
  injectCSS();
  let currentLayer = null;
  let suspendChange = false;

  const root = document.createElement("div");
  root.className = "pix-te-root";
  mount.appendChild(root);

  function fireChange() {
    if (suspendChange || !currentLayer) return;
    onChange(currentLayer);
  }
  function layerNow() { return currentLayer; }

  const ui = {};

  // ── TEXT ──
  section("TEXT");
  ui.textArea = el("textarea", "pix-te-textarea");
  ui.textArea.placeholder = "Type your text here...";
  root.appendChild(ui.textArea);
  ui.textArea.addEventListener("input", () => { const l = layerNow(); if (l) l.text = ui.textArea.value; fireChange(); });
  ui.textArea.addEventListener("keydown", (e) => e.stopImmediatePropagation());

  // ── FONT ──
  section("FONT");
  ui.fontSelect = el("select", "pix-te-select");
  root.appendChild(ui.fontSelect);
  ui.fontSelect.addEventListener("change", () => { const l = layerNow(); if (l) l.font = ui.fontSelect.value; fireChange(); });

  // Weight + Italic row (select + button)
  const weightRow = el("div", "pix-te-row3"); root.appendChild(weightRow);
  const wCell = el("div", "pix-te-cell");
  wCell.appendChild(label("WEIGHT"));
  ui.weightSelect = el("select", "pix-te-select pix-te-select-sm");
  ["400", "700"].forEach((w) => {
    const o = document.createElement("option"); o.value = w;
    o.textContent = w === "400" ? "Regular" : "Bold";
    ui.weightSelect.appendChild(o);
  });
  ui.weightSelect.addEventListener("change", () => { const l = layerNow(); if (l) l.weight = parseInt(ui.weightSelect.value, 10); fireChange(); });
  wCell.appendChild(ui.weightSelect); weightRow.appendChild(wCell);

  ui.italicBtn = el("button", "pix-te-btn pix-te-italic");
  ui.italicBtn.textContent = "I"; ui.italicBtn.title = "Italic";
  ui.italicBtn.style.alignSelf = "end";
  ui.italicBtn.addEventListener("click", () => {
    const l = layerNow(); if (!l) return;
    l.italic = !l.italic;
    ui.italicBtn.classList.toggle("active", l.italic);
    fireChange();
  });
  weightRow.appendChild(ui.italicBtn);

  // Align chips — icon buttons (uses shared assets/icons/ui/align-*.svg)
  label("ALIGN", root);
  const alignRow = el("div", "pix-te-row3"); root.appendChild(alignRow);
  alignRow.style.gridTemplateColumns = "1fr 1fr 1fr";
  const ALIGN_ICONS = {
    left:   "/pixaroma/assets/icons/ui/align-left.svg",
    center: "/pixaroma/assets/icons/ui/align-center-h.svg",
    right:  "/pixaroma/assets/icons/ui/align-right.svg",
  };
  ui.alignChips = ["left", "center", "right"].map((a) => {
    const b = el("button", "pix-te-btn pix-te-align-icon"); b.dataset.align = a;
    b.title = `Align ${a}`;
    const img = document.createElement("img");
    img.src = ALIGN_ICONS[a];
    img.style.cssText = "width:14px; height:14px; filter:invert(0.8); pointer-events:none;";
    b.appendChild(img);
    b.addEventListener("click", () => {
      const l = layerNow(); if (!l) return;
      l.align = a;
      ui.alignChips.forEach((c) => {
        const active = c.dataset.align === a;
        c.classList.toggle("active", active);
        const i = c.querySelector("img");
        if (i) i.style.filter = active ? "invert(1)" : "invert(0.8)";
      });
      fireChange();
    });
    alignRow.appendChild(b); return b;
  });

  // ── TYPOGRAPHY (Size, Line height, Letter spacing, Opacity, Rotation) ──
  section("TYPOGRAPHY");
  ui.sizeSlider = createSliderRow("Size", 8, 512, 96, (v) => {
    const l = layerNow(); if (l) { l.fontSize = v; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.sizeSlider.el);

  ui.lineHeightSlider = createSliderRow("Line h", 0.5, 4, 1.2, (v) => {
    const l = layerNow(); if (l) { l.lineHeight = v; fireChange(); }
  }, { step: 0.1 });
  root.appendChild(ui.lineHeightSlider.el);

  ui.letterSpacingSlider = createSliderRow("Letter sp", -10, 50, 0, (v) => {
    const l = layerNow(); if (l) { l.letterSpacing = v; fireChange(); }
  }, { step: 0.5 });
  root.appendChild(ui.letterSpacingSlider.el);

  ui.opacitySlider = createSliderRow("Opacity", 0, 100, 100, (v) => {
    const l = layerNow(); if (l) { l.opacity = v / 100; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.opacitySlider.el);

  ui.rotationSlider = createSliderRow("Rotation", -180, 180, 0, (v) => {
    const l = layerNow(); if (l) { l.rotation = v; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.rotationSlider.el);

  // ── COLORS (text + bg pill) ──
  section("COLORS");
  // Text color row
  const colorRow = el("div", "pix-te-color-row"); root.appendChild(colorRow);
  const textLabel = el("span", "pix-te-color-label"); textLabel.textContent = "Text"; colorRow.appendChild(textLabel);
  ui.colorSwatch = el("div", "pix-te-color-swatch");
  ui.colorSwatch.addEventListener("click", () => openPicker(ui.colorSwatch, layerNow()?.color || "#FFFFFF", (c) => {
    const l = layerNow(); if (!l || !c) return;
    l.color = c; ui.colorSwatch.style.background = c; ui.colorHex.value = c; fireChange();
  }));
  colorRow.appendChild(ui.colorSwatch);
  ui.colorHex = el("input", "pix-te-input-mono"); ui.colorHex.type = "text"; ui.colorHex.value = "#FFFFFF";
  ui.colorHex.addEventListener("change", () => {
    const v = ui.colorHex.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const l = layerNow(); if (!l) return;
      l.color = v; ui.colorSwatch.style.background = v; fireChange();
    } else { ui.colorHex.value = layerNow()?.color || "#FFFFFF"; }
  });
  ui.colorHex.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  colorRow.appendChild(ui.colorHex);

  // Bg pill color row (null = no pill, hex = pill enabled)
  const bgRow = el("div", "pix-te-color-row"); bgRow.style.marginTop = "6px"; root.appendChild(bgRow);
  const bgLabel = el("span", "pix-te-color-label"); bgLabel.textContent = "Behind"; bgRow.appendChild(bgLabel);
  ui.bgSwatch = el("div", "pix-te-color-swatch pix-te-swatch-checker");
  ui.bgSwatch.addEventListener("click", () => openPicker(ui.bgSwatch, layerNow()?.bgColor || "#000000", (c) => {
    const l = layerNow(); if (!l) return;
    l.bgColor = c; // c is hex from picker, or null/undefined from clear
    if (c) { ui.bgSwatch.style.background = c; ui.bgSwatch.classList.remove("pix-te-swatch-checker"); ui.bgHex.value = c; }
    else   { ui.bgSwatch.style.background = ""; ui.bgSwatch.classList.add("pix-te-swatch-checker"); ui.bgHex.value = "(none)"; }
    fireChange();
  }));
  bgRow.appendChild(ui.bgSwatch);
  ui.bgHex = el("input", "pix-te-input-mono"); ui.bgHex.type = "text"; ui.bgHex.value = "(none)"; ui.bgHex.placeholder = "(none)";
  ui.bgHex.addEventListener("change", () => {
    const v = ui.bgHex.value.trim();
    const l = layerNow(); if (!l) return;
    if (v === "" || v === "(none)") {
      l.bgColor = null;
      ui.bgSwatch.style.background = ""; ui.bgSwatch.classList.add("pix-te-swatch-checker");
      ui.bgHex.value = "(none)";
      fireChange();
    } else if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      l.bgColor = v;
      ui.bgSwatch.style.background = v; ui.bgSwatch.classList.remove("pix-te-swatch-checker");
      fireChange();
    } else { ui.bgHex.value = layerNow()?.bgColor || "(none)"; }
  });
  ui.bgHex.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  bgRow.appendChild(ui.bgHex);

  // ── POSITION (X / Y) ──
  section("POSITION");
  ui.posXSlider = createSliderRow("X", 0, 4096, 0, (v) => {
    const l = layerNow(); if (l) { l.x = v; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.posXSlider.el);
  ui.posYSlider = createSliderRow("Y", 0, 4096, 0, (v) => {
    const l = layerNow(); if (l) { l.y = v; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.posYSlider.el);

  // Load font catalog + show each option in its own font (preview).
  // Browsers render <option> elements with the system font for the select box,
  // but each option's `style="font-family:..."` is honored in the dropdown list.
  // For the preview to actually render the font, we must also have loaded the
  // FontFace into document.fonts — kick off a load for each in parallel.
  getFontCatalog().then(async (cat) => {
    ui.fontSelect.innerHTML = "";
    let lastCat = null;
    for (const f of cat) {
      if (lastCat && lastCat !== f.category) {
        const sep = document.createElement("option");
        sep.disabled = true; sep.textContent = "──────";
        ui.fontSelect.appendChild(sep);
      }
      lastCat = f.category;
      const opt = document.createElement("option");
      opt.value = f.id; opt.textContent = f.label;
      // Use the same family naming convention as canvasFontString:
      // "Pix-<fontId>" (the italic suffix is for italic variants we don't preview).
      opt.style.fontFamily = `"Pix-${f.id}", system-ui`;
      opt.style.fontSize = "14px";
      ui.fontSelect.appendChild(opt);
    }
    if (currentLayer) ui.fontSelect.value = currentLayer.font;
    // Pre-load each font (Regular weight, no italic) so the dropdown preview
    // actually renders in the right typeface. Errors are non-fatal.
    for (const f of cat) {
      const firstWeight = f.weights?.[0];
      if (!firstWeight) continue;
      loadFontForLayer(f.id, firstWeight.weight, firstWeight.italic).catch(() => {});
    }
  }).catch((e) => console.warn("[text_editor] font catalog load failed", e));

  function setLayer(layer) {
    currentLayer = layer;
    suspendChange = true;
    try {
      if (!layer) {
        root.classList.add("pix-te-empty");
        return;
      }
      root.classList.remove("pix-te-empty");
      ui.textArea.value = layer.text ?? "";
      ui.fontSelect.value = layer.font ?? "Inter";
      ui.weightSelect.value = String(layer.weight ?? 400);
      ui.italicBtn.classList.toggle("active", !!layer.italic);
      ui.alignChips.forEach((c) => {
        const active = c.dataset.align === (layer.align ?? "center");
        c.classList.toggle("active", active);
        const i = c.querySelector("img");
        if (i) i.style.filter = active ? "invert(1)" : "invert(0.8)";
      });
      ui.sizeSlider.setValue(layer.fontSize ?? 96);
      ui.lineHeightSlider.setValue(layer.lineHeight ?? 1.2);
      ui.letterSpacingSlider.setValue(layer.letterSpacing ?? 0);
      ui.opacitySlider.setValue(Math.round((layer.opacity ?? 1) * 100));
      ui.rotationSlider.setValue(layer.rotation ?? 0);
      ui.posXSlider.setValue(layer.x ?? 0);
      ui.posYSlider.setValue(layer.y ?? 0);
      ui.colorSwatch.style.background = layer.color ?? "#FFFFFF";
      ui.colorHex.value = layer.color ?? "#FFFFFF";
      if (layer.bgColor) {
        ui.bgSwatch.style.background = layer.bgColor;
        ui.bgSwatch.classList.remove("pix-te-swatch-checker");
        ui.bgHex.value = layer.bgColor;
      } else {
        ui.bgSwatch.style.background = "";
        ui.bgSwatch.classList.add("pix-te-swatch-checker");
        ui.bgHex.value = "(none)";
      }
    } finally {
      suspendChange = false;
    }
  }

  /** Set position slider ranges based on the canvas dimensions. Call once
   *  after editor opens. Without this the position sliders default to 0..4096
   *  which is wrong for smaller canvases (e.g. 1024×1024). */
  function setCanvasBounds(canvasWidth, canvasHeight) {
    ui.posXSlider.setRange(-canvasWidth, canvasWidth * 2);
    ui.posYSlider.setRange(-canvasHeight, canvasHeight * 2);
  }

  function destroy() { root.remove(); }

  function section(text) {
    const h = document.createElement("div");
    h.className = "pix-te-section";
    h.textContent = text;
    root.appendChild(h);
  }

  return { setLayer, setCanvasBounds, destroy };
}

// ── stateless helpers ─────────────────────────────────────────────────────────

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
function label(text, parent) {
  const l = el("div", "pix-te-label");
  l.textContent = text;
  if (parent) parent.appendChild(l);
  return l;
}
function openPicker(swatchEl, initialColor, onPick) {
  openPixaromaColorPickerPopup(swatchEl, { initialColor, onPick });
}

// ── CSS injection (once per page) ─────────────────────────────────────────────

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return; _cssInjected = true;
  const s = document.createElement("style"); s.id = "pix-te-css";
  s.textContent = `
    .pix-te-root { display:flex; flex-direction:column; gap:6px; color:#fff; font:13px system-ui; }
    .pix-te-empty::after { content:"Select a layer to edit"; color:#666; font-style:italic; }
    .pix-te-section { font:600 11px system-ui; color:#888; letter-spacing:1px; margin-top:10px; margin-bottom:4px; }
    .pix-te-label { font:10px system-ui; color:#888; letter-spacing:1px; margin-bottom:3px; }
    .pix-te-textarea { width:100%; background:#0d0d0d; color:#fff; border:1px solid #333; border-radius:4px; padding:8px; font:13px system-ui; resize:vertical; min-height:48px; box-sizing:border-box; }
    .pix-te-select { width:100%; background:#0d0d0d; color:#fff; border:1px solid #333; border-radius:4px; padding:6px 10px; font:13px system-ui; }
    .pix-te-select-sm { padding:5px 8px; font:12px system-ui; }
    /* Orange highlight on dropdown options (overrides browser default blue).
       The native <select> popup is partly OS-rendered: :checked + :hover work
       in modern Chrome/Edge, the keyboard-focus highlight may still leak OS
       blue on some platforms (cannot be fully styled via CSS). */
    .pix-te-select option { background-color:#0d0d0d; color:#fff; }
    .pix-te-select option:checked,
    .pix-te-select option:hover,
    .pix-te-select option:focus,
    .pix-te-select option:active {
      background:#f66744 !important;
      background-color:#f66744 !important;
      color:#fff !important;
      box-shadow:inset 0 0 0 999px #f66744 !important;
    }
    .pix-te-input-mono { flex:1; background:#0d0d0d; color:#fff; border:1px solid #333; border-radius:4px; padding:6px 10px; font:12px monospace; box-sizing:border-box; }
    .pix-te-row3 { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; align-items:end; }
    .pix-te-cell { display:flex; flex-direction:column; gap:3px; }
    .pix-te-btn { background:#0d0d0d; color:#aaa; border:1px solid #333; padding:6px; font:600 12px system-ui; cursor:pointer; border-radius:4px; min-width:32px; }
    .pix-te-btn.active { background:#2a1f1a; color:${BRAND}; border-color:${BRAND}; }
    .pix-te-italic { font:italic 600 14px serif; }
    .pix-te-align { font:600 12px system-ui; }
    .pix-te-align-icon { display:flex; align-items:center; justify-content:center; padding:6px 0; height:28px; box-sizing:border-box; }
    .pix-te-color-row { display:flex; gap:6px; align-items:center; }
    .pix-te-color-label { font:10px system-ui; color:#888; width:42px; flex-shrink:0; }
    .pix-te-color-swatch { width:32px; height:32px; border-radius:4px; border:1px solid #444; cursor:pointer; flex:0 0 32px; background:#fff; }
    .pix-te-swatch-checker { background:repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 0 0 / 8px 8px !important; }
  `;
  document.head.appendChild(s);
}
