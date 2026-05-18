import { app } from "/scripts/app.js";
import {
  readState,
  restoreFromProperties,
  addRow,
  deleteRow,
  toggleEnabled,
  reorderRows,
  enabledRowsWithIndex,
  STATE_PROP,
} from "./core.mjs";
import { injectCSS, buildRoot, renderRows, measureContentHeight } from "./render.mjs";
import { pixConfirm } from "./interaction.mjs";

const DEFAULT_W = 400;
const DEFAULT_H = 200;

function growNodeToContent(node) {
  const root = node._pixPmRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = contentH + 50;
  if (desired > node.size[1]) node.size[1] = desired;
}

function fitNodeToContent(node) {
  const root = node._pixPmRoot;
  if (!root) return;
  const contentH = measureContentHeight(root);
  const desired = Math.max(DEFAULT_H, contentH + 50);
  node.size[1] = desired;
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
    onToggleEnabled: (id) => { toggleEnabled(node, id); rerender(); },
    onLabelChange: (_id, _v) => { /* handled inline by attachLabelEditor */ },
    onTextChange: (_id, _v) => { /* handled inline by attachTextareaEditor */ },
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
      requestAnimationFrame(() => {
        fitNodeToContent(node);
        node.setDirtyCanvas(true, true);
      });
    },
    onAdd: () => { addRow(node); rerender(); },
    onDragStart: (_id, _ev) => { /* drag state is held inside interaction.mjs */ },
    onDragOver: (_id, _ev) => { /* drag state is held inside interaction.mjs */ },
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
    onDragEnd: (_ev) => { /* no-op */ },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptMulti",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptMulti") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      const node = this;
      queueMicrotask(() => {
        injectCSS();
        restoreFromProperties(node);

        const root = buildRoot();
        const { handlers, rerender } = makeHandlers(node, root);
        node._pixPmRoot = root;
        node._pixPmRerender = rerender;

        node.addDOMWidget("promptmulti", "div", root, {
          serialize: false,
          canvasOnly: true,
          getMinHeight: () => measureContentHeight(root),
        });

        node._pixPmGrow = () => {
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
      if (this._pixPmRerender) this._pixPmRerender();
      return r;
    };

    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._pixPmRoot = null;
      this._pixPmRerender = null;
      this._pixPmGrow = null;
      if (origRemoved) return origRemoved.apply(this, arguments);
    };
  },
});

// graphToPrompt hook and queuePrompt patch land in Task 7 and Task 8.
