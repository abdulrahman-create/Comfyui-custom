// Seed Pixaroma — floating right-click settings panel (Run Timer / Save Image
// pattern: a free-floating themed panel beside the node, draggable by its
// header, closes on outside click / Esc). Holds: this node's size (Compact /
// Full), the global default size for NEW nodes, and the Random seed-digit cap.
//
// Kept out of index.js to keep that file lean. index.js passes a small ctx so
// this module needs no circular import back into it:
//   ctx = { readState, writeState, applyResize(node), settingId,
//           MIN_DIGITS, MAX_DIGITS, clampDigits }

import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let _cssDone = false;
function injectPanelCSS() {
  if (_cssDone || document.getElementById("pix-seed-panel-css")) {
    _cssDone = true;
    return;
  }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-seed-panel-css";
  s.textContent = [
    ".pix-seed-panel{position:fixed;z-index:10010;width:300px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-seed-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-seed-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-seed-px:hover{color:#fff;}",
    ".pix-seed-pbody{padding:12px;display:flex;flex-direction:column;gap:15px;color:#ddd;}",
    ".pix-seed-prow{display:flex;flex-direction:column;gap:6px;}",
    ".pix-seed-plab{font-size:12px;color:#ddd;font-weight:500;}",
    ".pix-seed-psub{font-size:10px;color:#8f8f8f;line-height:1.45;}",
    ".pix-seed-pseg{display:inline-flex;border:1px solid #444;border-radius:999px;overflow:hidden;align-self:flex-start;}",
    ".pix-seed-pseg button{background:#1d1d1d;color:#aaa;border:none;padding:5px 15px;font-size:12px;cursor:pointer;font-family:inherit;}",
    ".pix-seed-pseg button.on{background:" + BRAND + ";color:#fff;font-weight:500;}",
    ".pix-seed-pinline{display:flex;align-items:center;gap:10px;}",
    ".pix-seed-pslider{flex:1;min-width:0;accent-color:" + BRAND + ";}",
    ".pix-seed-pval{font-size:13px;color:" + BRAND + ";min-width:22px;text-align:right;font-weight:500;}",
  ].join("\n");
  document.head.appendChild(s);
}

let _panel = null;
let _panelNode = null;

function outsideClose(e) {
  if (_panel && !_panel.contains(e.target)) closeSeedSettings();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSeedSettings();
  }
}

export function closeSeedSettings() {
  if (_panel) {
    try {
      _panel.remove();
    } catch {}
  }
  _panel = null;
  _panelNode = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

// onRemoved: only close when the panel belongs to the deleted node.
export function closeSeedSettingsFor(node) {
  if (_panelNode === node) closeSeedSettings();
}

// Screen-pixel rect of the node (DOM in Nodes 2.0, geometry math in legacy) so
// the panel opens BESIDE the node instead of over it.
function nodeScreenRect(node) {
  const vue = !!window.LiteGraph?.vueNodesMode;
  if (vue && node && node.id != null) {
    const elx = document.querySelector('[data-node-id="' + node.id + '"]');
    if (elx) return elx.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const canvasEl = c && c.canvas;
  if (!ds || !canvasEl || !node || !node.pos || !node.size) return null;
  const cr = canvasEl.getBoundingClientRect();
  const titleH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
  const scale = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = (node.size[1] + titleH) * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mw = panel.offsetWidth;
  const mh = panel.offsetHeight;
  const gap = 12;
  const pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}

function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pix-seed-px")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) {
        up();
        return;
      }
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}

// A two-button Compact | Full segmented control. getVal() -> boolean (compact),
// onPick(bool) applies the change.
function sizeSeg(getCompact, onPick) {
  const seg = el("div", "pix-seed-pseg");
  const opts = [
    { compact: false, label: "Full" },
    { compact: true, label: "Compact" },
  ];
  const btns = opts.map((o) => {
    const b = el("button", null, o.label);
    b.type = "button";
    b.classList.toggle("on", !!getCompact() === o.compact);
    b.addEventListener("click", () => {
      onPick(o.compact);
      btns.forEach((x, i) => x.classList.toggle("on", opts[i].compact === o.compact));
    });
    seg.appendChild(b);
    return b;
  });
  return seg;
}

export function openSeedSettings(node, ctx) {
  closeSeedSettings();
  injectPanelCSS();
  const panel = el("div", "pix-seed-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-seed-phead");
  head.appendChild(el("span", null, "Seed settings"));
  const x = el("button", "pix-seed-px", "✕");
  x.type = "button";
  x.onclick = closeSeedSettings;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);

  const body = el("div", "pix-seed-pbody");

  // ── This node: Compact / Full ──
  const r1 = el("div", "pix-seed-prow");
  r1.appendChild(el("div", "pix-seed-plab", "This node"));
  r1.appendChild(
    sizeSeg(
      () => !!ctx.readState(node).compact,
      (compact) => {
        const st = ctx.readState(node);
        if (!!st.compact === compact) return;
        ctx.writeState(node, { ...st, compact });
        ctx.applyResize(node);
      }
    )
  );
  r1.appendChild(el("div", "pix-seed-psub", "Compact shrinks this node to a single row: the seed, a small Random/Fixed toggle, and a copy button."));
  body.appendChild(r1);

  // ── New Seed nodes (global default) ──
  const r2 = el("div", "pix-seed-prow");
  r2.appendChild(el("div", "pix-seed-plab", "New Seed nodes"));
  r2.appendChild(
    sizeSeg(
      () => !!app.ui?.settings?.getSettingValue?.(ctx.settingId),
      (compact) => {
        app.ui?.settings?.setSettingValueAsync?.(ctx.settingId, compact);
      }
    )
  );
  r2.appendChild(el("div", "pix-seed-psub", "The size every NEW Seed node starts at. Saved globally, the same as ComfyUI Settings > Pixaroma > Seed."));
  body.appendChild(r2);

  // ── Random seed digits ──
  const r3 = el("div", "pix-seed-prow");
  r3.appendChild(el("div", "pix-seed-plab", "Random seed digits"));
  const inline = el("div", "pix-seed-pinline");
  const sl = el("input", "pix-seed-pslider");
  sl.type = "range";
  sl.min = String(ctx.MIN_DIGITS);
  sl.max = String(ctx.MAX_DIGITS);
  sl.step = "1";
  sl.value = String(ctx.clampDigits(ctx.readState(node).digits));
  const val = el("span", "pix-seed-pval", sl.value);
  inline.append(sl, val);
  r3.appendChild(inline);
  const sub = el("div", "pix-seed-psub", "");
  const describe = (d) => {
    d = ctx.clampDigits(d);
    if (d >= ctx.MAX_DIGITS) return "Full range (up to 16 digits). This is the default.";
    const max = Math.pow(10, d) - 1;
    return "Random seeds get up to " + d + " digits (0 to " + max.toLocaleString() + "). Typing an exact seed still works.";
  };
  sub.textContent = describe(sl.value);
  r3.appendChild(sub);
  sl.addEventListener("input", () => {
    const d = ctx.clampDigits(sl.value);
    val.textContent = String(d);
    sub.textContent = describe(d);
    const st = ctx.readState(node);
    ctx.writeState(node, { ...st, digits: d });
  });
  body.appendChild(r3);

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, nodeScreenRect(node));
  const _p = panel;
  setTimeout(() => {
    if (_panel !== _p) return; // closed within the same tick
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}
