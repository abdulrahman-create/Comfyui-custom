import { app } from "/scripts/app.js";
import {
  STATE_PROP,
  readState,
  restoreFromProperties,
  parsePrompts,
  findFirstPromptPackNode,
} from "./core.mjs";
import { injectCSS, buildRoot, applyState, updateCounter } from "./render.mjs";
import { wireEvents, showNoPromptsToast } from "./interaction.mjs";

const DEFAULT_W = 400;
const DEFAULT_H = 320;

app.registerExtension({
  name: "Pixaroma.PromptPack",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptPack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      // queueMicrotask defers until after ComfyUI's configure() has merged
      // saved widget values - see Vue Compat #8 in CLAUDE.md. Without it,
      // we render from Python defaults and then flash to the saved state.
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        node._pixPpRoot = root;

        // canvasOnly: true keeps the widget OUT of the right-sidebar
        // Parameters panel (Vue Compat #15). Without it, the textarea +
        // pills would render in the panel AND its draw call would corrupt
        // node-body layout.
        node.addDOMWidget("promptpack", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => 100,
        });

        wireEvents(node, root);

        // Initial render from current state.
        applyState(root, readState(node));

        // Default size on fresh-on-canvas. Saved workflows win because
        // LiteGraph's configure() runs after onNodeCreated and overwrites
        // node.size from the saved JSON.
        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixPpRoot) applyState(this._pixPpRoot, readState(this));
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPpRoot = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// app.graphToPrompt hook - injects activePrompt into the hidden
// PromptPackState input at workflow-submit time. Pattern #9 (Vue Frontend
// Compatibility). Subgraph-safe via tail-id matching. Called once per
// queuePrompt() - the queuePrompt patch below is what changes activePrompt
// between calls so each enqueue sees a different value.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptPack") continue;
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.[STATE_PROP];
        if (!state) continue;
        const activePrompt = (state.activePrompt || "").trim();
        const payload = JSON.stringify({
          version: 1,
          activePrompt,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptPackState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptPack: graphToPrompt hook failed", err);
  }
  return result;
};

// app.queuePrompt patch.
//
// On every Run click: find the first PixaromaPromptPack node in the graph,
// parse its text into an array, and submit one workflow per non-empty
// prompt. Each iteration mutates state.activePrompt BEFORE calling the
// original queuePrompt, so the graphToPrompt hook above captures the right
// prompt for each enqueue.
//
// Edge cases:
// - No Prompt Pack node in graph -> fall through unchanged (hot path).
// - 0 parsed prompts (empty or whitespace-only) -> toast warning, bail.
// - 1 prompt -> 1 queue item.
// - Multiple Prompt Pack nodes -> only the first drives the count.
// - Per-iteration error -> log and continue (don't abort the batch).

const _origQueuePrompt = app.queuePrompt.bind(app);
app.queuePrompt = async function (num, batchCount) {
  const ppNode = findFirstPromptPackNode(app);
  if (!ppNode) return _origQueuePrompt(num, batchCount);

  const state = readState(ppNode);
  const prompts = parsePrompts(state.text, state.mode);

  if (prompts.length === 0) {
    showNoPromptsToast(app);
    return;
  }

  const root = ppNode._pixPpRoot;
  const total = prompts.length;
  const results = [];

  for (let i = 0; i < prompts.length; i++) {
    ppNode.properties = ppNode.properties || {};
    if (!ppNode.properties[STATE_PROP]) ppNode.properties[STATE_PROP] = state;
    ppNode.properties[STATE_PROP].activePrompt = prompts[i];

    if (root) {
      updateCounter(root, ppNode.properties[STATE_PROP], { running: true, index: i + 1, total });
      ppNode.setDirtyCanvas(true, true);
    }

    try {
      const r = await _origQueuePrompt(num, 1);
      results.push(r);
    } catch (err) {
      console.error("Pixaroma.PromptPack: per-prompt enqueue failed", err);
    }
  }

  if (root) {
    updateCounter(root, ppNode.properties[STATE_PROP]);
    ppNode.setDirtyCanvas(true, true);
  }

  return results[results.length - 1];
};
