import { app } from "/scripts/app.js";
import { BRAND, hideJsonWidget, applyAdaptiveCanvasOnly } from "../shared/index.mjs";

// ─────────────────────────────────────────────────────────────────────────
// Seed Pixaroma — a seed source with Random / Fixed modes + buttons.
//
// Architecture mirrors Resolution Pixaroma: Python declares a single `hidden`
// SeedState input (no widget, no slot dot); the on-node UI is a DOM widget and
// state lives on node.properties.seedState (LiteGraph serializes it). The
// app.graphToPrompt hook at the bottom injects the resolved per-run seed.
//
// Behaviour:
//   • Random mode  → each Run rolls a fresh seed; "Last run" shows what ran.
//   • Fixed  mode  → the locked seed is used every Run (repeatable).
//   • New fixed random → roll a new seed and switch to Fixed (locks a roll).
//   • Use last seed    → load the previous run's seed and switch to Fixed.
//   • Copy             → put the current/last seed on the clipboard.
//   • Typing a number in the big field sets that exact seed (switches to Fixed).
// Works in both the Classic and Nodes 2.0 renderers (DOM widget + adaptive
// canvasOnly).
// ─────────────────────────────────────────────────────────────────────────

function injectCSS() {
  if (document.getElementById("pixaroma-seed-css")) return;
  const css = `
    .pix-seed-root {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      color: #ddd;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    /* Big editable seed number. Dark inset box, monospace, brand border on focus. */
    .pix-seed-num {
      width: 100%;
      box-sizing: border-box;
      background: #171819;
      border: 1px solid #3a3d40;
      border-radius: 6px;
      padding: 9px 8px;
      color: #f2f2f2;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
      font-size: 19px;
      text-align: center;
      letter-spacing: 0.5px;
      outline: none;
    }
    .pix-seed-num:focus { border-color: ${BRAND}; }
    /* Random | Fixed segmented pill. Active segment = solid brand. */
    .pix-seed-pill {
      display: flex;
      gap: 0;
      background: rgba(255,255,255,0.06);
      border-radius: 7px;
      padding: 3px;
    }
    .pix-seed-seg {
      flex: 1;
      text-align: center;
      padding: 6px;
      border-radius: 5px;
      font-size: 12px;
      color: rgba(255,255,255,0.55);
      cursor: pointer;
      user-select: none;
      transition: background 0.08s, color 0.08s;
    }
    .pix-seed-seg:hover:not(.active) { color: rgba(255,255,255,0.85); }
    .pix-seed-seg.active {
      background: ${BRAND};
      color: #fff;
      font-weight: 500;
    }
    /* Action buttons — semi-transparent white surface, brand fill on hover
       (matches the Text / Prompt Pack action-button family). */
    .pix-seed-btn {
      box-sizing: border-box;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.85);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      text-align: center;
      transition: background 0.08s, border-color 0.08s, color 0.08s;
    }
    .pix-seed-newrandom { width: 100%; }
    .pix-seed-btn:hover {
      background: ${BRAND};
      border-color: ${BRAND};
      color: #fff;
    }
    .pix-seed-btn:disabled { opacity: 0.4; cursor: default; }
    .pix-seed-btn:disabled:hover {
      background: rgba(255,255,255,0.05);
      border-color: rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.85);
    }
    /* Success flash after Copy — green wins over hover via higher specificity. */
    .pix-seed-btn.is-flashing,
    .pix-seed-btn.is-flashing:hover {
      background: #3ec371;
      border-color: #3ec371;
      color: #fff;
    }
    .pix-seed-row { display: flex; gap: 8px; }
    .pix-seed-uselast { flex: 1; }
    .pix-seed-copy { flex: 0 0 auto; min-width: 64px; }
    .pix-seed-lastrun {
      font-size: 11px;
      color: rgba(255,255,255,0.42);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  const style = document.createElement("style");
  style.id = "pixaroma-seed-css";
  style.textContent = css;
  document.head.appendChild(style);
}
injectCSS();

// Locked node size — the layout is fixed (no reason to resize), which also
// sidesteps the Nodes 2.0 resize-floor handling a draggable DOM node needs.
const NODE_W = 226;
const NODE_H = 264;
const WIDGET_H = NODE_H - 54; // chrome ≈ title + 1 output slot + widget margin

const STATE_PROP = "seedState";
const HIDDEN_INPUT_NAME = "SeedState"; // matches Python INPUT_TYPES key

const DEFAULT_STATE = {
  seed: 0,
  mode: "random", // "random" | "fixed"
  lastSeed: null, // the seed used by the previous run (for "Use last seed")
};

// Roll an exact integer in [0, 2^53) — within JS safe-integer range (so it
// round-trips precisely) and well inside ComfyUI's 0..2^64-1 seed bounds.
function rollSeed() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

function clampSeed(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return n;
}

function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try { return { ...DEFAULT_STATE, ...JSON.parse(v) }; }
    catch { /* fall through */ }
  }
  return { ...DEFAULT_STATE };
}

function writeState(node, state) {
  if (!node.properties) node.properties = {};
  node.properties[STATE_PROP] = JSON.stringify(state);
}

// Fill the "Last run" line for the current state (random: actual last seed;
// fixed: a plain hint so the line keeps a constant height = no layout gap).
function refreshLastRunEl(el, state) {
  if (state.mode === "fixed") {
    el.textContent = "Fixed — same seed every run";
  } else if (state.lastSeed != null) {
    el.textContent = `Last run: ${state.lastSeed}`;
  } else {
    el.textContent = "Last run: — (not run yet)";
  }
}

// Lightweight refresh used by the graphToPrompt hook — updates the last-run
// line + the "Use last seed" disabled state WITHOUT rebuilding the DOM (so an
// in-progress number edit isn't disrupted).
function refreshLastRun(node) {
  const root = node._pixSeedRoot;
  if (!root || !root.isConnected) return;
  const state = readState(node);
  const lr = root.querySelector(".pix-seed-lastrun");
  if (lr) refreshLastRunEl(lr, state);
  const useLast = root.querySelector(".pix-seed-uselast");
  if (useLast) useLast.disabled = state.lastSeed == null;
}

function copySeed(node, btn) {
  const state = readState(node);
  // Copy the seed that's meaningful right now: in Random mode that's the
  // seed that actually ran last (to reproduce the current image); otherwise
  // the locked value.
  const val = state.mode === "random" && state.lastSeed != null ? state.lastSeed : state.seed;
  const text = String(clampSeed(val));
  const flash = (ok) => {
    btn.classList.toggle("is-flashing", ok);
    btn.textContent = ok ? "Copied" : "No clipboard";
    setTimeout(() => { btn.classList.remove("is-flashing"); btn.textContent = "Copy"; }, 700);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => flash(true)).catch(() => flash(false));
  } else {
    flash(false);
  }
}

function renderUI(node) {
  const state = readState(node);
  let root = node._pixSeedRoot;
  if (!root || !root.isConnected) {
    // Vue may have detached the original element — re-find via the DOM widget.
    const w = (node.widgets || []).find((x) => x.name === "seed_ui");
    if (w?.element?.isConnected) {
      const found = w.element.querySelector(".pix-seed-root");
      if (found) { node._pixSeedRoot = found; root = found; }
      else {
        root = document.createElement("div");
        root.className = "pix-seed-root";
        w.element.appendChild(root);
        node._pixSeedRoot = root;
      }
    } else {
      return; // nothing to render into yet
    }
  }

  root.innerHTML = "";

  // ── big editable seed number ──────────────────────────────────
  const num = document.createElement("input");
  num.type = "text";
  num.spellcheck = false;
  num.autocomplete = "off";
  num.inputMode = "numeric";
  num.className = "pix-seed-num";
  num.value = String(state.seed);
  num.title = "The seed value. Type a number to set an exact seed (switches to Fixed).";
  const commitNum = () => {
    const v = clampSeed(num.value.replace(/[^\d]/g, ""));
    const cur = readState(node);
    writeState(node, { ...cur, seed: v, mode: "fixed" });
    renderUI(node);
  };
  num.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep ComfyUI canvas shortcuts from firing while typing
    if (e.key === "Enter") { e.preventDefault(); num.blur(); }
  });
  num.addEventListener("blur", commitNum);
  root.appendChild(num);

  // ── Random | Fixed pill ───────────────────────────────────────
  const pill = document.createElement("div");
  pill.className = "pix-seed-pill";
  for (const [m, label] of [["random", "Random"], ["fixed", "Fixed"]]) {
    const seg = document.createElement("div");
    seg.className = "pix-seed-seg" + (state.mode === m ? " active" : "");
    seg.textContent = label;
    seg.title = m === "random"
      ? "Roll a new random seed every run."
      : "Keep the same seed every run (repeatable result).";
    seg.addEventListener("click", () => {
      const cur = readState(node);
      if (cur.mode === m) return;
      writeState(node, { ...cur, mode: m });
      renderUI(node);
    });
    pill.appendChild(seg);
  }
  root.appendChild(pill);

  // ── New fixed random ──────────────────────────────────────────
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "pix-seed-btn pix-seed-newrandom";
  newBtn.textContent = "New fixed random";
  newBtn.title = "Roll a brand-new random seed and lock it (switches to Fixed).";
  newBtn.addEventListener("click", () => {
    const cur = readState(node);
    writeState(node, { ...cur, seed: rollSeed(), mode: "fixed" });
    renderUI(node);
  });
  root.appendChild(newBtn);

  // ── Use last seed · Copy ──────────────────────────────────────
  const row = document.createElement("div");
  row.className = "pix-seed-row";

  const useLast = document.createElement("button");
  useLast.type = "button";
  useLast.className = "pix-seed-btn pix-seed-uselast";
  useLast.textContent = "Use last seed";
  useLast.title = "Load the seed from the previous run and lock it (Fixed).";
  useLast.disabled = state.lastSeed == null;
  useLast.addEventListener("click", () => {
    const cur = readState(node);
    if (cur.lastSeed == null) return;
    writeState(node, { ...cur, seed: clampSeed(cur.lastSeed), mode: "fixed" });
    renderUI(node);
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "pix-seed-btn pix-seed-copy";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy the current seed to the clipboard.";
  copyBtn.addEventListener("click", () => copySeed(node, copyBtn));

  row.append(useLast, copyBtn);
  root.appendChild(row);

  // ── last-run line ─────────────────────────────────────────────
  const lr = document.createElement("div");
  lr.className = "pix-seed-lastrun";
  refreshLastRunEl(lr, state);
  root.appendChild(lr);
}

function setupSeedNode(node) {
  // Defensive: hide any SeedState widget (none exists with the hidden input).
  hideJsonWidget(node.widgets, HIDDEN_INPUT_NAME);

  node.resizable = false;
  node.size = [NODE_W, NODE_H];

  const root = document.createElement("div");
  root.className = "pix-seed-root";
  const _widget = node.addDOMWidget("seed_ui", "pixaroma_seed", root, {
    getValue: () => readState(node),
    setValue: () => {},
    getMinHeight: () => WIDGET_H,
    getMaxHeight: () => WIDGET_H,
    margin: 4,
    serialize: false, // state lives on node.properties, not this widget
  });
  applyAdaptiveCanvasOnly(_widget);
  node._pixSeedRoot = root;

  // Deferred initial render — nodeCreated fires BEFORE configure() restores a
  // saved workflow's properties (Vue Compat #8). A fresh node (no saved state)
  // gets a random starting seed so the big number isn't a lonely 0; a restored
  // node already has seedState so we leave it untouched (no dirty-on-load).
  queueMicrotask(() => {
    if (!node.properties?.[STATE_PROP]) {
      writeState(node, { ...DEFAULT_STATE, seed: rollSeed() });
    }
    renderUI(node);
  });
}

app.registerExtension({
  name: "Pixaroma.Seed",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaSeed") return;

    // Re-render when a different workflow is configured into an existing node.
    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = _origConfigure?.apply(this, arguments);
      if (this._pixSeedRoot) renderUI(this);
      return r;
    };

    // Lock the size on every resize attempt (constant value → never dirties a
    // saved workflow per Vue Compat #18).
    const _origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      this.size[0] = NODE_W;
      this.size[1] = NODE_H;
      if (_origResize) return _origResize.call(this, size);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== "PixaromaSeed") return;
    setupSeedNode(node);
  },
});

// ── Inject the resolved per-run seed into the API prompt ──────────────────
// Python's hidden SeedState input gets no value from the workflow JSON (no
// widget). On each graphToPrompt (≈ once per Run) we roll a fresh seed for
// Random-mode nodes, record it as the last-run seed, and inject it. Fixed-mode
// nodes inject their locked value (constant → ComfyUI caches → repeatable).
//
// Subgraph-safe: identify entries by class_type and resolve the live node via
// a recursive walk (composite ids like "5:12"), same as Resolution Pixaroma.
// NOTE: graphToPrompt also runs for non-queue actions (e.g. "Save (API
// format)"); a spurious extra roll there only bumps the cosmetic last-run
// readout — harmless.
function buildSeedNodeIndex() {
  const index = new Map(); // String(node.id) → node
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === "PixaromaSeed" || n.type === "PixaromaSeed") {
        index.set(String(n.id), n);
      }
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findSeedNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== "PixaromaSeed") continue;
        if (!index) index = buildSeedNodeIndex();
        const node = findSeedNode(index, id);
        let runSeed = 0;
        if (node) {
          const st = readState(node);
          if (st.mode === "random") {
            runSeed = rollSeed();
            writeState(node, { ...st, lastSeed: runSeed });
            refreshLastRun(node);
          } else {
            runSeed = clampSeed(st.seed);
            if (st.lastSeed !== runSeed) {
              writeState(node, { ...st, lastSeed: runSeed });
              refreshLastRun(node);
            }
          }
        }
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify({ runSeed });
      }
    }
  } catch (e) {
    console.warn("[PixaromaSeed] graphToPrompt inject failed", e);
  }
  return result;
};
