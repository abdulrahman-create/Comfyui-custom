// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay canvas interaction                             ║
// ║  Adds prototype methods to TextOverlayEditor (mixin pattern). ║
// ╚═══════════════════════════════════════════════════════════════╝

import { TextOverlayEditor } from "./core.mjs";

const HANDLE_SIZE = 10;
const ROT_HANDLE_OFFSET = 25;

TextOverlayEditor.prototype._installInteractions = function () {
  this.canvas.style.cursor = "default";
  this._onCanvasMouseDownBound = (e) => this._onCanvasMouseDown(e);
  this._onMouseMoveBound = (e) => this._onCanvasMouseMove(e);
  this._onMouseUpBound = (e) => this._onCanvasMouseUp(e);
  this._onCanvasDblClickBound = (e) => this._onCanvasDblClick(e);
  this._onKeyDownBound = (e) => this._onKeyDown(e);
  this._onWheelBound = (e) => this._onCanvasWheel(e);

  this.canvas.addEventListener("mousedown", this._onCanvasMouseDownBound);
  window.addEventListener("mousemove", this._onMouseMoveBound);
  window.addEventListener("mouseup", this._onMouseUpBound);
  this.canvas.addEventListener("dblclick", this._onCanvasDblClickBound);
  this.layout.overlay.addEventListener("keydown", this._onKeyDownBound);
  // Wheel on the canvas HOST (not just the canvas) so the listener catches
  // scrolls in the padding area too. passive:false because we always
  // preventDefault to stop page scroll.
  if (this.canvasHost) this.canvasHost.addEventListener("wheel", this._onWheelBound, { passive: false });
  this.layout.overlay.tabIndex = -1;
  this.layout.overlay.focus();
};

TextOverlayEditor.prototype._uninstallInteractions = function () {
  if (this.canvas) this.canvas.removeEventListener("mousedown", this._onCanvasMouseDownBound);
  window.removeEventListener("mousemove", this._onMouseMoveBound);
  window.removeEventListener("mouseup", this._onMouseUpBound);
  if (this.canvas) this.canvas.removeEventListener("dblclick", this._onCanvasDblClickBound);
  if (this.layout?.overlay) this.layout.overlay.removeEventListener("keydown", this._onKeyDownBound);
  if (this.canvasHost && this._onWheelBound) this.canvasHost.removeEventListener("wheel", this._onWheelBound);
};

TextOverlayEditor.prototype._onCanvasWheel = function (e) {
  e.preventDefault();
  // Shift + wheel = resize the SELECTED layer's font size (±5 per tick,
  // ±10 with Alt for finer / coarser stepping). Plain wheel = zoom canvas.
  if (e.shiftKey) {
    const layer = this.layers[this.selectedIndex];
    if (!layer) return;
    const step = e.altKey ? 10 : 5;
    const dir = e.deltaY > 0 ? -1 : 1;
    layer.fontSize = Math.max(8, Math.min(512, (layer.fontSize || 36) + dir * step));
    this._snapshotMaybe();
    this.textPanel.setLayer(layer);
    this.requestRender();
    return;
  }
  // Plain wheel: zoom by 1.1x per tick (in or out depending on direction).
  // Multi-tick (touchpad pinch reports many small ticks) accumulates via factor.
  const factor = Math.exp(-e.deltaY * 0.0015);
  this.zoomBy(factor);
};

TextOverlayEditor.prototype._canvasCoords = function (e) {
  const r = this.canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / this._zoom,
    y: (e.clientY - r.top) / this._zoom,
  };
};

// Approximate bbox using offscreen measureText. Not exact (real bbox uses
// actualBoundingBoxAscent etc. via the async loaded font), but close enough
// for hit-testing and handle placement.
TextOverlayEditor.prototype._layerBbox = function (layer) {
  if (!this._measureCtx) {
    const c = document.createElement("canvas"); c.width = 1; c.height = 1;
    this._measureCtx = c.getContext("2d");
  }
  const ctx = this._measureCtx;
  const fam = `Pix-${layer.font}${layer.italic ? "-Italic" : ""}`;
  ctx.font = `${layer.italic ? "italic " : ""}${layer.weight || 400} ${layer.fontSize}px "${fam}"`;
  const lines = String(layer.text ?? "").split("\n");
  const widths = lines.map((ln) => ctx.measureText(ln).width + Math.max(0, ln.length - 1) * (layer.letterSpacing || 0));
  const lineHeightPx = Math.round(layer.fontSize * (layer.lineHeight || 1.2));
  // Use the actual font glyph extent (ascender + descender via measureText)
  // for the FIRST line height, then add lineHeightPx per additional line.
  // Matches the render-side bbox so the selection contour wraps visible glyphs.
  const m = ctx.measureText("Mg");
  const asc = m.actualBoundingBoxAscent || layer.fontSize * 0.78;
  const desc = m.actualBoundingBoxDescent || layer.fontSize * 0.22;
  let w = Math.max(0, ...widths);
  let h = (asc + desc) + Math.max(0, lines.length - 1) * lineHeightPx;
  if (layer.background) {
    w += 2 * (layer.background.paddingX || 12);
    h += 2 * (layer.background.paddingY || 8);
  }
  const sX = Math.abs(layer.scaleX ?? 1);
  const sY = Math.abs(layer.scaleY ?? 1);
  w *= sX; h *= sY;
  return { x: layer.x, y: layer.y, w: Math.max(20, w), h: Math.max(20, h) };
};

TextOverlayEditor.prototype._inverseRotate = function (px, py, cx, cy, rotDeg) {
  const rad = (-(rotDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: (px - cx) * cos - (py - cy) * sin + cx,
    y: (px - cx) * sin + (py - cy) * cos + cy,
  };
};

TextOverlayEditor.prototype._hitTestLayer = function (px, py) {
  for (let i = this.layers.length - 1; i >= 0; i--) {
    const layer = this.layers[i];
    if (layer.visible === false) continue;
    const b = this._layerBbox(layer);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const p = this._inverseRotate(px, py, cx, cy, layer.rotation);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
  }
  return -1;
};

TextOverlayEditor.prototype._hitTestHandle = function (px, py) {
  const i = this.selectedIndex;
  if (i < 0) return null;
  const layer = this.layers[i];
  const b = this._layerBbox(layer);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const p = this._inverseRotate(px, py, cx, cy, layer.rotation);
  const handles = {
    nw: { x: b.x, y: b.y },
    ne: { x: b.x + b.w, y: b.y },
    sw: { x: b.x, y: b.y + b.h },
    se: { x: b.x + b.w, y: b.y + b.h },
    rot: { x: b.x + b.w / 2, y: b.y - ROT_HANDLE_OFFSET },
  };
  const hs = HANDLE_SIZE / this._zoom;
  for (const [name, hp] of Object.entries(handles)) {
    if (Math.abs(p.x - hp.x) <= hs && Math.abs(p.y - hp.y) <= hs) return name;
  }
  return null;
};

TextOverlayEditor.prototype._onCanvasMouseDown = function (e) {
  if (e.button !== 0) return;
  // Move focus to overlay so keyboard shortcuts work immediately after
  // interacting with the canvas (otherwise Delete deletes a character in
  // whichever input had focus before).
  if (typeof this._focusOverlay === "function") this._focusOverlay();

  const p = this._canvasCoords(e);
  const handle = this._hitTestHandle(p.x, p.y);
  if (handle) {
    this._dragMode = handle === "rot" ? "rotate" : "scale";
    this._dragHandle = handle;
    this._dragOrigin = { x: p.x, y: p.y, layer: { ...this.layers[this.selectedIndex] } };
    this._snapshotMaybe();
    e.preventDefault();
    return;
  }
  const idx = this._hitTestLayer(p.x, p.y);
  if (idx >= 0) {
    this.selectedIndex = idx;
    // Alt+drag duplicates the layer first, then drags the COPY. Matches
    // Photoshop / Figma / Composer convention.
    if (e.altKey) {
      this.duplicateSelected();
      // Selection is now on the new copy; reset drag origin from it.
      this._dragOrigin = { x: p.x, y: p.y, layer: { ...this.layers[this.selectedIndex] } };
    } else {
      this._syncLayerSelection();
      this._rebuildLayersPanel();
      this._dragOrigin = { x: p.x, y: p.y, layer: { ...this.layers[idx] } };
      this._snapshotMaybe();
    }
    this._dragMode = "move";
    this.requestRender();
    e.preventDefault();
  } else {
    if (this.selectedIndex >= 0) {
      this.selectedIndex = -1;
      this._syncLayerSelection();
      this._rebuildLayersPanel();
      this.requestRender();
    }
  }
};

TextOverlayEditor.prototype._onCanvasMouseMove = function (e) {
  if (!this._dragMode) return;
  const p = this._canvasCoords(e);
  const layer = this.layers[this.selectedIndex];
  if (!layer) { this._dragMode = null; return; }
  const origLayer = this._dragOrigin.layer;

  if (this._dragMode === "move") {
    layer.x = origLayer.x + (p.x - this._dragOrigin.x);
    layer.y = origLayer.y + (p.y - this._dragOrigin.y);
    // Snap to canvas alignment points (center, edges, thirds). Shift bypasses.
    if (!e.shiftKey) this._applySnap(layer);
    else this._snapGuides = null;
  } else if (this._dragMode === "scale") {
    const origBox = this._layerBbox(origLayer);
    const cx = origBox.x + origBox.w / 2;
    const cy = origBox.y + origBox.h / 2;
    const origDist = Math.hypot(this._dragOrigin.x - cx, this._dragOrigin.y - cy);
    const newDist = Math.hypot(p.x - cx, p.y - cy);
    const factor = Math.max(0.1, newDist / Math.max(1, origDist));
    layer.fontSize = Math.max(8, Math.round(origLayer.fontSize * factor));
    if (!e.altKey) {
      const newBox = this._layerBbox(layer);
      const opp = { nw: "se", ne: "sw", sw: "ne", se: "nw" }[this._dragHandle];
      const anchors = {
        nw: { x: origBox.x, y: origBox.y },
        ne: { x: origBox.x + origBox.w, y: origBox.y },
        sw: { x: origBox.x, y: origBox.y + origBox.h },
        se: { x: origBox.x + origBox.w, y: origBox.y + origBox.h },
      };
      const newOffsets = {
        nw: { dx: 0, dy: 0 },
        ne: { dx: newBox.w, dy: 0 },
        sw: { dx: 0, dy: newBox.h },
        se: { dx: newBox.w, dy: newBox.h },
      };
      const a = anchors[opp];
      const o = newOffsets[opp];
      layer.x = a.x - o.dx;
      layer.y = a.y - o.dy;
    }
  } else if (this._dragMode === "rotate") {
    const origBox = this._layerBbox(origLayer);
    const cx = origBox.x + origBox.w / 2;
    const cy = origBox.y + origBox.h / 2;
    let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    layer.rotation = Math.round(deg);
  }
  this.textPanel.setLayer(layer);
  this.requestRender();
};

TextOverlayEditor.prototype._onCanvasMouseUp = function () {
  this._dragMode = null;
  this._snapGuides = null;
  this.requestRender();
};

// Snap the layer's x/y so its left, right, center-h aligns with canvas-x snap
// points (0, canvasWidth/2, canvasWidth, canvasWidth/3, 2/3); same for Y.
// Records which guides are active so _drawSelectionOverlay can draw the lines.
TextOverlayEditor.prototype._applySnap = function (layer) {
  const SNAP_PX = 8 / Math.max(0.0001, this._zoom);  // pixel-snap tolerance in canvas-px
  const bbox = this._layerBbox(layer);
  const cw = this.canvasWidth, ch = this.canvasHeight;

  const xTargets = [
    { axis: "x", at: 0,              ref: "L" },          // layer left to canvas left
    { axis: "x", at: cw,             ref: "R" },          // layer right to canvas right
    { axis: "x", at: cw / 2,         ref: "C" },          // layer center to canvas center
    { axis: "x", at: cw / 3,         ref: "T3a" },        // canvas thirds
    { axis: "x", at: cw * 2 / 3,     ref: "T3b" },
  ];
  const yTargets = [
    { axis: "y", at: 0,              ref: "T" },
    { axis: "y", at: ch,             ref: "B" },
    { axis: "y", at: ch / 2,         ref: "M" },
    { axis: "y", at: ch / 3,         ref: "T3a" },
    { axis: "y", at: ch * 2 / 3,     ref: "T3b" },
  ];

  const guides = [];
  // For each X target, compute candidate edges of the layer (L, R, C) and find best snap
  let bestX = null;
  for (const t of xTargets) {
    for (const [edge, val] of [["L", layer.x], ["R", layer.x + bbox.w], ["C", layer.x + bbox.w / 2]]) {
      const d = Math.abs(val - t.at);
      if (d <= SNAP_PX && (!bestX || d < bestX.dist)) {
        bestX = { dist: d, delta: t.at - val, at: t.at };
      }
    }
  }
  let bestY = null;
  for (const t of yTargets) {
    for (const [edge, val] of [["T", layer.y], ["B", layer.y + bbox.h], ["M", layer.y + bbox.h / 2]]) {
      const d = Math.abs(val - t.at);
      if (d <= SNAP_PX && (!bestY || d < bestY.dist)) {
        bestY = { dist: d, delta: t.at - val, at: t.at };
      }
    }
  }
  if (bestX) { layer.x += bestX.delta; guides.push({ axis: "v", at: bestX.at }); }
  if (bestY) { layer.y += bestY.delta; guides.push({ axis: "h", at: bestY.at }); }
  this._snapGuides = guides.length ? guides : null;
};

TextOverlayEditor.prototype._onCanvasDblClick = function (e) {
  const p = this._canvasCoords(e);
  if (this._hitTestLayer(p.x, p.y) < 0) {
    this.addLayer({ x: p.x - 50, y: p.y - 18 });
  }
};

TextOverlayEditor.prototype._onKeyDown = function (e) {
  // Skip when typing in a form field
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;

  // Ctrl/Cmd Z / Y — undo / redo
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
    this.undo(); e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
    this.redo(); e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  // Ctrl/Cmd D — duplicate selected
  if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
    if (this.selectedIndex >= 0) { this.duplicateSelected(); e.preventDefault(); e.stopImmediatePropagation(); }
    return;
  }
  // Ctrl/Cmd ] / [ — bring forward / send backward in z-order (Photoshop convention)
  if ((e.ctrlKey || e.metaKey) && e.key === "]") {
    this.moveSelected(1); e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "[") {
    this.moveSelected(-1); e.preventDefault(); e.stopImmediatePropagation(); return;
  }

  const layer = this.layers[this.selectedIndex];
  if (!layer) return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowLeft") { layer.x -= step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { layer.x += step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { layer.y -= step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "ArrowDown") { layer.y += step; this._snapshotMaybe(); this.textPanel.setLayer(layer); this.requestRender(); e.preventDefault(); }
  else if (e.key === "Delete" || e.key === "Backspace") { this.deleteSelected(); e.preventDefault(); }
};

TextOverlayEditor.prototype._drawSelectionOverlay = function (ctx) {
  const pad = TextOverlayEditor.SEL_PAD;

  // Snap guides (drawn first so selection overlays on top). Only visible
  // while dragging; cleared on mouseup.
  if (this._snapGuides && this._snapGuides.length) {
    ctx.save();
    ctx.translate(pad, pad);
    ctx.strokeStyle = "#f66744";
    ctx.lineWidth = 1 / this._zoom;
    ctx.setLineDash([4 / this._zoom, 4 / this._zoom]);
    for (const g of this._snapGuides) {
      ctx.beginPath();
      if (g.axis === "v") {
        ctx.moveTo(g.at, -pad);
        ctx.lineTo(g.at, this.canvasHeight + pad);
      } else {
        ctx.moveTo(-pad, g.at);
        ctx.lineTo(this.canvasWidth + pad, g.at);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  const idx = this.selectedIndex;
  if (idx < 0) return;
  const layer = this.layers[idx];
  if (!layer || layer.visible === false) return;
  const b = this._layerBbox(layer);
  ctx.save();
  ctx.translate(pad, pad);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  ctx.strokeStyle = "#f66744";
  ctx.lineWidth = 2 / this._zoom;
  ctx.setLineDash([6 / this._zoom, 4 / this._zoom]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);

  const hs = HANDLE_SIZE / this._zoom;
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ];
  ctx.fillStyle = "#f66744";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1 / this._zoom;
  for (const p of corners) {
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
  }

  // Rotation handle (line + circle)
  const rh = { x: cx, y: b.y - ROT_HANDLE_OFFSET };
  ctx.strokeStyle = "#f66744";
  ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(rh.x, rh.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(rh.x, rh.y, hs / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#f66744"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.stroke();

  ctx.restore();
};
