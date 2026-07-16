// Notify Pixaroma - floating "Notify time history" panel. Same floating-panel
// pattern as the Run Timer history (js/run_timer/history.mjs) and the Seed
// history: a themed panel beside the node, draggable by its header, closes on
// outside-click / Esc. Unlike the Run Timer's GLOBAL history, this list is
// PER-NODE - it shows the last N times THIS Notify node was reached during a
// run (a workflow can hold many Notify checkpoints, each with its own list).
// The fastest is marked with a lightning bolt so you can see the quickest time
// to reach this checkpoint at a glance. Per-row Copy, plus Export .txt / Clear.
//
// Self-contained: index.js passes a ctx so this module needs no import back:
//   ctx = { getHistory() -> {ms,name,at}[], clearHistory(),
//           copyToClipboard(text, flash) }

import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function pad(n, l) { n = String(n); while (n.length < l) n = "0" + n; return n; }

// mm:ss.mmm always (millisecond precision so comparisons are meaningful).
// Past an hour -> h:mm:ss.mmm. Exported so index.js reuses it for the on-node
// readout, keeping the two displays identical.
export function fmtDur(ms) {
  ms = Math.max(0, Math.floor(Number(ms) || 0));
  const mmm = pad(ms % 1000, 3);
  const totalS = Math.floor(ms / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  if (h > 0) return h + ":" + pad(m, 2) + ":" + pad(s, 2) + "." + mmm;
  return pad(m, 2) + ":" + pad(s, 2) + "." + mmm;
}
// epoch ms -> HH:MM (24h, local). "" if invalid.
function fmtClock(at) {
  const t = Number(at);
  if (!isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2);
}
// One text line for Copy / Export: "checkpoint A - 14:32 - 02:47.318".
function lineFor(r) {
  const name = (r && r.name) || "Notify";
  const clock = fmtClock(r && r.at);
  return name + (clock ? " - " + clock : "") + " - " + fmtDur(r && r.ms);
}

let _cssDone = false;
function injectCSS() {
  if (_cssDone || document.getElementById("pix-nt-hist-css")) { _cssDone = true; return; }
  _cssDone = true;
  const s = document.createElement("style");
  s.id = "pix-nt-hist-css";
  s.textContent = [
    ".pix-nt-hpanel{position:fixed;z-index:10010;width:340px;max-width:94vw;max-height:70vh;display:flex;flex-direction:column;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    ".pix-nt-hhead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;flex:0 0 auto;}",
    ".pix-nt-hx{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-nt-hx:hover{color:#fff;}",
    ".pix-nt-hlist{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;flex:1 1 auto;}",
    ".pix-nt-hempty{color:#8f8f8f;font-size:12px;text-align:center;line-height:1.5;padding:22px 12px;}",
    ".pix-nt-hrow{display:flex;align-items:center;gap:8px;background:#1d1d1d;border:1px solid #333;border-radius:6px;padding:6px 8px;}",
    ".pix-nt-hidx{flex:0 0 auto;color:#6f6f6f;font-size:10px;min-width:15px;text-align:right;}",
    ".pix-nt-hmeta{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}",
    ".pix-nt-hname{font-size:12px;color:#e6e6e6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".pix-nt-hclock{font-size:10px;color:#7f7f7f;}",
    ".pix-nt-hdurwrap{flex:0 0 auto;display:flex;align-items:center;gap:4px;}",
    ".pix-nt-hfast{font-size:12px;line-height:1;}",
    ".pix-nt-hdur{font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#f2f2f2;font-variant-numeric:tabular-nums;}",
    ".pix-nt-hrow.is-fast .pix-nt-hdur{color:" + BRAND + ";}",
    ".pix-nt-hbtn{flex:0 0 auto;padding:4px 10px;border-radius:5px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.85);font-size:11px;cursor:pointer;font-family:inherit;transition:background .08s,border-color .08s,color .08s;}",
    ".pix-nt-hbtn:hover{background:" + BRAND + ";border-color:" + BRAND + ";color:#fff;}",
    ".pix-nt-hbtn.is-flashing,.pix-nt-hbtn.is-flashing:hover{background:#3ec371;border-color:#3ec371;color:#fff;}",
    ".pix-nt-hfoot{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #333;flex:0 0 auto;}",
    ".pix-nt-hfbtn{flex:1;padding:7px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.85);font-size:12px;cursor:pointer;font-family:inherit;transition:background .08s,border-color .08s,color .08s;}",
    ".pix-nt-hfbtn:hover{background:" + BRAND + ";border-color:" + BRAND + ";color:#fff;}",
  ].join("\n");
  document.head.appendChild(s);
}

let _panel = null;
let _panelNode = null;
let _ctx = null;

function outsideClose(e) {
  if (_panel && !_panel.contains(e.target)) closeNotifyHistory();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) { e.stopPropagation(); closeNotifyHistory(); }
}

export function closeNotifyHistory() {
  if (_panel) { try { _panel.remove(); } catch (_e) {} }
  _panel = null;
  _panelNode = null;
  _ctx = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

// onRemoved: only close when the panel belongs to the deleted node.
export function closeNotifyHistoryFor(node) {
  if (_panelNode === node) closeNotifyHistory();
}

// Screen-pixel rect of the node (DOM in Nodes 2.0, geometry math in legacy) so
// the panel opens BESIDE it.
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
  const scale = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = node.size[1] * scale;
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
    if (e.target.closest(".pix-nt-hx")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) { up(); return; }
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

function flashCopy(btn, ok) {
  btn.classList.toggle("is-flashing", ok);
  btn.textContent = ok ? "Copied" : "No clip";
  setTimeout(() => { btn.classList.remove("is-flashing"); btn.textContent = "Copy"; }, 700);
}

function buildList(listEl) {
  listEl.innerHTML = "";
  const runs = (_ctx && _ctx.getHistory && _ctx.getHistory()) || [];
  if (!runs.length) {
    listEl.appendChild(el("div", "pix-nt-hempty", "No times yet. Each Run records how long the workflow took to reach this node (up to 10)."));
    return;
  }
  // fastest (min ms) -> lightning marker; only meaningful with more than one entry.
  let fastest = Infinity;
  for (const r of runs) { const v = Number(r && r.ms); if (isFinite(v) && v < fastest) fastest = v; }
  const markFast = isFinite(fastest) && runs.length > 1;
  runs.forEach((r, i) => {
    const ms = Number(r && r.ms) || 0;
    const name = (r && r.name) || "Notify";
    const clock = fmtClock(r && r.at);
    const isFast = markFast && ms === fastest;
    const row = el("div", "pix-nt-hrow" + (isFast ? " is-fast" : ""));
    row.appendChild(el("div", "pix-nt-hidx", i + 1 + "."));
    const meta = el("div", "pix-nt-hmeta");
    const nm = el("div", "pix-nt-hname", name); nm.title = name;
    meta.appendChild(nm);
    if (clock) meta.appendChild(el("div", "pix-nt-hclock", clock));
    row.appendChild(meta);
    const durWrap = el("div", "pix-nt-hdurwrap");
    if (isFast) { const star = el("span", "pix-nt-hfast", "⚡"); star.title = "Fastest in the list"; durWrap.appendChild(star); }
    durWrap.appendChild(el("div", "pix-nt-hdur", fmtDur(ms)));
    row.appendChild(durWrap);
    const copyBtn = el("button", "pix-nt-hbtn", "Copy");
    copyBtn.type = "button";
    const line = lineFor(r);
    copyBtn.title = "Copy \"" + line + "\" to the clipboard.";
    copyBtn.addEventListener("click", () => {
      if (_ctx && _ctx.copyToClipboard) _ctx.copyToClipboard(line, (ok) => flashCopy(copyBtn, ok));
    });
    row.appendChild(copyBtn);
    listEl.appendChild(row);
  });
}

// Rebuild the list if the panel is open (called after a run records a new time).
export function refreshNotifyHistory() {
  if (!_panel) return;
  const listEl = _panel.querySelector(".pix-nt-hlist");
  if (listEl) buildList(listEl);
}

function exportTxt(runs) {
  // CRLF so the file opens cleanly in Notepad; one time per line.
  const text = runs.map(lineFor).join("\r\n") + "\r\n";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "notify-time-history.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function openNotifyHistory(node, ctx) {
  closeNotifyHistory();
  injectCSS();
  _ctx = ctx;
  const panel = el("div", "pix-nt-hpanel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-nt-hhead");
  head.appendChild(el("span", null, "Notify time history"));
  const x = el("button", "pix-nt-hx", "✕");
  x.type = "button";
  x.onclick = closeNotifyHistory;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head);

  const list = el("div", "pix-nt-hlist");
  buildList(list);
  panel.appendChild(list);

  const foot = el("div", "pix-nt-hfoot");
  const exportBtn = el("button", "pix-nt-hfbtn", "Export .txt");
  exportBtn.type = "button";
  exportBtn.title = "Download this node's time list as a text file.";
  exportBtn.addEventListener("click", () => {
    const runs = (ctx && ctx.getHistory && ctx.getHistory()) || [];
    if (!runs.length) return;
    exportTxt(runs);
  });
  const clearBtn = el("button", "pix-nt-hfbtn", "Clear");
  clearBtn.type = "button";
  clearBtn.title = "Forget this node's remembered times.";
  clearBtn.addEventListener("click", () => {
    if (ctx && ctx.clearHistory) ctx.clearHistory();
    buildList(list);
  });
  foot.append(exportBtn, clearBtn);
  panel.appendChild(foot);

  document.body.appendChild(panel);
  placeBeside(panel, nodeScreenRect(node));
  const _p = panel;
  setTimeout(() => {
    if (_panel !== _p) return; // closed within the same tick
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}
