// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Text Editor Panel                                  ║
// ║  Right-sidebar properties UI for ONE text layer.             ║
// ║  Used by Text Overlay node + future Composer text layers.   ║
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
 *  @returns {{ setLayer(layer), destroy() }}
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
  // pix-te-row3 uses `1fr 1fr auto` for the size/weight/italic combo. Align
  // needs three equal columns instead.
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

  // ── SIZE / LINE / SPACING — sliders ──
  ui.sizeSlider = createSliderRow("Size", 8, 256, 36, (v) => {
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

  // ── COLOR ──
  section("COLOR");
  const colorRow = el("div", "pix-te-color-row"); root.appendChild(colorRow);
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

  // ── POSITION (X / Y only — opacity + rotation live in the left transform
  // panel and at the top of the right sidebar, no duplicates) ──
  section("POSITION");
  ui.posXSlider = createSliderRow("X", 0, 4096, 0, (v) => {
    const l = layerNow(); if (l) { l.x = v; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.posXSlider.el);
  ui.posYSlider = createSliderRow("Y", 0, 4096, 0, (v) => {
    const l = layerNow(); if (l) { l.y = v; fireChange(); }
  }, { step: 1 });
  root.appendChild(ui.posYSlider.el);

  // ── EFFECTS ──
  section("EFFECTS");
  const effectsRow = el("div", "pix-te-row3"); root.appendChild(effectsRow);
  ui.strokeToggle = toggleBtn("Stroke", () => toggleEffect("stroke", ui.strokeToggle, ui.strokePanel,
    { color: "#000000", width: 2 }));
  ui.shadowToggle = toggleBtn("Shadow", () => toggleEffect("shadow", ui.shadowToggle, ui.shadowPanel,
    { color: "#000000", blur: 8, offsetX: 0, offsetY: 2, opacity: 0.7 }));
  ui.bgToggle = toggleBtn("Bg pill", () => toggleEffect("background", ui.bgToggle, ui.bgPanel,
    { color: "#000000", paddingX: 12, paddingY: 8, radius: 6, opacity: 1.0 }));
  effectsRow.append(ui.strokeToggle, ui.shadowToggle, ui.bgToggle);

  // Stroke panel
  ui.strokePanel = el("div", "pix-te-effect-panel"); ui.strokePanel.style.display = "none";
  root.appendChild(ui.strokePanel);
  ui.strokePanel.appendChild(label("STROKE COLOR"));
  ui.strokeColorSwatch = el("div", "pix-te-color-swatch");
  ui.strokeColorSwatch.addEventListener("click", () => openPicker(ui.strokeColorSwatch,
    layerNow()?.stroke?.color || "#000000", (c) => {
      const l = layerNow(); if (!l || !l.stroke || !c) return;
      l.stroke.color = c; ui.strokeColorSwatch.style.background = c; fireChange();
    }));
  ui.strokePanel.appendChild(ui.strokeColorSwatch);
  ui.strokeWidthSlider = createSliderRow("Width", 0, 50, 2, (v) => {
    const l = layerNow(); if (l?.stroke) { l.stroke.width = v; fireChange(); }
  }, { step: 0.5 });
  ui.strokePanel.appendChild(ui.strokeWidthSlider.el);

  // Shadow panel
  ui.shadowPanel = el("div", "pix-te-effect-panel"); ui.shadowPanel.style.display = "none";
  root.appendChild(ui.shadowPanel);
  ui.shadowPanel.appendChild(label("SHADOW COLOR"));
  ui.shadowColorSwatch = el("div", "pix-te-color-swatch");
  ui.shadowColorSwatch.addEventListener("click", () => openPicker(ui.shadowColorSwatch,
    layerNow()?.shadow?.color || "#000000", (c) => {
      const l = layerNow(); if (!l || !l.shadow || !c) return;
      l.shadow.color = c; ui.shadowColorSwatch.style.background = c; fireChange();
    }));
  ui.shadowPanel.appendChild(ui.shadowColorSwatch);
  ui.shadowBlurSlider = createSliderRow("Blur", 0, 100, 8, (v) => {
    const l = layerNow(); if (l?.shadow) { l.shadow.blur = v; fireChange(); }
  }, { step: 1 });
  ui.shadowPanel.appendChild(ui.shadowBlurSlider.el);
  ui.shadowOffsetXSlider = createSliderRow("Offset X", -100, 100, 0, (v) => {
    const l = layerNow(); if (l?.shadow) { l.shadow.offsetX = v; fireChange(); }
  }, { step: 1 });
  ui.shadowPanel.appendChild(ui.shadowOffsetXSlider.el);
  ui.shadowOffsetYSlider = createSliderRow("Offset Y", -100, 100, 2, (v) => {
    const l = layerNow(); if (l?.shadow) { l.shadow.offsetY = v; fireChange(); }
  }, { step: 1 });
  ui.shadowPanel.appendChild(ui.shadowOffsetYSlider.el);
  ui.shadowOpacitySlider = createSliderRow("Opacity", 0, 100, 70, (v) => {
    const l = layerNow(); if (l?.shadow) { l.shadow.opacity = v / 100; fireChange(); }
  }, { step: 1 });
  ui.shadowPanel.appendChild(ui.shadowOpacitySlider.el);

  // Background panel
  ui.bgPanel = el("div", "pix-te-effect-panel"); ui.bgPanel.style.display = "none";
  root.appendChild(ui.bgPanel);
  ui.bgPanel.appendChild(label("PILL COLOR"));
  ui.bgColorSwatch = el("div", "pix-te-color-swatch");
  ui.bgColorSwatch.addEventListener("click", () => openPicker(ui.bgColorSwatch,
    layerNow()?.background?.color || "#000000", (c) => {
      const l = layerNow(); if (!l || !l.background || !c) return;
      l.background.color = c; ui.bgColorSwatch.style.background = c; fireChange();
    }));
  ui.bgPanel.appendChild(ui.bgColorSwatch);
  ui.bgPaddingXSlider = createSliderRow("Pad X", 0, 100, 12, (v) => {
    const l = layerNow(); if (l?.background) { l.background.paddingX = v; fireChange(); }
  }, { step: 1 });
  ui.bgPanel.appendChild(ui.bgPaddingXSlider.el);
  ui.bgPaddingYSlider = createSliderRow("Pad Y", 0, 100, 8, (v) => {
    const l = layerNow(); if (l?.background) { l.background.paddingY = v; fireChange(); }
  }, { step: 1 });
  ui.bgPanel.appendChild(ui.bgPaddingYSlider.el);
  ui.bgRadiusSlider = createSliderRow("Radius", 0, 200, 6, (v) => {
    const l = layerNow(); if (l?.background) { l.background.radius = v; fireChange(); }
  }, { step: 1 });
  ui.bgPanel.appendChild(ui.bgRadiusSlider.el);
  ui.bgOpacitySlider = createSliderRow("Opacity", 0, 100, 100, (v) => {
    const l = layerNow(); if (l?.background) { l.background.opacity = v / 100; fireChange(); }
  }, { step: 1 });
  ui.bgPanel.appendChild(ui.bgOpacitySlider.el);

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

  function toggleEffect(key, btn, panel, defaults) {
    const l = currentLayer; if (!l) return;
    if (l[key]) { l[key] = null; btn.classList.remove("active"); panel.style.display = "none"; }
    else        { l[key] = { ...defaults }; btn.classList.add("active"); panel.style.display = "block"; setLayer(l); }
    fireChange();
  }

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
        const active = c.dataset.align === (layer.align ?? "left");
        c.classList.toggle("active", active);
        const i = c.querySelector("img");
        if (i) i.style.filter = active ? "invert(1)" : "invert(0.8)";
      });
      ui.sizeSlider.setValue(layer.fontSize ?? 36);
      ui.lineHeightSlider.setValue(layer.lineHeight ?? 1.2);
      ui.letterSpacingSlider.setValue(layer.letterSpacing ?? 0);
      ui.colorSwatch.style.background = layer.color ?? "#FFFFFF";
      ui.colorHex.value = layer.color ?? "#FFFFFF";
      ui.posXSlider.setValue(layer.x ?? 0);
      ui.posYSlider.setValue(layer.y ?? 0);
      ui.strokeToggle.classList.toggle("active", !!layer.stroke);
      ui.shadowToggle.classList.toggle("active", !!layer.shadow);
      ui.bgToggle.classList.toggle("active", !!layer.background);
      ui.strokePanel.style.display = layer.stroke ? "block" : "none";
      ui.shadowPanel.style.display = layer.shadow ? "block" : "none";
      ui.bgPanel.style.display = layer.background ? "block" : "none";
      if (layer.stroke) {
        ui.strokeColorSwatch.style.background = layer.stroke.color;
        ui.strokeWidthSlider.setValue(layer.stroke.width);
      }
      if (layer.shadow) {
        ui.shadowColorSwatch.style.background = layer.shadow.color;
        ui.shadowBlurSlider.setValue(layer.shadow.blur);
        ui.shadowOffsetXSlider.setValue(layer.shadow.offsetX);
        ui.shadowOffsetYSlider.setValue(layer.shadow.offsetY);
        ui.shadowOpacitySlider.setValue(Math.round((layer.shadow.opacity ?? 1) * 100));
      }
      if (layer.background) {
        ui.bgColorSwatch.style.background = layer.background.color;
        ui.bgPaddingXSlider.setValue(layer.background.paddingX);
        ui.bgPaddingYSlider.setValue(layer.background.paddingY);
        ui.bgRadiusSlider.setValue(layer.background.radius);
        ui.bgOpacitySlider.setValue(Math.round((layer.background.opacity ?? 1) * 100));
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
function toggleBtn(text, onClick) {
  const b = el("button", "pix-te-toggle");
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
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
       Works in Chrome/Edge; Firefox honors :checked but ignores :hover here.
       The OS-rendered hover state on some platforms can't be styled at all. */
    .pix-te-select option { background-color:#0d0d0d; color:#fff; }
    .pix-te-select option:checked { background:#f66744 !important; background-color:#f66744 !important; color:#fff !important; box-shadow:inset 0 0 0 999px #f66744 !important; }
    .pix-te-select option:hover { background:#2a1f1a; color:#f66744; }
    .pix-te-input-mono { flex:1; background:#0d0d0d; color:#fff; border:1px solid #333; border-radius:4px; padding:6px 10px; font:12px monospace; box-sizing:border-box; }
    .pix-te-row3 { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; align-items:end; }
    .pix-te-cell { display:flex; flex-direction:column; gap:3px; }
    .pix-te-btn { background:#0d0d0d; color:#aaa; border:1px solid #333; padding:6px; font:600 12px system-ui; cursor:pointer; border-radius:4px; min-width:32px; }
    .pix-te-btn.active { background:#2a1f1a; color:${BRAND}; border-color:${BRAND}; }
    .pix-te-italic { font:italic 600 14px serif; }
    .pix-te-align { font:600 12px system-ui; }
    .pix-te-align-icon { display:flex; align-items:center; justify-content:center; padding:6px 0; height:28px; box-sizing:border-box; }
    .pix-te-color-row { display:flex; gap:6px; align-items:center; }
    .pix-te-color-swatch { width:32px; height:32px; border-radius:4px; border:1px solid #444; cursor:pointer; flex:0 0 32px; background:#fff; }
    .pix-te-toggle { flex:1; background:#0d0d0d; color:#aaa; border:1px solid #333; padding:6px; font:11px system-ui; border-radius:4px; cursor:pointer; }
    .pix-te-toggle.active { background:#2a1f1a; color:${BRAND}; border-color:${BRAND}; }
    .pix-te-effect-panel { padding:10px; background:#0d0d0d; border:1px solid #2a2a2a; border-radius:4px; display:flex; flex-direction:column; gap:6px; margin-top:4px; }
  `;
  document.head.appendChild(s);
}
