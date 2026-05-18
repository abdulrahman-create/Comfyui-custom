import { app } from "/scripts/app.js";
import {
  readState,
  restoreFromProperties,
  addRow,
  deleteRow,
  reorderRows,
  setPickRow,
  addPick,
  removePick,
  clearAllText,
  resetToDefault,
  STATE_PROP,
  MAX_PICKS,
} from "./core.mjs";
import { injectCSS, buildRoot, renderRows, measureContentHeight } from "./render.mjs";
import { pixConfirm } from "./interaction.mjs";

const DEFAULT_W = 460;
const DEFAULT_H = 260;

function growNodeToContent(node) {
  const root = node._pixPpRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = contentH + 50;
  if (desired > node.size[1]) node.size[1] = desired;
}

function fitNodeToContent(node) {
  const root = node._pixPpRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = Math.max(DEFAULT_H, contentH + 50);
  node.size[1] = desired;
}

// Reconcile the node's visible output slots to match the state.picks count.
// The Python backend declares MAX_PICKS outputs (text_1..text_8) but we only
// show the ones the user actually wants. Wires on outputs that are removed
// because the pick count shrinks are explicitly cut so the workflow JSON
// stays consistent.
function syncOutputSlotsToPicks(node) {
  const state = readState(node);
  const desiredCount = state.picks.length;

  // Ensure each expected output slot exists with the right name.
  for (let i = 0; i < desiredCount; i++) {
    const wantName = `text_${i + 1}`;
    const existing = node.outputs?.[i];
    if (!existing) {
      try { node.addOutput(wantName, "STRING"); } catch (_) {}
    } else if (existing.name !== wantName) {
      existing.name = wantName;
      if (existing.label) existing.label = wantName;
    }
  }

  // Trim any extra outputs beyond desiredCount (these would be leftover from
  // a previous larger pick count). Disconnect any wires first so consumers
  // don't end up dangling silently.
  while ((node.outputs?.length || 0) > desiredCount) {
    const lastIdx = node.outputs.length - 1;
    try { node.disconnectOutput(lastIdx); } catch (_) {}
    try { node.removeOutput(lastIdx); } catch (_) {}
  }
}

function makeHandlers(node, root) {
  const rerender = () => {
    renderRows(node, root, handlers);
    requestAnimationFrame(() => {
      growNodeToContent(node);
      node.setDirtyCanvas(true, true);
    });
  };
  const handlers = {
    onLabelChange: (_id, _v) => { /* inline */ },
    onTextChange: (_id, _v) => { /* inline */ },
    onDeleteRow: async (id) => {
      const state = readState(node);
      const row = state.rows.find((r) => r.id === id);
      const hasContent = row && ((row.text && row.text.trim()) || (row.label && row.label.trim()));
      if (hasContent) {
        const labelOrIdx = (row.label && row.label.trim()) || `Prompt ${state.rows.indexOf(row) + 1}`;
        const ok = await pixConfirm({
          title: "Delete row?",
          message: `Are you sure you want to delete "${labelOrIdx}"?`,
          okText: "Delete",
          cancelText: "Cancel",
        });
        if (!ok) return;
      }
      deleteRow(node, id);
      rerender();
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onAddRow: () => { addRow(node); rerender(); },
    onClearAll: async () => {
      const state = readState(node);
      const filled = state.rows.filter((r) => r.text && r.text.trim()).length;
      if (filled === 0) return;
      const ok = await pixConfirm({
        title: "Clear all text?",
        message: `This will empty the text in all ${state.rows.length} row${state.rows.length === 1 ? "" : "s"}. Labels and output picks are kept.`,
        okText: "Clear",
        cancelText: "Cancel",
      });
      if (!ok) return;
      clearAllText(node);
      rerender();
    },
    onReset: async () => {
      const ok = await pixConfirm({
        title: "Reset to default?",
        message: "This will replace all rows with one empty row, one output. Your current rows AND output picks will be lost.",
        okText: "Reset",
        cancelText: "Cancel",
      });
      if (!ok) return;
      resetToDefault(node);
      syncOutputSlotsToPicks(node);
      rerender();
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onSetPickRow: (pickIdx, rowIdx) => {
      setPickRow(node, pickIdx, rowIdx);
      rerender();
    },
    onAddPick: () => {
      const ok = addPick(node);
      if (!ok) return;
      syncOutputSlotsToPicks(node);
      rerender();
    },
    onRemovePick: async (pickIdx) => {
      const state = readState(node);
      if (state.picks.length <= 1) return;
      // Check if this output is currently wired. If so, confirm before removing.
      const isWired = (node.outputs?.[pickIdx]?.links || []).length > 0;
      if (isWired) {
        const ok = await pixConfirm({
          title: `Remove output text_${pickIdx + 1}?`,
          message: "This output is currently connected to something. Removing it will disconnect the wire.",
          okText: "Remove",
          cancelText: "Cancel",
        });
        if (!ok) return;
      }
      const removed = removePick(node, pickIdx);
      if (!removed) return;
      syncOutputSlotsToPicks(node);
      rerender();
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onDrop: (fromId, toId, above) => {
      const state = readState(node);
      const fromIdx = state.rows.findIndex((r) => r.id === fromId);
      const toIdxRaw = state.rows.findIndex((r) => r.id === toId);
      if (fromIdx < 0 || toIdxRaw < 0) return;
      let destIdx = above ? toIdxRaw : toIdxRaw + 1;
      if (fromIdx < destIdx) destIdx -= 1;
      if (destIdx === fromIdx) return;
      reorderRows(node, fromIdx, destIdx);
      rerender();
    },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptPicker",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptPicker") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);
        syncOutputSlotsToPicks(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPpRoot = root;
        node._pixPpRerender = rerender;

        node.addDOMWidget("promptpicker", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => measureContentHeight(root),
        });

        node._pixPpGrow = () => {
          growNodeToContent(node);
          node.setDirtyCanvas(true, true);
        };

        rerender();

        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      syncOutputSlotsToPicks(this);
      if (this._pixPpRerender) this._pixPpRerender();
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPpRoot = null;
      this._pixPpRerender = null;
      this._pixPpGrow = null;
      this._pixPpRefreshClear = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// app.graphToPrompt hook - resolve each pick's rowIndex into the live text
// and ship an array as state.pickTexts in the hidden PromptPickerState input.
// This way the Python backend doesn't need to know about rows at all.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptPicker") continue;
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.[STATE_PROP];
        if (!state || !Array.isArray(state.rows) || state.rows.length === 0) continue;
        if (!Array.isArray(state.picks) || state.picks.length === 0) continue;
        const pickTexts = state.picks.map((p) => {
          const idx = (typeof p.rowIndex === "number" && p.rowIndex >= 0 && p.rowIndex < state.rows.length) ? p.rowIndex : 0;
          return state.rows[idx]?.text || "";
        });
        const payload = JSON.stringify({
          version: 2,
          pickTexts,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptPickerState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptPicker: graphToPrompt hook failed", err);
  }
  return result;
};
