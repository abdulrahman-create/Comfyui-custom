// ╔═══════════════════════════════════════════════════════════════╗
// ║  Text Overlay Pixaroma — extension entry (simplified v2)     ║
// ║  Node body hosts the full text_editor.mjs panel + Open btn.  ║
// ║  Same panel re-mounted in editor right sidebar on open.      ║
// ╚═══════════════════════════════════════════════════════════════╝

import { app } from "/scripts/app.js";
import { TextOverlayEditor } from "./core.mjs";
import { createTextEditorPanel } from "../framework/text_editor.mjs";
import "./interaction.mjs"; // side-effect: registers prototype methods

const NODE_CLASS = "PixaromaTextOverlay";
const STATE_PROP = "textOverlayState";
const HIDDEN_INPUT_NAME = "TextOverlayState";

// Default state when adding a fresh node OR migrating from older versions.
// Position x/y are deliberately small so the text fits in ANY canvas size out
// of the box. The _autoCenterPending flag tells the editor to center the text
// on the canvas the first time it opens with an upstream image available; the
// editor clears the flag after centering so subsequent opens use the saved
// position. See core.mjs::open.
const DEFAULT_STATE = {
  version: 3,
  text: "Your text here",
  font: "Inter",
  weight: 400,
  italic: false,
  align: "center",
  fontSize: 64,
  lineHeight: 1.2,
  letterSpacing: 0,
  x: 20,
  y: 20,
  rotation: 0,
  opacity: 1.0,
  color: "#FFFFFF",
  bgColor: null,
  _autoCenterPending: true,
};

app.registerExtension({
  name: "Pixaroma.TextOverlay",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;

    const origCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = origCreated?.apply(this, arguments);
      setupTextOverlayNode(this);
      return r;
    };

    const origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = origConfigure?.apply(this, arguments);
      ensureValidState(this);
      // After configure, push current state into the body panel UI
      if (this._textOverlayBodyPanel) {
        this._textOverlayBodyPanel.setLayer(this.properties[STATE_PROP]);
      }
      return r;
    };
  },
});

function ensureValidState(node) {
  if (!node.properties) node.properties = {};
  const cur = node.properties[STATE_PROP];
  // Reset to defaults when version is missing or older than current.
  // v1 (multi-layer) and v2 (bad defaults) both replaced wholesale.
  if (!cur || cur.version !== 3) {
    node.properties[STATE_PROP] = { ...DEFAULT_STATE };
  }
}

function setupTextOverlayNode(node) {
  ensureValidState(node);

  const root = document.createElement("div");
  root.style.cssText = "display:flex; flex-direction:column; gap:6px; padding:4px 0;";

  // Open Text Editor button at the top
  const btn = document.createElement("button");
  btn.textContent = "Open Text Editor";
  btn.style.cssText = "background:#f66744; color:#fff; border:none; padding:8px; border-radius:4px; font:600 13px system-ui; cursor:pointer;";
  btn.addEventListener("click", () => openEditor(node));
  root.appendChild(btn);

  // The shared text_editor.mjs panel mounted on the node body
  const panelMount = document.createElement("div");
  panelMount.style.cssText = "padding:0 4px;";
  root.appendChild(panelMount);

  const bodyPanel = createTextEditorPanel({
    mount: panelMount,
    onChange: () => {
      // Sync the editor's panel (if editor is open) + re-render its canvas
      if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) {
        node._textOverlayEditor.editorPanel?.setLayer?.(node.properties[STATE_PROP]);
        node._textOverlayEditor.requestRender?.();
      }
      node.setDirtyCanvas?.(true, true);
    },
  });
  node._textOverlayBodyPanel = bodyPanel;
  node._textOverlayBodyRoot = root;

  node.addDOMWidget("pix_text_overlay_ui", "div", root, {
    canvasOnly: true,
    serialize: false,
    getMinHeight: () => {
      // Sum children offsetHeight + 16 padding so the node hugs its content
      let h = 16;
      for (const c of root.children) h += c.offsetHeight || 0;
      return Math.max(380, h);
    },
  });

  // Default size for new nodes; LiteGraph restores saved sizes via configure
  if (!node.size || node.size[0] < 320) {
    node.size = [360, 700];
  }

  // Defer panel population past configure() so saved state is restored first
  queueMicrotask(() => {
    bodyPanel.setLayer(node.properties[STATE_PROP]);
  });
}

function openEditor(node) {
  if (node._textOverlayEditor && node._textOverlayEditor.layout?.overlay?.isConnected) return;
  const editor = new TextOverlayEditor(node);
  node._textOverlayEditor = editor;
  editor.open().catch((e) => {
    console.error("[Text Overlay] open failed", e);
    try { editor.close(); } catch {}
  });
}

// ── Pattern #9: graphToPrompt hook (mostly unchanged, simpler payload) ───

function buildPixNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === NODE_CLASS || n.type === NODE_CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findPixNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  const out = result?.output;
  if (out) {
    let index = null;
    for (const id in out) {
      const entry = out[id];
      if (!entry || entry.class_type !== NODE_CLASS) continue;
      if (!index) index = buildPixNodeIndex();
      const node = findPixNode(index, id);
      const state = node?.properties?.[STATE_PROP] || DEFAULT_STATE;
      entry.inputs = entry.inputs || {};
      entry.inputs[HIDDEN_INPUT_NAME] = JSON.stringify(state);
    }
  }
  return result;
};
