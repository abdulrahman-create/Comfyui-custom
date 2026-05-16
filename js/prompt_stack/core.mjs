// Prompt Stack Pixaroma - state module.
//
// State lives on node.properties.promptStackState.
// Shape: { version: 1, rows: [ { id, enabled, wireMode, wireIndex, label, text } ] }
//
// LiteGraph serializes node.properties natively into workflow JSON, so save and
// reload are automatic. The graphToPrompt hook in index.js packs this state +
// the resolved separator setting into the hidden PromptStackState input at
// workflow-submit time.

export const STATE_PROP = "promptStackState";
export const MAX_WIRES = 16;

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `r${Date.now().toString(36)}_${_idCounter}`;
}

export function freshRow(overrides = {}) {
  return {
    id: nextId(),
    enabled: true,
    wireMode: false,
    wireIndex: null,
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
  for (const row of s.rows) {
    if (typeof row.id !== "string" || !row.id) row.id = nextId();
    if (typeof row.enabled !== "boolean") row.enabled = true;
    if (typeof row.wireMode !== "boolean") row.wireMode = false;
    if (row.wireMode && (!Number.isInteger(row.wireIndex) || row.wireIndex < 1 || row.wireIndex > MAX_WIRES)) {
      // Wire mode without a valid index downgrades to typed mode, preserving typed text.
      row.wireMode = false;
      row.wireIndex = null;
    }
    if (typeof row.label !== "string") row.label = "";
    if (typeof row.text !== "string") row.text = "";
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

export function reorderRows(node, fromIdx, toIdx) {
  const state = readState(node);
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= state.rows.length) return;
  if (toIdx < 0 || toIdx >= state.rows.length) return;
  const [moved] = state.rows.splice(fromIdx, 1);
  state.rows.splice(toIdx, 0, moved);
  writeState(node, state);
}

export function allocWireIndex(state) {
  const used = new Set(state.rows.filter((r) => r.wireIndex != null).map((r) => r.wireIndex));
  for (let i = 1; i <= MAX_WIRES; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

// restoreFromProperties: stub for Task 4 to fill once render exists. For now it
// just ensures state is initialized so subsequent code can rely on it.
export function restoreFromProperties(node) {
  // Ensures node.properties.promptStackState exists with a default row.
  writeState(node, readState(node));
}

// Wire-slot management.
//
// The Python side pre-declares wire_1 .. wire_16 as OPTIONAL STRING inputs in
// INPUT_TYPES. ComfyUI auto-creates 16 slots on node construction; index.js
// removes all of them at setup so the node starts clean. We then dynamically
// add slots back via node.addInput("wire_N", "STRING") when a row flips into
// wire mode, and remove them via node.removeInput when the row flips back or
// is deleted.
//
// Slot dots are visually aligned with their corresponding row by setting
// slot.pos = [0, rowY] in node-local coords. rowY is read from the DOM row
// element's offsetTop inside the DOM widget root + the widget's last_y.

const WIRE_SLOT_PREFIX = "wire_";

export function wireSlotName(idx) {
  return `${WIRE_SLOT_PREFIX}${idx}`;
}

export function findWireSlotIndex(node, idx) {
  if (!node.inputs) return -1;
  const name = wireSlotName(idx);
  for (let i = 0; i < node.inputs.length; i++) {
    if (node.inputs[i] && node.inputs[i].name === name) return i;
  }
  return -1;
}

export function addWireSlot(node, idx) {
  if (findWireSlotIndex(node, idx) >= 0) return;
  const slot = node.addInput(wireSlotName(idx), "STRING");
  if (slot) {
    // Zero-width space label to suppress native LiteGraph label rendering
    // (Switch Pixaroma pattern, Vue Compat #16).
    slot.label = "​";
  }
}

export function removeWireSlot(node, idx) {
  const i = findWireSlotIndex(node, idx);
  if (i < 0) return;
  node.removeInput(i);
}

// toggleWireMode: returns { ok, allocatedIndex, freedIndex, reason } so the
// caller can add/remove the input slot to match.
export function toggleWireMode(node, id) {
  const state = readState(node);
  const row = state.rows.find((r) => r.id === id);
  if (!row) return { ok: false };
  if (!row.wireMode) {
    const idx = allocWireIndex(state);
    if (idx == null) return { ok: false, reason: "max_wires" };
    row.wireMode = true;
    row.wireIndex = idx;
    writeState(node, state);
    return { ok: true, allocatedIndex: idx };
  } else {
    const freed = row.wireIndex;
    row.wireMode = false;
    row.wireIndex = null;
    writeState(node, state);
    return { ok: true, freedIndex: freed };
  }
}

// applyWireSlotPositions: walks state, ensures node.inputs matches wire-mode
// rows, and aligns each slot's pos with its row's vertical center.
//
// rowYResolver(rowId) -> number | null. Should return the row's Y in node-local
// body coords (relative to the top of the node body, NOT the title bar).
// Returns null if the row's DOM element can't be measured.
export function applyWireSlotPositions(node, rowYResolver) {
  const state = readState(node);
  // 1. Ensure every wire-mode row has its slot present.
  const wantedIndices = new Set();
  for (const row of state.rows) {
    if (row.wireMode && row.wireIndex != null) {
      wantedIndices.add(row.wireIndex);
      if (findWireSlotIndex(node, row.wireIndex) < 0) {
        addWireSlot(node, row.wireIndex);
      }
    }
  }
  // 2. Remove any wire_N slot whose index is no longer wanted.
  if (node.inputs) {
    for (let i = node.inputs.length - 1; i >= 0; i--) {
      const inp = node.inputs[i];
      if (!inp || typeof inp.name !== "string") continue;
      if (!inp.name.startsWith(WIRE_SLOT_PREFIX)) continue;
      const n = parseInt(inp.name.slice(WIRE_SLOT_PREFIX.length), 10);
      if (!wantedIndices.has(n)) node.removeInput(i);
    }
  }
  // 3. Position each remaining wire slot at its row's Y.
  for (const row of state.rows) {
    if (!row.wireMode || row.wireIndex == null) continue;
    const slotIdx = findWireSlotIndex(node, row.wireIndex);
    if (slotIdx < 0) continue;
    const y = rowYResolver(row.id);
    if (y == null) continue;
    node.inputs[slotIdx].pos = [0, y];
  }
}
