// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Text Render (browser canvas)                       ║
// ║  Pure function: renderTextLayer(ctx, layerCfg).              ║
// ║  Mirror of nodes/_text_render_helpers.py::render_text_layer. ║
// ║  Math doc (single source of truth): docs/text-overlay-render.md ║
// ╚═══════════════════════════════════════════════════════════════╝

import { loadFontForLayer, canvasFontString } from "./fonts.mjs";

/** Render one text layer onto the provided 2D canvas context.
 *  Async because font must be loaded first; resolves when drawing is complete.
 *
 *  @param {CanvasRenderingContext2D} ctx
 *  @param {Object} layer  see docs/superpowers/specs/2026-05-18-text-overlay-pixaroma-design.md
 */
export async function renderTextLayer(ctx, layer) {
  if (!layer || layer.visible === false) return;

  const variant = await loadFontForLayer(layer.font, layer.weight || 400, !!layer.italic);

  // Effective scale: pick the larger axis as the rendering scale so the text
  // is rendered at its native resolution (vector → sharp) on at least one axis.
  // Anisotropic stretching is then a post-render scale applied to the smaller
  // axis only. Cap at >= 1 so DOWNSCALING isn't done at render time (rasters
  // downscale fine — we use post-scale for those instead).
  const absX = Math.abs(layer.scaleX ?? 1);
  const absY = Math.abs(layer.scaleY ?? 1);
  const renderScale = Math.max(1, absX, absY);
  const effFontSize = layer.fontSize * renderScale;
  const fontStr = canvasFontString(variant, effFontSize);
  const lineHeightPx = Math.round(effFontSize * (layer.lineHeight ?? 1.2));
  const letterSpacing = (layer.letterSpacing ?? 0) * renderScale;
  const lines = String(layer.text ?? "").split("\n");

  // Measure each line + font metrics
  ctx.save();
  ctx.font = fontStr;
  const lineWidths = lines.map((line) => measureLine(ctx, line, letterSpacing));
  const maxLineW = Math.max(0, ...lines.length ? lineWidths : [0]);
  // Sample metrics from "Mg" (covers uppercase ascender + lowercase descender)
  const metrics = ctx.measureText("Mg");
  const ascender = metrics.actualBoundingBoxAscent || effFontSize * 0.78;
  const descender = metrics.actualBoundingBoxDescent || effFontSize * 0.22;
  ctx.restore();

  // bbox height = visible glyph extent (ascender + descender) for the first
  // line, plus lineHeightPx spacing per additional line. This makes the
  // selection contour wrap the visible text rather than the leaded box.
  let bboxW = maxLineW;
  let bboxH = ascender + descender + Math.max(0, lines.length - 1) * lineHeightPx;
  const padX = layer.background ? (layer.background.paddingX ?? 12) * renderScale : 0;
  const padY = layer.background ? (layer.background.paddingY ?? 8) * renderScale : 0;
  bboxW += 2 * padX;
  bboxH += 2 * padY;

  // Off-screen scratch canvas (for opacity + rotation passes)
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.ceil(bboxW));
  scratch.height = Math.max(1, Math.ceil(bboxH));
  const sctx = scratch.getContext("2d");

  // Synthesized italic skew (applied to whole scratch)
  if (variant.synthesizedItalic) {
    sctx.setTransform(1, 0, -Math.tan((12 * Math.PI) / 180), 1, 0, 0);
  }

  // 1. Background pill (radius scaled by renderScale to stay proportional)
  if (layer.background) {
    const r = Math.min((layer.background.radius ?? 6) * renderScale, bboxW / 2, bboxH / 2);
    sctx.save();
    sctx.fillStyle = withAlpha(layer.background.color, layer.background.opacity ?? 1);
    roundRect(sctx, 0, 0, bboxW, bboxH, r);
    sctx.fill();
    sctx.restore();
  }

  // 2. Shadow (rendered to a 3rd canvas so it can be blurred without affecting fill).
  // All px-values (offset, blur) scaled by renderScale.
  if (layer.shadow) {
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = scratch.width;
    shadowCanvas.height = scratch.height;
    const shctx = shadowCanvas.getContext("2d");
    shctx.font = fontStr;
    shctx.textBaseline = "alphabetic";
    shctx.fillStyle = layer.shadow.color;
    const shOffX = (layer.shadow.offsetX ?? 0) * renderScale;
    const shOffY = (layer.shadow.offsetY ?? 0) * renderScale;
    for (let i = 0; i < lines.length; i++) {
      const lx = lineOriginX(layer.align, padX, maxLineW, lineWidths[i]) + shOffX;
      const ly = padY + ascender + i * lineHeightPx + shOffY;
      drawLine(shctx, lines[i], lx, ly, letterSpacing, /*stroke=*/ false);
    }
    sctx.save();
    sctx.filter = `blur(${(layer.shadow.blur ?? 8) * renderScale}px)`;
    sctx.globalAlpha = layer.shadow.opacity ?? 1;
    sctx.drawImage(shadowCanvas, 0, 0);
    sctx.restore();
  }

  // 3. Stroke (width scaled by renderScale)
  if (layer.stroke) {
    sctx.save();
    sctx.font = fontStr;
    sctx.textBaseline = "alphabetic";
    sctx.strokeStyle = layer.stroke.color;
    sctx.lineWidth = layer.stroke.width * renderScale;
    sctx.lineJoin = "round";
    for (let i = 0; i < lines.length; i++) {
      const lx = lineOriginX(layer.align, padX, maxLineW, lineWidths[i]);
      const ly = padY + ascender + i * lineHeightPx;
      drawLine(sctx, lines[i], lx, ly, letterSpacing, /*stroke=*/ true);
    }
    sctx.restore();
  }

  // 4. Fill
  sctx.save();
  sctx.font = fontStr;
  sctx.textBaseline = "alphabetic";
  sctx.fillStyle = layer.color || "#FFFFFF";
  for (let i = 0; i < lines.length; i++) {
    const lx = lineOriginX(layer.align, padX, maxLineW, lineWidths[i]);
    const ly = padY + ascender + i * lineHeightPx;
    drawLine(sctx, lines[i], lx, ly, letterSpacing, /*stroke=*/ false);
  }
  sctx.restore();

  // Final composite. The scratch is already rendered at renderScale; we only
  // post-scale by (scaleX/renderScale, scaleY/renderScale) which is (1,1) for
  // uniform scale (sharp), or anisotropic for stretch (Y axis blurs when
  // scaleY < scaleX, X axis blurs when scaleX < scaleY — accepted because
  // stretching a typeface is inherently a distortion).
  const sX = (layer.scaleX ?? 1) / renderScale * (layer.flippedX ? -1 : 1);
  const sY = (layer.scaleY ?? 1) / renderScale * (layer.flippedY ? -1 : 1);
  const scaledW = bboxW * Math.abs(sX);
  const scaledH = bboxH * Math.abs(sY);

  ctx.save();
  if (layer.blendMode && layer.blendMode !== "Normal") {
    const op = blendModeToComposite(layer.blendMode);
    if (op) ctx.globalCompositeOperation = op;
  }
  if (layer.blur && layer.blur > 0) {
    ctx.filter = `blur(${layer.blur}px)`;
  }
  ctx.translate(layer.x + scaledW / 2, layer.y + scaledH / 2);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(sX, sY);
  ctx.translate(-bboxW / 2, -bboxH / 2);
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

// Map CSS-named blend modes (matches the framework's createLayerPanel list)
// to canvas globalCompositeOperation strings.
function blendModeToComposite(mode) {
  const map = {
    "Normal": "source-over",
    "Multiply": "multiply",
    "Screen": "screen",
    "Overlay": "overlay",
    "Darken": "darken",
    "Lighten": "lighten",
    "Color Dodge": "color-dodge",
    "Color Burn": "color-burn",
    "Hard Light": "hard-light",
    "Soft Light": "soft-light",
    "Difference": "difference",
    "Exclusion": "exclusion",
    "Hue": "hue",
    "Saturation": "saturation",
    "Color": "color",
    "Luminosity": "luminosity",
  };
  return map[mode];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function measureLine(ctx, text, letterSpacing) {
  if (letterSpacing === 0) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width;
  return w + Math.max(0, text.length - 1) * letterSpacing;
}

function drawLine(ctx, text, x, y, letterSpacing, stroke) {
  if (letterSpacing === 0) {
    if (stroke) ctx.strokeText(text, x, y);
    else ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    if (stroke) ctx.strokeText(ch, cx, y);
    else ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + letterSpacing;
  }
}

function lineOriginX(align, padX, maxLineW, lineW) {
  if (align === "right") return padX + (maxLineW - lineW);
  if (align === "center") return padX + (maxLineW - lineW) / 2;
  return padX; // left (default)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
