// Prompt Picker Pixaroma - DOM widget render.
//
// Layout (top -> bottom):
//   - Library: one row per labeled prompt (label + textarea, drag handle, X)
//   - Outputs: one entry per output slot (label "text_N" + index picker +
//     row preview + X to remove the output)
//   - Actions: + Add prompt | Clear text | Reset
//
// Click handlers + drag handlers come from interaction.mjs.

import { readState, MAX_PICKS } from "./core.mjs";
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

.pix-pp-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
  border-radius: 4px;
  background: #232323;
  border: 1px solid #2e2e2e;
  position: relative;
  transition: background 0.12s ease;
}
.pix-pp-row.is-referenced { background: #262421; border-color: #3a3026; }
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
  min-width: 18px;
  text-align: center;
  color: #777;
  font-size: 11px;
  font-weight: 600;
  user-select: none;
}
.pix-pp-row.is-referenced .pix-pp-rowidx { color: #f66744; }

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

/* Outputs panel */
.pix-pp-outputs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: #1d1d1d;
  border: 1px solid #2e2e2e;
  border-radius: 4px;
  margin-top: 2px;
}
.pix-pp-outputs-title {
  font-size: 10px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 2px;
  user-select: none;
}
.pix-pp-pick {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.pix-pp-pick-name {
  min-width: 50px;
  font-size: 11px;
  font-weight: 600;
  color: #f66744;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  user-select: none;
}
.pix-pp-pick-arrow {
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
.pix-pp-pick-arrow:hover { background: #333; border-color: #f66744; color: #f66744; }
.pix-pp-pick-arrow:disabled { color: #555; border-color: #2e2e2e; background: #232323; cursor: not-allowed; }
.pix-pp-pick-arrow:disabled:hover { background: #232323; border-color: #2e2e2e; color: #555; }
.pix-pp-pick-input {
  width: 38px;
  background: #1a1a1a;
  border: 1px solid #2e2e2e;
  border-radius: 3px;
  color: #ddd;
  font-weight: 600;
  font-size: 12px;
  text-align: center;
  padding: 3px 4px;
  outline: none;
  -moz-appearance: textfield;
}
.pix-pp-pick-input::-webkit-outer-spin-button,
.pix-pp-pick-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pix-pp-pick-input:focus { border-color: #f66744; }
.pix-pp-pick-preview {
  flex: 1;
  font-size: 11px;
  color: #999;
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.pix-pp-pick-delete {
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
.pix-pp-pick-delete:hover { color: #f66744; background: rgba(246,103,68,0.12); }
.pix-pp-pick-delete:disabled { color: #444; cursor: not-allowed; background: transparent; }
.pix-pp-pick-add {
  align-self: flex-start;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 3px;
  color: #ddd;
  cursor: pointer;
  font-size: 11px;
  padding: 3px 8px;
  font-family: inherit;
  margin-top: 3px;
}
.pix-pp-pick-add:hover { background: #333; border-color: #f66744; color: #f66744; }
.pix-pp-pick-add:disabled { color: #555; border-color: #2e2e2e; background: #232323; cursor: not-allowed; }

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

/* Confirm dialog */
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
.pix-pp-confirm-title { font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 8px 0; }
.pix-pp-confirm-msg { font-size: 13px; color: #bbb; margin: 0 0 16px 0; line-height: 1.4; }
.pix-pp-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
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
.pix-pp-confirm-btn.primary { background: #f66744; border-color: #f66744; color: #fff; }
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
// loop, see Load Image Pattern #4).
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

function rowPreviewText(row, fallback) {
  const lbl = (row?.label || "").trim();
  if (lbl) return lbl;
  const txt = (row?.text || "").trim().replace(/\s+/g, " ");
  if (txt) return txt.length > 40 ? txt.slice(0, 40) + "..." : txt;
  return fallback;
}

// rowHandlers shape:
//   { onLabelChange, onTextChange, onDeleteRow, onAddRow, onClearAll, onReset,
//     onSetPickRow(pickIdx, rowIdx), onAddPick, onRemovePick(pickIdx),
//     onDrop(fromId, toId, above) }
export function renderRows(node, root, rowHandlers) {
  const state = readState(node);
  root.innerHTML = "";

  // Build the set of row indices referenced by any pick (for highlighting).
  const referencedRows = new Set(state.picks.map((p) => p.rowIndex));

  // --- Library rows ---
  state.rows.forEach((row, idx) => {
    const rowEl = document.createElement("div");
    rowEl.className = "pix-pp-row" + (referencedRows.has(idx) ? " is-referenced" : "");
    rowEl.dataset.id = row.id;
    rowEl.draggable = true;

    const head = document.createElement("div");
    head.className = "pix-pp-row-head";

    const handle = document.createElement("span");
    handle.className = "pix-pp-handle";
    handle.textContent = "⋮⋮";
    handle.title = "Drag to reorder";
    head.appendChild(handle);

    const rowIdx = document.createElement("span");
    rowIdx.className = "pix-pp-rowidx";
    rowIdx.textContent = String(idx + 1);
    rowIdx.title = referencedRows.has(idx) ? "This row is used by an output" : "Row number";
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
    del.textContent = "✕";
    del.title = "Delete row";
    del.disabled = state.rows.length <= 1;
    del.addEventListener("click", () => rowHandlers.onDeleteRow(row.id));
    head.appendChild(del);

    rowEl.appendChild(head);

    const ta = document.createElement("textarea");
    ta.className = "pix-pp-textarea";
    ta.value = row.text || "";
    ta.rows = 2;
    ta.placeholder = "Type a prompt. Pick this row from the Outputs panel below.";
    rowEl.appendChild(ta);
    attachTextareaEditor(node, ta, row.id);

    attachDragHandlers(node, rowEl, row.id, rowHandlers.onDrop);

    root.appendChild(rowEl);
  });

  // --- Outputs panel ---
  const outputs = document.createElement("div");
  outputs.className = "pix-pp-outputs";

  const outTitle = document.createElement("div");
  outTitle.className = "pix-pp-outputs-title";
  outTitle.textContent = `Outputs (${state.picks.length})`;
  outputs.appendChild(outTitle);

  state.picks.forEach((pick, pickIdx) => {
    const pickRow = document.createElement("div");
    pickRow.className = "pix-pp-pick";

    const name = document.createElement("span");
    name.className = "pix-pp-pick-name";
    name.textContent = `text_${pickIdx + 1}`;
    pickRow.appendChild(name);

    const prevBtn = document.createElement("button");
    prevBtn.className = "pix-pp-pick-arrow";
    prevBtn.type = "button";
    prevBtn.textContent = "◀";
    prevBtn.title = "Previous row";
    prevBtn.disabled = pick.rowIndex <= 0;
    prevBtn.addEventListener("click", () => rowHandlers.onSetPickRow(pickIdx, pick.rowIndex - 1));
    pickRow.appendChild(prevBtn);

    const input = document.createElement("input");
    input.className = "pix-pp-pick-input";
    input.type = "number";
    input.min = "1";
    input.max = String(state.rows.length);
    input.value = String(pick.rowIndex + 1);
    input.title = `Pick which library row sends out as text_${pickIdx + 1} (1-based)`;
    input.addEventListener("change", (e) => {
      const raw = parseInt(e.target.value, 10);
      if (Number.isFinite(raw)) rowHandlers.onSetPickRow(pickIdx, raw - 1);
    });
    input.addEventListener("keydown", (e) => e.stopImmediatePropagation());
    input.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
    input.addEventListener("mousedown", (e) => e.stopImmediatePropagation());
    pickRow.appendChild(input);

    const nextBtn = document.createElement("button");
    nextBtn.className = "pix-pp-pick-arrow";
    nextBtn.type = "button";
    nextBtn.textContent = "▶";
    nextBtn.title = "Next row";
    nextBtn.disabled = pick.rowIndex >= state.rows.length - 1;
    nextBtn.addEventListener("click", () => rowHandlers.onSetPickRow(pickIdx, pick.rowIndex + 1));
    pickRow.appendChild(nextBtn);

    const preview = document.createElement("span");
    preview.className = "pix-pp-pick-preview";
    const picked = state.rows[pick.rowIndex];
    const previewStr = rowPreviewText(picked, `(row ${pick.rowIndex + 1})`);
    preview.textContent = previewStr;
    preview.title = previewStr;
    pickRow.appendChild(preview);

    const del = document.createElement("button");
    del.className = "pix-pp-pick-delete";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Remove this output";
    del.disabled = state.picks.length <= 1;
    del.addEventListener("click", () => rowHandlers.onRemovePick(pickIdx));
    pickRow.appendChild(del);

    outputs.appendChild(pickRow);
  });

  const addPickBtn = document.createElement("button");
  addPickBtn.className = "pix-pp-pick-add";
  addPickBtn.type = "button";
  addPickBtn.textContent = "+ Add output";
  addPickBtn.disabled = state.picks.length >= MAX_PICKS;
  addPickBtn.title = state.picks.length >= MAX_PICKS
    ? `Maximum ${MAX_PICKS} outputs`
    : "Add another output dot on the right side of the node";
  addPickBtn.addEventListener("click", () => rowHandlers.onAddPick());
  outputs.appendChild(addPickBtn);

  root.appendChild(outputs);

  // --- Actions ---
  const actions = document.createElement("div");
  actions.className = "pix-pp-actions";

  const add = document.createElement("button");
  add.className = "pix-pp-add";
  add.type = "button";
  add.textContent = "+ Add prompt";
  add.addEventListener("click", () => rowHandlers.onAddRow());
  actions.appendChild(add);

  const clear = document.createElement("button");
  clear.className = "pix-pp-clear";
  clear.type = "button";
  clear.textContent = "Clear text";
  clear.title = "Empty the text in every row (keeps rows, labels and output picks)";
  clear.addEventListener("click", () => rowHandlers.onClearAll());
  actions.appendChild(clear);

  const reset = document.createElement("button");
  reset.className = "pix-pp-reset";
  reset.type = "button";
  reset.textContent = "Reset";
  reset.title = "Reset to default (one empty row, one output, no label)";
  reset.addEventListener("click", () => rowHandlers.onReset());
  actions.appendChild(reset);

  // Reactive Clear / Reset enable. Walks live DOM inputs so the buttons
  // update on every keystroke without needing a full re-render.
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
    const notDefaultPicks = s.picks.length !== 1 || (s.picks[0]?.rowIndex || 0) !== 0;
    reset.disabled = !(anyText || anyLabel || notDefaultCount || notDefaultPicks);
  };
  refreshActionButtons();
  node._pixPpRefreshClear = refreshActionButtons;

  root.appendChild(actions);
}
