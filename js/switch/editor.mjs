// Inline label editor for Switch Pixaroma rows.
//
// Spawns a transient DOM <input type="text"> overlaid on the canvas at the
// row's label area. Only one editor is open at a time (module-level singleton).
//
// Usage:
//   openLabelEditor(node, slotIdx1, rect)
//     node      - the LiteGraph node
//     slotIdx1  - 1-based slot index
//     rect      - { x, y, w, h } in viewport pixels (from labelScreenRect)
//
// Behaviour:
//   Enter / blur -> commit: saves value to node.properties.switchState.labels[slotIdx1];
//                           empty value deletes the entry.
//   Esc          -> cancel: no change.
//   Opening another editor auto-commits the previous one.

const STATE_PROP = "switchState";
const BRAND = "#f66744";

let activeEditor = null; // module-level singleton

function commit(state) {
  if (!state || state._committed) return;
  state._committed = true;
  const { node, slotIdx, input } = state;
  if (!input.isConnected) { cleanup(state); return; }
  const value = input.value.trim();
  if (!node.properties[STATE_PROP]) node.properties[STATE_PROP] = {};
  const labels = node.properties[STATE_PROP].labels;
  if (!labels) {
    node.properties[STATE_PROP].labels = {};
  }
  if (value) {
    node.properties[STATE_PROP].labels[slotIdx] = value;
  } else {
    delete node.properties[STATE_PROP].labels[slotIdx];
  }
  cleanup(state);
  node.graph?.setDirtyCanvas?.(true, true);
}

function cancel(state) {
  if (!state || state._committed) return;
  state._committed = true;
  cleanup(state);
}

function cleanup(state) {
  if (!state) return;
  if (state.keyHandler) state.input.removeEventListener("keydown", state.keyHandler);
  if (state.blurHandler) state.input.removeEventListener("blur", state.blurHandler);
  state.input.remove();
  if (activeEditor === state) activeEditor = null;
}

// rect: { x, y, w, h } in viewport pixels.
export function openLabelEditor(node, slotIdx /* 1-based */, rect) {
  // Close any previously open editor with an implicit commit.
  if (activeEditor) commit(activeEditor);

  const initial = node.properties?.[STATE_PROP]?.labels?.[slotIdx] || "";

  const input = document.createElement("input");
  input.type = "text";
  input.value = initial;
  input.placeholder = "Label";
  input.style.cssText = [
    "position: fixed",
    `left: ${rect.x}px`,
    `top: ${rect.y}px`,
    `width: ${rect.w}px`,
    `height: ${rect.h}px`,
    "z-index: 10000",
    "background: #1f1f1f",
    "color: #d8d8d8",
    `border: 1px solid ${BRAND}`,
    "border-radius: 3px",
    "padding: 0 6px",
    "font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "outline: none",
    "box-sizing: border-box",
  ].join("; ");

  document.body.appendChild(input);
  input.focus();
  input.select();

  const state = { node, slotIdx, input, _committed: false };

  state.keyHandler = (e) => {
    // stopPropagation so canvas shortcuts (pan, undo, etc.) don't fire while
    // the user is typing.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit(state);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel(state);
    }
  };

  // blur fires when the user clicks away or tabs out - treat as a commit.
  state.blurHandler = () => commit(state);

  input.addEventListener("keydown", state.keyHandler);
  input.addEventListener("blur", state.blurHandler);

  activeEditor = state;
}
