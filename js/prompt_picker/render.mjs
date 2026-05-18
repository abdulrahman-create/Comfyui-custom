// Prompt Picker Pixaroma - DOM widget render.
//
// Builds a root <div> for the node body containing:
//   - a header bar with the Active: ◀ N / Total ▶ index selector
//   - one <div> per row (label + textarea, drag handle, X delete)
//   - actions row: + Add prompt | Clear text | Reset
//
// Active row gets an orange left border. Click handlers + drag handlers come
// from interaction.mjs.

import { readState } from "./core.mjs";
import { attachLabelEditor, attachTextareaEditor, attachDragHandlers } from "./interaction.mjs";

const CSS_ID = "pix-prompt-picker-css";

const CSS = `
.pix-pp-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 8px 8px;
  box-sizing: border-box;
  font-family: inherit;
  color: #ddd;
}

.pix-pp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 4px;
  font-size: 12px;
  color: #ccc;
  user-select: none;
}
.pix-pp-header-label { color: #888; margin-right: 4px; }
.pix-pp-arrow {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pix-pp-arrow:hover { background: #333; border-color: #f66744; color: #f66744; }
.pix-pp-arrow:disabled { color: #555; border-color: #2e2e2e; background: #232323; cursor: not-allowed; }
.pix-pp-arrow:disabled:hover { background: #232323; border-color: #2e2e2e; color: #555; }
.pix-pp-index-input {
  width: 38px;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 3px;
  color: #f66744;
  font-weight: 600;
  font-size: 12px;
  text-align: center;
  padding: 3px 4px;
  outline: none;
  -moz-appearance: textfield;
}
.pix-pp-index-input::-webkit-outer-spin-button,
.pix-pp-index-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pix-pp-index-input:focus { border-color: #f66744; }
.pix-pp-index-total { color: #888; margin-left: 2px; }
.pix-pp-active-label-display {
  flex: 1;
  text-align: right;
  color: #888;
  font-style: italic;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 8px;
  min-width: 0;
}

.pix-pp-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
  border-radius: 4px;
  background: #232323;
  border: 1px solid #2e2e2e;
  border-left: 3px solid #2e2e2e;
  position: relative;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.pix-pp-row.is-active {
  border-left-color: #f66744;
  background: #262421;
}
.pix-pp-row.is-dragging { opacity: 0.4; }
.pix-pp-row.is-drop-target-above { box-shadow: 0 -2px 0 0 #f66744; }
.pix-pp-row.is-drop-target-below { box-shadow: 0 2px 0 0 #f66744; }

.pix-pp-row-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}

.pix-pp-handle {
  cursor: grab;
  color: #888;
  font-size: 14px;
  line-height: 14px;
  user-select: none;
  padding: 0 2px;
  letter-spacing: -2px;
}
.pix-pp-handle:active { cursor: grabbing; }
.pix-pp-handle:hover { color: #ccc; }

.pix-pp-rowidx {
  min-width: 22px;
  text-align: center;
  color: #777;
  font-size: 11px;
  font-weight: 600;
  user-select: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  transition: background 0.12s ease, color 0.12s ease;
}
.pix-pp-rowidx:hover { background: rgba(246,103,68,0.12); color: #f66744; }
.pix-pp-row.is-active .pix-pp-rowidx { color: #f66744; }

.pix-pp-label {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 3px;
  color: #ddd;
  font-size: 11px;
  padding: 2px 6px;
  outline: none;
  min-width: 0;
}
.pix-pp-label:focus { border-color: #f66744; }
.pix-pp-label::placeholder { color: #666; font-style: italic; }

.pix-pp-delete {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  line-height: 14px;
  flex-shrink: 0;
  padding: 0;
}
.pix-pp-delete:hover { color: #f66744; background: rgba(246,103,68,0.12); }
.pix-pp-delete:disabled { color: #444; cursor: not-allowed; background: transparent; }

.pix-pp-textarea {
  width: 100%;
  min-height: 38px;
  max-height: 120px;
  resize: none;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 3px;
  color: #ddd;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
  overflow-y: auto;
}
.pix-pp-textarea:focus { border-color: #f66744; }

.pix-pp-actions {
  display: flex;
  gap: 6px;
  align-self: flex-start;
  margin-top: 4px;
}
.pix-pp-add, .pix-pp-clear, .pix-pp-reset {
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
  font-family: inherit;
}
.pix-pp-add:hover, .pix-pp-clear:hover, .pix-pp-reset:hover { background: #333; border-color: #f66744; color: #f66744; }
.pix-pp-clear:disabled, .pix-pp-reset:disabled { color: #555; border-color: #2e2e2e; background: #232323; cursor: not-allowed; }
.pix-pp-clear:disabled:hover, .pix-pp-reset:disabled:hover { background: #232323; border-color: #2e2e2e; color: #555; }

.pix-pp-confirm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}
.pix-pp-confirm-box {
  background: #1d1d1d;
  border: 1px solid #2e2e2e;
  border-radius: 6px;
  min-width: 320px;
  max-width: 480px;
  padding: 18px 20px;
  color: #ddd;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
.pix-pp-confirm-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 8px 0;
}
.pix-pp-confirm-msg {
  font-size: 13px;
  color: #bbb;
  margin: 0 0 16px 0;
  line-height: 1.4;
}
.pix-pp-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.pix-pp-confirm-btn {
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
  padding: 6px 14px;
  font-family: inherit;
}
.pix-pp-confirm-btn:hover { background: #333; border-color: #555; }
.pix-pp-confirm-btn.primary {
  background: #f66744;
  border-color: #f66744;
  color: #fff;
}
.pix-pp-confirm-btn.primary:hover { background: #ff7a58; border-color: #ff7a58; }
`;

export function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-pp-root";
  return root;
}

// Sum of children offsetHeight (NOT root.scrollHeight - that creates a feedback
// loop because ComfyUI stretches root.offsetHeight when the node has slack).
export function measureContentHeight(root) {
  if (!root) return 120;
  let h = 0;
  let count = 0;
  for (const child of root.children) {
    if (child.offsetParent === null) continue;
    h += child.offsetHeight;
    count += 1;
  }
  const cs = getComputedStyle(root);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;
  if (count > 1) h += gap * (count - 1);
  h += parseFloat(cs.paddingTop) || 0;
  h += parseFloat(cs.paddingBottom) || 0;
  return Math.max(120, h);
}

// rowHandlers shape:
//   { onLabelChange, onTextChange, onDelete, onAdd, onClearAll, onReset,
//     onActiveChange(idx), onDrop(fromId, toId, above) }
export function renderRows(node, root, rowHandlers) {
  const state = readState(node);
  root.innerHTML = "";

  // Header: Active: [ < ] [ N ] / Total [ > ]   active-label-display
  const header = document.createElement("div");
  header.className = "pix-pp-header";

  const headerLabel = document.createElement("span");
  headerLabel.className = "pix-pp-header-label";
  headerLabel.textContent = "Active:";
  header.appendChild(headerLabel);

  const prevBtn = document.createElement("button");
  prevBtn.className = "pix-pp-arrow";
  prevBtn.type = "button";
  prevBtn.textContent = "◀"; // ◀
  prevBtn.title = "Previous row";
  prevBtn.disabled = state.activeIndex <= 0;
  prevBtn.addEventListener("click", () => rowHandlers.onActiveChange(state.activeIndex - 1));
  header.appendChild(prevBtn);

  const indexInput = document.createElement("input");
  indexInput.className = "pix-pp-index-input";
  indexInput.type = "number";
  indexInput.min = "1";
  indexInput.max = String(state.rows.length);
  indexInput.value = String(state.activeIndex + 1);
  indexInput.title = "Active row number (1-based)";
  indexInput.addEventListener("change", (e) => {
    const raw = parseInt(e.target.value, 10);
    if (Number.isFinite(raw)) rowHandlers.onActiveChange(raw - 1);
  });
  indexInput.addEventListener("keydown", (e) => e.stopImmediatePropagation());
  indexInput.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  indexInput.addEventListener("mousedown", (e) => e.stopImmediatePropagation());
  header.appendChild(indexInput);

  const totalSpan = document.createElement("span");
  totalSpan.className = "pix-pp-index-total";
  totalSpan.textContent = `/ ${state.rows.length}`;
  header.appendChild(totalSpan);

  const nextBtn = document.createElement("button");
  nextBtn.className = "pix-pp-arrow";
  nextBtn.type = "button";
  nextBtn.textContent = "▶"; // ▶
  nextBtn.title = "Next row";
  nextBtn.disabled = state.activeIndex >= state.rows.length - 1;
  nextBtn.addEventListener("click", () => rowHandlers.onActiveChange(state.activeIndex + 1));
  header.appendChild(nextBtn);

  const activeRow = state.rows[state.activeIndex];
  const activeLabel = document.createElement("span");
  activeLabel.className = "pix-pp-active-label-display";
  activeLabel.textContent = (activeRow?.label && activeRow.label.trim()) || `Prompt ${state.activeIndex + 1}`;
  activeLabel.title = activeLabel.textContent;
  header.appendChild(activeLabel);

  root.appendChild(header);

  // Rows
  state.rows.forEach((row, idx) => {
    const rowEl = document.createElement("div");
    rowEl.className = "pix-pp-row" + (idx === state.activeIndex ? " is-active" : "");
    rowEl.dataset.id = row.id;
    rowEl.draggable = true;

    const head = document.createElement("div");
    head.className = "pix-pp-row-head";

    const handle = document.createElement("span");
    handle.className = "pix-pp-handle";
    handle.textContent = "⋮⋮"; // ⋮⋮
    handle.title = "Drag to reorder";
    head.appendChild(handle);

    const rowIdx = document.createElement("span");
    rowIdx.className = "pix-pp-rowidx";
    rowIdx.textContent = String(idx + 1);
    rowIdx.title = "Click to make this the active row";
    rowIdx.addEventListener("click", () => rowHandlers.onActiveChange(idx));
    head.appendChild(rowIdx);

    const label = document.createElement("input");
    label.type = "text";
    label.className = "pix-pp-label";
    label.value = row.label || "";
    label.placeholder = `Prompt ${idx + 1}`;
    head.appendChild(label);
    attachLabelEditor(node, label, row.id);

    const del = document.createElement("button");
    del.className = "pix-pp-delete";
    del.type = "button";
    del.textContent = "✕"; // ✕
    del.title = "Delete row";
    del.disabled = state.rows.length <= 1;
    del.addEventListener("click", () => rowHandlers.onDelete(row.id));
    head.appendChild(del);

    rowEl.appendChild(head);

    const ta = document.createElement("textarea");
    ta.className = "pix-pp-textarea";
    ta.value = row.text || "";
    ta.rows = 2;
    ta.placeholder = "Type a prompt. The active row's text is sent to the output.";
    rowEl.appendChild(ta);
    attachTextareaEditor(node, ta, row.id);

    attachDragHandlers(node, rowEl, row.id, rowHandlers.onDrop);

    root.appendChild(rowEl);
  });

  // Actions
  const actions = document.createElement("div");
  actions.className = "pix-pp-actions";

  const add = document.createElement("button");
  add.className = "pix-pp-add";
  add.type = "button";
  add.textContent = "+ Add prompt";
  add.addEventListener("click", () => rowHandlers.onAdd());
  actions.appendChild(add);

  const clear = document.createElement("button");
  clear.className = "pix-pp-clear";
  clear.type = "button";
  clear.textContent = "Clear text";
  clear.title = "Empty the text in every row (keeps rows, labels and active selection)";
  clear.addEventListener("click", () => rowHandlers.onClearAll());
  actions.appendChild(clear);

  const reset = document.createElement("button");
  reset.className = "pix-pp-reset";
  reset.type = "button";
  reset.textContent = "Reset";
  reset.title = "Reset to default (one empty row, no label)";
  reset.addEventListener("click", () => rowHandlers.onReset());
  actions.appendChild(reset);

  // Reactive button enable/disable. Walks live DOM inputs so the buttons
  // update on every keystroke without needing a re-render.
  const refreshActionButtons = () => {
    const tas = root.querySelectorAll(".pix-pp-textarea");
    let anyText = false;
    for (const ta of tas) {
      if (ta.value && ta.value.trim()) { anyText = true; break; }
    }
    clear.disabled = !anyText;

    const labels = root.querySelectorAll(".pix-pp-label");
    let anyLabel = false;
    for (const lab of labels) {
      if (lab.value && lab.value.trim()) { anyLabel = true; break; }
    }
    const s = readState(node);
    const notDefaultCount = s.rows.length !== 1;
    const notDefaultActive = s.activeIndex !== 0;
    reset.disabled = !(anyText || anyLabel || notDefaultCount || notDefaultActive);
  };
  refreshActionButtons();
  node._pixPpRefreshClear = refreshActionButtons;

  root.appendChild(actions);
}
