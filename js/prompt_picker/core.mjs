// Prompt Picker Pixaroma - state module.
//
// State lives on node.properties.promptPickerState.
// Shape: { version: 1, rows: [ { id, label, text } ], activeIndex }
//
// LiteGraph serializes node.properties natively into workflow JSON, so save
// and reload are automatic. The graphToPrompt hook in index.js packs the
// active row's text into the hidden PromptPickerState input at
// workflow-submit time.
//
// Unlike Prompt Multi, rows here have NO enabled flag - only one row is the
// "active" one at any time, picked via the small index selector on the node.

export const STATE_PROP = "promptPickerState";

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `r${Date.now().toString(36)}_${_idCounter}`;
}

export function freshRow(overrides = {}) {
  return {
    id: nextId(),
    label: "",
    text: "",
    ...overrides,
  };
}

export function defaultState() {
  return {
    version: 1,
    rows: [freshRow()],
    activeIndex: 0,
  };
}

export function readState(node) {
  const s = node.properties?.[STATE_PROP];
  if (!s || typeof s !== "object") return defaultState();
  if (!Array.isArray(s.rows) || s.rows.length === 0) return defaultState();
  for (const row of s.rows) {
    if (typeof row.id !== "string" || !row.id) row.id = nextId();
    if (typeof row.label !== "string") row.label = "";
    if (typeof row.text !== "string") row.text = "";
  }
  if (typeof s.activeIndex !== "number" || s.activeIndex < 0 || s.activeIndex >= s.rows.length) {
    s.activeIndex = 0;
  }
  return s;
}

export function writeState(node, state) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = state;
}

export function addRow(node) {
  const state = readState(node);
  state.rows.push(freshRow());
  writeState(node, state);
}

export function deleteRow(node, id) {
  const state = readState(node);
  if (state.rows.length <= 1) return;
  const idx = state.rows.findIndex((r) => r.id === id);
  state.rows = state.rows.filter((r) => r.id !== id);
  // Clamp activeIndex into the new range. If the deleted row WAS the active
  // one, step back by one so the user lands on a sensible neighbour rather
  // than a different prompt at the same index.
  if (idx < 0) return writeState(node, state);
  if (idx < state.activeIndex) state.activeIndex -= 1;
  else if (idx === state.activeIndex && state.activeIndex >= state.rows.length) {
    state.activeIndex = state.rows.length - 1;
  }
  if (state.activeIndex < 0) state.activeIndex = 0;
  writeState(node, state);
}

export function setLabel(node, id, label) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (row) row.label = String(label || "");
  writeState(node, state);
}

export function setText(node, id, text) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (row) row.text = String(text || "");
  writeState(node, state);
}

export function setActiveIndex(node, idx) {
  const state = readState(node);
  if (typeof idx !== "number") return;
  if (idx < 0) idx = 0;
  if (idx >= state.rows.length) idx = state.rows.length - 1;
  state.activeIndex = idx;
  writeState(node, state);
}

export function stepActive(node, delta) {
  const state = readState(node);
  setActiveIndex(node, state.activeIndex + delta);
}

export function clearAllText(node) {
  const state = readState(node);
  for (const row of state.rows) row.text = "";
  writeState(node, state);
}

export function resetToDefault(node) {
  writeState(node, defaultState());
}

export function reorderRows(node, fromIdx, toIdx) {
  const state = readState(node);
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= state.rows.length) return;
  if (toIdx < 0 || toIdx >= state.rows.length) return;
  const wasActive = state.activeIndex === fromIdx;
  const [moved] = state.rows.splice(fromIdx, 1);
  state.rows.splice(toIdx, 0, moved);
  // Keep the same row visually-active after a reorder.
  if (wasActive) {
    state.activeIndex = toIdx;
  } else {
    // If the active row was inside the moved range, shift its index.
    let a = state.activeIndex;
    if (fromIdx < a && toIdx >= a) a -= 1;
    else if (fromIdx > a && toIdx <= a) a += 1;
    state.activeIndex = a;
  }
  writeState(node, state);
}

export function restoreFromProperties(node) {
  writeState(node, readState(node));
}
