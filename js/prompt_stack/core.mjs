// Prompt Stack Pixaroma - state module.
//
// State lives on node.properties.promptStackState.
// Shape: { version: 1, rows: [ { id, enabled, label, text } ] }
//
// LiteGraph serializes node.properties natively into workflow JSON, so save and
// reload are automatic. The graphToPrompt hook in index.js packs this state +
// the resolved separator setting into the hidden PromptStackState input at
// workflow-submit time.

export const STATE_PROP = "promptStackState";

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `r${Date.now().toString(36)}_${_idCounter}`;
}

export function freshRow(overrides = {}) {
  return {
    id: nextId(),
    enabled: true,
    label: "",
    text: "",
    ...overrides,
  };
}

export function defaultState() {
  return {
    version: 1,
    rows: [freshRow()],
  };
}

export function readState(node) {
  const s = node.properties?.[STATE_PROP];
  if (!s || typeof s !== "object") return defaultState();
  if (!Array.isArray(s.rows) || s.rows.length === 0) return defaultState();
  // Re-stamp ids if any are missing (defensive against hand-edited workflow JSON).
  // Strip any legacy wireMode / wireIndex fields (the v1 wire-mode feature
  // was removed; rows are always treated as typed mode now).
  for (const row of s.rows) {
    if (typeof row.id !== "string" || !row.id) row.id = nextId();
    if (typeof row.enabled !== "boolean") row.enabled = true;
    if (typeof row.label !== "string") row.label = "";
    if (typeof row.text !== "string") row.text = "";
    if ("wireMode" in row) delete row.wireMode;
    if ("wireIndex" in row) delete row.wireIndex;
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
  state.rows = state.rows.filter((r) => r.id !== id);
  writeState(node, state);
}

export function toggleEnabled(node, id) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (row) row.enabled = !row.enabled;
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
  const [moved] = state.rows.splice(fromIdx, 1);
  state.rows.splice(toIdx, 0, moved);
  writeState(node, state);
}

// restoreFromProperties: ensures node.properties.promptStackState exists with
// a default row, applies the readState normalization (which migrates legacy
// wire-mode fields out of the schema).
export function restoreFromProperties(node) {
  writeState(node, readState(node));
}
