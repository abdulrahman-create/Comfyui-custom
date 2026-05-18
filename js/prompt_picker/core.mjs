// Prompt Picker Pixaroma - state module.
//
// State lives on node.properties.promptPickerState.
// Shape: {
//   version: 2,
//   rows:  [ { id, label, text } ],  // the library of labeled prompts
//   picks: [ { rowIndex } ],         // one entry per active output slot
// }
//
// MAX_PICKS caps the number of output slots (mirrors MAX_OUTPUTS in the
// Python backend - keep in sync).
//
// LiteGraph serializes node.properties natively into workflow JSON, so save
// and reload are automatic. The graphToPrompt hook in index.js resolves
// each pick's rowIndex into the text and ships an array as
// state.pickTexts in the hidden PromptPickerState input at submit time.

export const STATE_PROP = "promptPickerState";
export const MAX_PICKS = 8;

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

export function freshPick(rowIndex = 0) {
  return { rowIndex };
}

export function defaultState() {
  return {
    version: 2,
    rows: [freshRow()],
    picks: [freshPick(0)],
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
  // Migration: v1 schema had a single activeIndex instead of picks[].
  if (!Array.isArray(s.picks)) {
    const legacyIdx = typeof s.activeIndex === "number" ? s.activeIndex : 0;
    s.picks = [freshPick(Math.max(0, Math.min(legacyIdx, s.rows.length - 1)))];
  }
  // Defensive: ensure each pick has a valid rowIndex.
  for (const p of s.picks) {
    if (typeof p.rowIndex !== "number" || p.rowIndex < 0 || p.rowIndex >= s.rows.length) {
      p.rowIndex = 0;
    }
  }
  if (s.picks.length === 0) s.picks = [freshPick(0)];
  if (s.picks.length > MAX_PICKS) s.picks = s.picks.slice(0, MAX_PICKS);
  s.version = 2;
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
  if (idx < 0) return;
  state.rows = state.rows.filter((r) => r.id !== id);
  // Any pick that pointed AT this row falls back to row 0; picks pointing
  // at a row AFTER the deleted one shift down by one.
  for (const p of state.picks) {
    if (p.rowIndex === idx) p.rowIndex = 0;
    else if (p.rowIndex > idx) p.rowIndex -= 1;
    if (p.rowIndex >= state.rows.length) p.rowIndex = state.rows.length - 1;
    if (p.rowIndex < 0) p.rowIndex = 0;
  }
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

export function setPickRow(node, pickIdx, rowIdx) {
  const state = readState(node);
  if (pickIdx < 0 || pickIdx >= state.picks.length) return;
  if (rowIdx < 0) rowIdx = 0;
  if (rowIdx >= state.rows.length) rowIdx = state.rows.length - 1;
  state.picks[pickIdx].rowIndex = rowIdx;
  writeState(node, state);
}

export function addPick(node) {
  const state = readState(node);
  if (state.picks.length >= MAX_PICKS) return false;
  // New picks default to row 0 - safest landing spot regardless of library size.
  state.picks.push(freshPick(0));
  writeState(node, state);
  return true;
}

export function removePick(node, pickIdx) {
  const state = readState(node);
  if (state.picks.length <= 1) return false;
  if (pickIdx < 0 || pickIdx >= state.picks.length) return false;
  state.picks.splice(pickIdx, 1);
  writeState(node, state);
  return true;
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
  // Re-map every pick's rowIndex so the same VISUAL row stays picked.
  for (const p of state.picks) {
    if (p.rowIndex === fromIdx) p.rowIndex = toIdx;
    else if (fromIdx < p.rowIndex && toIdx >= p.rowIndex) p.rowIndex -= 1;
    else if (fromIdx > p.rowIndex && toIdx <= p.rowIndex) p.rowIndex += 1;
    if (p.rowIndex < 0) p.rowIndex = 0;
    if (p.rowIndex >= state.rows.length) p.rowIndex = state.rows.length - 1;
  }
  writeState(node, state);
}

export function restoreFromProperties(node) {
  writeState(node, readState(node));
}
