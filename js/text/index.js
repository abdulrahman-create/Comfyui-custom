import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// Text Pixaroma — bigger default size so the multi-line text field has
// enough room out of the box for typical prompts. Users can drag the
// corner to make it bigger or smaller; the textarea fills whatever
// space the node has.
//
// Action row (Copy / Paste / Clear) is painted onto the canvas on the
// SAME Y as the output slot row, so the buttons cost zero extra
// vertical space (Image Compare Pixaroma pattern, see Vue Compat #16).

const DEFAULT_W = 400;
const DEFAULT_H = 220;

// Button geometry — matches Image Compare's row 1 (same Y as the slot row,
// same width + height) so the visual rhythm across Pixaroma nodes stays
// consistent. Labels are deliberately explicit:
//   - "Copy all"  reminds users this copies the WHOLE textarea, not just
//                 the selected text (native Ctrl+C does the latter).
//   - "Replace"   makes the destructive nature obvious - clipboard text
//                 REPLACES the entire textarea content (not insert-at-
//                 cursor). Pairs with the "Nothing to paste" toast.
//   - "Clear"     instant wipe, no confirm (matches user request).
const BTN_W = 56;
const BTN_H = 18;
const BTN_GAP = 3;
const BTN_LEFT = 14;
const BTN_Y = 10;
const BTN_LABELS = ["Copy all", "Replace", "Clear"];

// Minimum node size so the three action buttons + the output "text" label
// always have non-overlapping room. OUTPUT_LABEL_RESERVE leaves space for
// the slot label ("text") + dot + LiteGraph's right padding. MIN_H keeps
// the textarea readable below the button row.
const OUTPUT_LABEL_RESERVE = 64;
const MIN_W = BTN_LEFT + 3 * BTN_W + 2 * BTN_GAP + OUTPUT_LABEL_RESERVE;
const MIN_H = 100;

function btnRect(i) {
  return { x: BTN_LEFT + i * (BTN_W + BTN_GAP), y: BTN_Y, w: BTN_W, h: BTN_H };
}
function inside(pos, r) {
  return pos[0] >= r.x && pos[0] <= r.x + r.w && pos[1] >= r.y && pos[1] <= r.y + r.h;
}

function paintBtn(ctx, r, label, hover, flash) {
  // Default state uses semi-transparent WHITE overlay rather than a fixed
  // dark grey, so the buttons adapt automatically when the user changes
  // the node colour via right-click -> Colors. On the default dark Pixaroma
  // body they look subtly raised; on lighter custom colours they blend the
  // other way as a recessed shape. Hover (BRAND orange) and the success
  // flash (green) stay opaque - they are deliberate high-contrast states.
  ctx.fillStyle = flash ? "#3ec371" : (hover ? BRAND : "rgba(255,255,255,0.04)");
  ctx.strokeStyle = flash ? "#3ec371" : (hover ? BRAND : "rgba(255,255,255,0.12)");
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 3);
  else ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = (flash || hover) ? "#fff" : "rgba(255,255,255,0.65)";
  ctx.font = "9px 'Segoe UI',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

function getTextWidget(node) {
  return (node.widgets || []).find((w) => w.name === "text");
}

function toast(severity, msg) {
  const t = app.extensionManager?.toast;
  if (t?.add) t.add({ severity, summary: "Text Pixaroma", detail: msg, life: 2000 });
  else console.warn("[PixaromaText]", msg);
}

// Write text into the widget AND force the DOM textarea to refresh. Setting
// widget.value alone is not reliable across all Comfy builds — some leave the
// DOM textarea showing the old value until the user clicks into it. We mirror
// to inputEl.value and dispatch an `input` event so any framework listeners
// (Vue / native serialise on change) pick the new value up.
function setTextValue(node, text) {
  const w = getTextWidget(node);
  if (!w) return;
  w.value = text;
  if (w.inputEl) {
    w.inputEl.value = text;
    try { w.inputEl.dispatchEvent(new Event("input", { bubbles: true })); }
    catch (_e) { /* ignore in non-DOM contexts */ }
  }
  node.setDirtyCanvas(true, true);
}

function flashButton(node, idx) {
  node._pixTxtFlash = idx;
  node.setDirtyCanvas(true, true);
  setTimeout(() => {
    if (node._pixTxtFlash === idx) {
      node._pixTxtFlash = null;
      node.setDirtyCanvas(true, true);
    }
  }, 700);
}

async function copyText(node) {
  const w = getTextWidget(node);
  const txt = w?.value || "";
  if (!txt) { toast("info", "Nothing to copy"); return; }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard not available");
    await navigator.clipboard.writeText(txt);
    flashButton(node, 0);
  } catch (err) {
    console.warn("[PixaromaText] copy failed", err);
    toast("warn", "Could not copy to clipboard");
  }
}

async function pasteText(node) {
  try {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard read not available");
    const txt = await navigator.clipboard.readText();
    // Empty string covers BOTH "clipboard is empty" AND "clipboard has only
    // an image / file" (Chrome returns "" in both cases; Firefox throws
    // which lands us in the catch block below). Either way there is no
    // text to paste - bail out instead of wiping the existing textarea.
    if (!txt) {
      toast("info", "Nothing to paste");
      return;
    }
    setTextValue(node, txt);
    flashButton(node, 1);
  } catch (err) {
    console.warn("[PixaromaText] paste failed", err);
    toast("warn", "Could not paste from clipboard");
  }
}

function clearText(node) {
  setTextValue(node, "");
  flashButton(node, 2);
}

app.registerExtension({
  name: "Pixaroma.Text",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaText") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      // Apply default size SYNCHRONOUSLY. configure() runs AFTER
      // onNodeCreated (Vue Compat #8) and restores the saved size on
      // workflow reload AND node duplication, which is exactly what we
      // want. A previous queueMicrotask wrap fired AFTER configure()
      // and clobbered the restored size with the default, so a
      // user-resized node snapped back to big on tab switch / duplicate.
      // Mutate the existing array (not replace) to play nicely with
      // any reactive proxy ComfyUI's Vue frontend may have on node.size.
      this.size[0] = DEFAULT_W;
      this.size[1] = DEFAULT_H;
      this.setDirtyCanvas(true, true);
    };

    // Clamp manual resize. Vue Compat #13 - onResize is unreliable for
    // some DOM-widget resizes, and Align Pixaroma writes node.size
    // directly bypassing the hook (Align Pattern #6), so the self-heal
    // in onDrawForeground below is the actual guarantee. onResize is
    // the primary path; the draw clamp catches everything else.
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (origResize) origResize.apply(this, arguments);
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;
    };

    // Paint Copy / Paste / Clear buttons on the same Y as the output slot
    // row so they cost zero extra vertical space (Vue Compat #16, mirrors
    // Image Compare's row-1 buttons). Hover state comes free from reading
    // app.canvas.graph_mouse inside the draw call (LiteGraph redraws on
    // every pointermove, so the hover check is per-frame at no extra cost).
    const origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (origDraw) origDraw.call(this, ctx);
      if (this.flags?.collapsed) return;

      // Self-heal min size on every paint (Preview Image Pattern #11).
      // Cheap, single comparison, ensures the buttons never collide with
      // the output label even if some other code path bypasses onResize.
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
      if (this.size[1] < MIN_H) this.size[1] = MIN_H;

      const gm = app.canvas?.graph_mouse;
      let hoverIdx = -1;
      if (gm) {
        const mx = gm[0] - this.pos[0];
        const my = gm[1] - this.pos[1];
        for (let i = 0; i < 3; i++) {
          if (inside([mx, my], btnRect(i))) { hoverIdx = i; break; }
        }
      }
      const flashIdx = this._pixTxtFlash;
      ctx.save();
      for (let i = 0; i < 3; i++) {
        paintBtn(ctx, btnRect(i), BTN_LABELS[i], hoverIdx === i, flashIdx === i);
      }
      ctx.restore();
    };

    const origDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (e, pos) {
      for (let i = 0; i < 3; i++) {
        if (inside(pos, btnRect(i))) {
          if (i === 0) copyText(this);
          else if (i === 1) pasteText(this);
          else if (i === 2) clearText(this);
          return true;
        }
      }
      return origDown ? origDown.call(this, e, pos) : false;
    };
  },
});
