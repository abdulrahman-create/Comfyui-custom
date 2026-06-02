import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { getState, setGate, STATE_PROP } from "./state.mjs";
import {
  buildPauseWidget, renderPause, showFrame, NODE_MIN_W, NODE_MIN_H,
} from "./ui.mjs";

const CLASS = "PixaromaPauseImage";
const HIDDEN_INPUT = "PauseState";
const WIDGET_TYPE = "pixaroma_pause_ui";

// ── Queue a run with a one-shot submit mode the graphToPrompt hook reads ──
// "continue" -> prune the upstream (skip it), reload the snapshot downstream.
// "pause"    -> prune the downstream (stop at the gate), re-snapshot + preview.
async function queueWithMode(node, mode) {
  node._pixPauseSubmitMode = mode;
  node._pixPauseBusy = mode === "continue" ? "Continuing…" : "Regenerating…";
  renderPause(node);
  try {
    // Forward the normal Run signature (number, batchCount). app.queuePrompt
    // runs app.graphToPrompt internally, where our hook reads the transient.
    await app.queuePrompt(0, 1);
  } catch (err) {
    console.error("[Pause Image] queue failed", err);
  } finally {
    node._pixPauseSubmitMode = null;
    node._pixPauseBusy = null;
    renderPause(node);
  }
}

function setupNode(node) {
  const root = buildPauseWidget(node, {
    onGate: (gate) => { setGate(node, gate); renderPause(node); },
    onContinue: () => queueWithMode(node, "continue"),
    onRegenerate: () => queueWithMode(node, "pause"),
  });
  const widget = node.addDOMWidget(WIDGET_TYPE, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => NODE_MIN_H,  // constant (Vue Compat #18)
  });
  // Adaptive canvasOnly: true in Classic (keeps it out of the Parameters tab),
  // false in Nodes 2.0 (so the Vue node body renders it).
  applyAdaptiveCanvasOnly(widget);

  // Fresh-node default size. configure() runs AFTER onNodeCreated and restores
  // the saved size for saved workflows, so this only affects fresh drops.
  if (!node.size || node.size[0] < NODE_MIN_W) node.size[0] = 320;
  if (!node.size || node.size[1] < NODE_MIN_H) node.size[1] = 360;

  // Defer the first render until node.properties is restored (Vue Compat #8).
  queueMicrotask(() => restore(node));
}

// DOM-only restore: re-render controls and re-load the last snapshot (if any).
// Never mutates serialized state, so it is safe on the load path (Vue Compat #18).
function restore(node) {
  renderPause(node);
  const s = getState(node);
  if (s.frame) showFrame(node, s.frame);  // onerror disables Continue if gone
}

app.registerExtension({
  name: "Pixaroma.PauseImage",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      setupNode(this);
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      restore(this);
      return r;
    };

    // Self-heal minimum size. onResize is unreliable on the Vue frontend
    // (Vue Compat #13), so this is belt-and-braces; it only raises a too-small
    // size (saved sizes are >= min, so loads never mutate -> no dirty-on-load).
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (size[0] < NODE_MIN_W) size[0] = NODE_MIN_W;
      if (size[1] < NODE_MIN_H) size[1] = NODE_MIN_H;
      return _resize?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPauseEls = null;
      return _removed?.apply(this, arguments);
    };
  },
});

// ── executed event: receive the snapshot preview frame from Python ──
api.addEventListener("executed", (e) => {
  const d = e.detail;
  const frames = d?.output?.pixaroma_pause_frame;
  if (!frames || !frames.length) return;
  // Node id may be a number (legacy) or string (Vue) - try both.
  let node = app.graph.getNodeById(d.node);
  if (!node && typeof d.node === "string") node = app.graph.getNodeById(parseInt(d.node, 10));
  if (!node || node.comfyClass !== CLASS) return;
  const f = frames[0];
  const s = getState(node);
  s.frame = { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "temp" };
  showFrame(node, s.frame);
});

// ── app.graphToPrompt hook: prune + inject mode (Pattern #9, Switch-style) ──
function buildNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

// Build origin -> Set(consumerIds) from the prompt. In the prompt, an input
// value that is a link is the array [originNodeId, originSlot]; everything
// else is a literal widget value.
function buildConsumers(output) {
  const consumers = new Map();
  for (const id in output) {
    const inputs = output[id]?.inputs;
    if (!inputs) continue;
    for (const k in inputs) {
      const v = inputs[k];
      if (Array.isArray(v) && v.length >= 1) {
        const origin = String(v[0]);
        if (!consumers.has(origin)) consumers.set(origin, new Set());
        consumers.get(origin).add(String(id));
      }
    }
  }
  return consumers;
}

// Forward BFS from startId; returns the set of all nodes reachable downstream
// (does NOT include startId).
function collectDownstream(consumers, startId) {
  const seen = new Set();
  const stack = [String(startId)];
  while (stack.length) {
    const cur = stack.pop();
    const next = consumers.get(cur);
    if (!next) continue;
    for (const c of next) {
      if (!seen.has(c)) { seen.add(c); stack.push(c); }
    }
  }
  return seen;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    let consumers = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== CLASS) continue;
      if (!index) index = buildNodeIndex();
      const node = findNode(index, id);

      // Effective mode: a one-shot button override (Continue/Regenerate) wins,
      // otherwise the persistent toggle (Pause default, or Pass).
      let mode = node?._pixPauseSubmitMode;
      if (mode !== "continue" && mode !== "pause") {
        const gate = node?.properties?.[STATE_PROP]?.gate;
        mode = gate === "pass" ? "pass" : "pause";
      }

      entry.inputs = entry.inputs || {};
      if (mode === "pause") {
        // Stop the run at the gate: delete every node downstream of it so the
        // gate (an OUTPUT_NODE) becomes the run's endpoint for this branch.
        // The intermediate non-output nodes (e.g. an upscaler) then have no
        // consumer and ComfyUI auto-skips them. Parallel branches with their
        // own output nodes are untouched.
        if (!consumers) consumers = buildConsumers(out);
        const downstream = collectDownstream(consumers, id);
        for (const d of downstream) delete out[d];
        entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "pause" });
      } else if (mode === "continue") {
        // Skip the upstream: remove the gate's own image input link so the
        // heavy upstream is orphaned (ComfyUI runs only ancestors of output
        // nodes -> it's skipped). Python reloads the snapshot instead.
        delete entry.inputs.image;
        entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "continue" });
      } else {
        // Pass: no prune, whole workflow runs.
        entry.inputs[HIDDEN_INPUT] = JSON.stringify({ mode: "pass" });
      }
    }
  }
  return result;
};
