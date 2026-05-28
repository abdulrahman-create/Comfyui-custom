// Switch Source Pixaroma - inline DOM editor to rename a row.
// Mirrors the Switch label editor, but the click target is the OUTPUT label.
// Commit writes state.labels[rowIdx] + the output slot label; an empty value
// reverts the row to its auto label (type / "out r").

import { app } from "/scripts/app.js";
import { readState, writeState, updateOutputLabels } from "./core.mjs";

let activeEditor = null; // module singleton

export function cancelEditorForNode(node) {
  if (activeEditor && activeEditor.node === node) activeEditor.cleanup();
}

export function openLabelEditor(node, rowIdx1, rect) {
  if (activeEditor) activeEditor.cleanup();

  const state = readState(node);
  const input = document.createElement("input");
  input.type = "text";
  input.value = state.labels?.[rowIdx1] || "";
  input.placeholder = "row name";
  input.maxLength = 64; // keep stored row names sane; display is clipped to node width

  const scale = app.canvas?.ds?.scale || 1;
  // Grow the edit box to a comfortable min width for typing (names go up to 64
  // chars), extending LEFT into the node body so its right edge stays aligned
  // with the (possibly short) label.
  const boxW = Math.max(160 * scale, rect.w);
  const boxLeft = rect.x + rect.w - boxW;
  Object.assign(input.style, {
    position: "fixed",
    left: `${boxLeft}px`,
    top: `${rect.y}px`,
    width: `${boxW}px`,
    height: `${rect.h}px`,
    boxSizing: "border-box",
    background: "#1d1d1d",
    color: "#fff",
    border: `${Math.max(1, Math.round(scale))}px solid #f66744`,
    borderRadius: `${Math.max(2, Math.round(3 * scale))}px`,
    padding: `0 ${Math.max(2, Math.round(4 * scale))}px`,
    font: `${Math.max(9, Math.round(12 * scale))}px 'Segoe UI', -apple-system, sans-serif`,
    textAlign: "right",
    zIndex: "99999",
    outline: "none",
  });
  document.body.appendChild(input);

  function commit() {
    const v = input.value.trim();
    const st = readState(node);
    if (!st.labels) st.labels = {};
    if (v) st.labels[rowIdx1] = v;
    else delete st.labels[rowIdx1];
    writeState(node, st);
    updateOutputLabels(node);
    node.graph?.setDirtyCanvas?.(true, true);
    cleanup();
  }

  function cleanup() {
    // Idempotent + identity-safe: always tear down THIS editor's listeners and
    // DOM (safe to call twice), but only clear the module singleton if it still
    // points at us, so a stale cleanup can't null out a newer editor.
    window.removeEventListener("keydown", onKey, true);
    input.removeEventListener("blur", commit);
    if (input.parentNode) input.parentNode.removeChild(input);
    if (activeEditor && activeEditor.node === node) activeEditor = null;
  }

  function onKey(e) {
    // Only intercept keys while the rename input itself is focused; otherwise
    // let them through so other shortcuts (graph + browser) keep working while
    // the overlay is mounted. Mirrors the Switch sibling editor.
    if (e.target !== input) return;
    // Capture + stopImmediatePropagation so Ctrl+Z / Enter / Esc don't escape
    // to ComfyUI's canvas while typing.
    e.stopImmediatePropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cleanup(); }
  }

  input.addEventListener("blur", commit);
  // Defer focus + listener install so the opening mousedown doesn't ghost-blur
  // the input (same pattern as Switch's editor). Guard against teardown before
  // the timer fires (node deleted / another editor opened in the same tick):
  // without this, the window keydown listener gets added AFTER cleanup ran and
  // leaks for the page's life, keeping a removed node + closure alive.
  setTimeout(() => {
    if (!input.isConnected) return;
    window.addEventListener("keydown", onKey, true);
    input.focus();
    input.select();
  }, 0);

  activeEditor = { node, cleanup };
}
