import { app } from "/scripts/app.js";
import { readState, restoreFromProperties, addRow, deleteRow, toggleEnabled } from "./core.mjs";
import { injectCSS, buildRoot, renderRows } from "./render.mjs";

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

function makeHandlers(node, root) {
  const rerender = () => renderRows(node, root, handlers);
  const handlers = {
    onToggleEnabled: (id) => { toggleEnabled(node, id); rerender(); node.setDirtyCanvas(true, true); },
    onToggleWire: (_id) => { /* Task 8 */ },
    onLabelChange: (_id, _v) => { /* Task 5 */ },
    onTextChange: (_id, _v) => { /* Task 5 */ },
    onDelete: (id) => { deleteRow(node, id); rerender(); node.setDirtyCanvas(true, true); },
    onAdd: () => { addRow(node); rerender(); node.setDirtyCanvas(true, true); },
    onDragStart: (_id, _ev) => { /* Task 9 */ },
    onDragOver: (_id, _ev) => { /* Task 9 */ },
    onDrop: (_id, _ev) => { /* Task 9 */ },
    onDragEnd: (_ev) => { /* Task 9 */ },
  };
  return { handlers, rerender };
}

app.registerExtension({
  name: "Pixaroma.PromptStack",

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
          getMinHeight: () => 120,
        });

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
      if (this._pixPsRerender) this._pixPsRerender();
      return r;
    };
  },
});
