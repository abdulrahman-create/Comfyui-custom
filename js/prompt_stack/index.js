import { app } from "/scripts/app.js";
import {
  readState,
  restoreFromProperties,
  addRow,
  deleteRow,
  toggleEnabled,
  toggleWireMode,
  applyWireSlotPositions,
  MAX_WIRES,
} from "./core.mjs";
import { injectCSS, buildRoot, renderRows, measureContentHeight } from "./render.mjs";
import { pixConfirm, confirmWireFlip } from "./interaction.mjs";

const DEFAULT_W = 400;
const DEFAULT_H = 280;

function removeAllWireSlots(node) {
  if (!node.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const inp = node.inputs[i];
    if (inp && typeof inp.name === "string" && inp.name.startsWith("wire_")) {
      node.removeInput(i);
    }
  }
}

// growNodeToContent: after a rerender that added rows, ask ComfyUI to recompute
// the node's natural size. If the content's required height grew past the
// current node.size[1], lift the node taller. Never shrinks the node (so a
// user-resized-bigger node stays the size they chose).
function growNodeToContent(node) {
  if (!node || typeof node.computeSize !== "function") return;
  const computed = node.computeSize();
  if (Array.isArray(computed) && computed[1] > node.size[1]) {
    node.size[1] = computed[1];
  }
}

// makeRowYResolver returns a function rowId -> y-in-node-local-body-coords.
// Reads each row element's offsetTop relative to the DOM widget root, plus the
// DOM widget's last_y (where ComfyUI placed the widget within the node body).
function makeRowYResolver(node) {
  return (rowId) => {
    const root = node._pixPsRoot;
    if (!root) return null;
    const rowEl = root.querySelector(`.pix-ps-row[data-id="${rowId}"]`);
    if (!rowEl) return null;
    const widget = (node.widgets || []).find(
      (w) => w.element === root || w.options?.element === root,
    );
    const widgetY = widget?.last_y ?? widget?.y ?? 0;
    const rowTopWithinRoot = rowEl.offsetTop;
    const rowMid = rowTopWithinRoot + rowEl.offsetHeight / 2;
    return widgetY + rowMid;
  };
}

function makeHandlers(node, root) {
  const rerender = () => {
    renderRows(node, root, handlers);
    requestAnimationFrame(() => {
      growNodeToContent(node);
      applyWireSlotPositions(node, makeRowYResolver(node));
      node.setDirtyCanvas(true, true);
    });
  };
  const handlers = {
    onToggleEnabled: (id) => { toggleEnabled(node, id); rerender(); },
    onToggleWire: async (id) => {
      const state = readState(node);
      const row = state.rows.find((r) => r.id === id);
      if (!row) return;
      const flippingToWire = !row.wireMode;
      const hasText = flippingToWire && row.text && row.text.trim().length > 0;
      if (hasText) {
        const ok = await confirmWireFlip(true);
        if (!ok) return;
      }
      const result = toggleWireMode(node, id);
      if (!result.ok) {
        if (result.reason === "max_wires") {
          await pixConfirm({
            title: "Wire-mode limit reached",
            message: `Maximum ${MAX_WIRES} wired rows reached. Switch a wired row back to typed mode first.`,
            okText: "OK",
            cancelText: "OK",
          });
        }
        return;
      }
      rerender();
    },
    onLabelChange: (_id, _v) => { /* Task 5 */ },
    onTextChange: (_id, _v) => { /* Task 5 */ },
    onDelete: async (id) => {
      const state = readState(node);
      const row = state.rows.find((r) => r.id === id);
      const hasContent = row && ((row.text && row.text.trim()) || (row.label && row.label.trim()));
      if (hasContent) {
        const labelOrIdx = (row.label && row.label.trim()) || `Row ${state.rows.indexOf(row) + 1}`;
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
    },
    onAdd: () => { addRow(node); rerender(); },
    onDragStart: (_id, _ev) => { /* Task 9 */ },
    onDragOver: (_id, _ev) => { /* Task 9 */ },
    onDrop: (_id, _ev) => { /* Task 9 */ },
    onDragEnd: (_ev) => { /* Task 9 */ },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptStack",

  settings: [
    {
      id: "Pixaroma.PromptStack.Separator",
      name: "Separator",
      type: "combo",
      defaultValue: "Comma+Space (, )",
      options: [
        "Comma+Space (, )",
        "Newline (\\n)",
        "Space ( )",
        "Custom...",
      ],
      tooltip: "How enabled rows are joined into the output string. Custom uses the value below.",
      category: ["👑 Pixaroma", "Prompt Stack"],
    },
    {
      id: "Pixaroma.PromptStack.CustomSeparator",
      name: "Custom separator",
      type: "text",
      defaultValue: ", ",
      tooltip: "Used only when Separator is set to 'Custom...'. Empty falls back to ', '.",
      category: ["👑 Pixaroma", "Prompt Stack (advanced)"],
    },
    {
      id: "Pixaroma.PromptStack.SuppressWireConfirm",
      name: "Don't show the wire-mode flip confirm",
      type: "boolean",
      defaultValue: false,
      tooltip: "When on, switching a non-empty row to wire mode does not prompt for confirmation.",
      category: ["👑 Pixaroma", "Prompt Stack (advanced)"],
    },
  ],

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptStack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        removeAllWireSlots(node);
        restoreFromProperties(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPsRoot = root;
        node._pixPsRerender = rerender;

        node.addDOMWidget("promptstack", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => measureContentHeight(root),
        });

        rerender();

        if (typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => {
            applyWireSlotPositions(node, makeRowYResolver(node));
          });
          ro.observe(root);
          node._pixPsResizeObserver = ro;
        }

        if (node.size[0] < DEFAULT_W) node.size[0] = DEFAULT_W;
        if (node.size[1] < DEFAULT_H) node.size[1] = DEFAULT_H;
        node.setDirtyCanvas(true, true);
      });
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      restoreFromProperties(this);
      if (this._pixPsRerender) this._pixPsRerender();
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._pixPsResizeObserver) {
        try { this._pixPsResizeObserver.disconnect(); } catch (_e) {}
        this._pixPsResizeObserver = null;
      }
      this._pixPsRoot = null;
      this._pixPsRerender = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// app.graphToPrompt hook - injects state + resolved separator into the hidden
// PromptStackState input at workflow-submit time. Pattern #9 (Vue Frontend
// Compatibility). Subgraph-safe via tail-id matching.
const _origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt.apply(this, args);
  try {
    const sep = resolveSeparator();
    const prompt = result?.output;
    if (prompt && typeof prompt === "object") {
      for (const key of Object.keys(prompt)) {
        const entry = prompt[key];
        if (!entry || entry.class_type !== "PixaromaPromptStack") continue;
        // Tail-id matching: find the node by id suffix (subgraphs prefix the id with "x:y:")
        const nodeId = parseInt(String(key).split(":").pop(), 10);
        const node = app.graph?.getNodeById?.(nodeId);
        if (!node) continue;
        const state = node.properties?.promptStackState;
        if (!state || !Array.isArray(state.rows)) continue;
        const payload = JSON.stringify({
          version: 1,
          rows: state.rows.map((r) => ({
            enabled: !!r.enabled,
            wireMode: !!r.wireMode,
            wireIndex: r.wireIndex ?? null,
            label: r.label || "",
            text: r.text || "",
          })),
          separator: sep,
        });
        entry.inputs = entry.inputs || {};
        entry.inputs.PromptStackState = payload;
      }
    }
  } catch (err) {
    console.error("Pixaroma.PromptStack: graphToPrompt hook failed", err);
  }
  return result;
};

function resolveSeparator() {
  const choice = app.ui?.settings?.getSettingValue?.("Pixaroma.PromptStack.Separator") || "Comma+Space (, )";
  if (choice === "Newline (\\n)") return "\n";
  if (choice === "Space ( )") return " ";
  if (choice === "Custom...") {
    const custom = app.ui?.settings?.getSettingValue?.("Pixaroma.PromptStack.CustomSeparator");
    return (typeof custom === "string" && custom.length > 0) ? custom : ", ";
  }
  return ", ";
}
