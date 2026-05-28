// Mute Switch Pixaroma - state, slot management, and mute application.
//
// State shape: node.properties.muteSwitchState = {
//   version: 1,
//   selectMode: "single" | "multi",
//   muteMode:   "mute"   | "bypass",
//   rows: [{ enabled: boolean, label: string | null }, ...]
// }
//
// node.properties.muteSwitchOriginalModes = { "<nodeId>": <originalMode> }
//   captured at first mute; deleted on restore.

import { app } from "/scripts/app.js";
import { ROW_H, TOP_PAD, MODE_BAR_H } from "./render.mjs";

export const STATE_PROP = "muteSwitchState";
export const ORIGINAL_MODES_PROP = "muteSwitchOriginalModes";
export const MAX_INPUTS = 32;

const SLOT_NAME = (i) => `input_${i}`; // 1-based

const BOT_PAD = 8;
const DEFAULT_W = 280;
const MIN_BODY_H = MODE_BAR_H + ROW_H + BOT_PAD;

export function defaultState() {
  return {
    version: 1,
    selectMode: "multi",
    muteMode: "mute",
    rows: [],
  };
}

export function readState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = defaultState();
  }
  const s = node.properties[STATE_PROP];
  if (!Array.isArray(s.rows)) s.rows = [];
  return s;
}

export function readOriginalModes(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[ORIGINAL_MODES_PROP]) {
    node.properties[ORIGINAL_MODES_PROP] = {};
  }
  return node.properties[ORIGINAL_MODES_PROP];
}

// Walk backwards to avoid index shifts.
function clearNativeInputs(node) {
  if (!node.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    node.removeInput(i);
  }
}

function addInputSlot(node, idx1) {
  const slot = node.addInput(SLOT_NAME(idx1), "*");
  slot.label = "​"; // zero-width space: truthy, invisible
  return slot;
}

function computeNodeHeight(slotCount) {
  return MODE_BAR_H + TOP_PAD + slotCount * ROW_H + BOT_PAD;
}

// Idempotent normaliser. Trims trailing empties down to one, fills missing
// rows in state.rows, applies zero-width labels, sets size.
export function normalizeSlots(node) {
  if (!node.inputs) return;
  const state = readState(node);

  const beforeLen = node.inputs.length;

  let connected = 0;
  for (const s of node.inputs) if (s.link != null) connected++;

  const target = Math.min(
    Math.max(connected + (connected < MAX_INPUTS ? 1 : 0), 1),
    MAX_INPUTS,
  );

  while ((node.inputs.length || 0) > target) {
    const last = node.inputs[node.inputs.length - 1];
    if (last && last.link != null) break;
    node.removeInput(node.inputs.length - 1);
  }
  while ((node.inputs.length || 0) < target) {
    addInputSlot(node, node.inputs.length + 1);
  }

  for (let i = 0; i < node.inputs.length; i++) {
    const nm = SLOT_NAME(i + 1);
    if (node.inputs[i].name !== nm) node.inputs[i].name = nm;
    if (node.inputs[i].label !== "​") node.inputs[i].label = "​";
  }

  // Push each input dot down by MODE_BAR_H so it aligns with our row paint.
  // slot.pos = [x, y] is body-local. Vue Compat #16: this LG fork reads
  // slot.pos via calculateInputSlotPosFromSlot.
  for (let i = 0; i < node.inputs.length; i++) {
    const y = MODE_BAR_H + TOP_PAD + i * ROW_H + ROW_H / 2;
    node.inputs[i].pos = [0, y];
  }

  // Sync state.rows length to slot count.
  while (state.rows.length < node.inputs.length) {
    // New row default: ON in multi mode, OFF in single mode.
    const enabled = state.selectMode === "single" ? false : true;
    state.rows.push({ enabled, label: null });
  }
  while (state.rows.length > node.inputs.length) {
    state.rows.pop();
  }

  const w = Math.max(node.size[0] || 0, DEFAULT_W);
  if (node.size[0] !== w) node.size[0] = w;

  if (node.inputs.length !== beforeLen) {
    const h = computeNodeHeight(node.inputs.length);
    if (node.size[1] !== h) node.size[1] = h;
  }

  app.graph?.setDirtyCanvas?.(true, true);
}

export function setupNode(node) {
  clearNativeInputs(node);
  normalizeSlots(node);
  node.size[1] = Math.max(node.size[1], MIN_BODY_H);
}

export function restoreFromProperties(node) {
  normalizeSlots(node);
}

// Stubs for later tasks - real versions in Task 3.
export function handleConnect(node /* , slotIdx1 */) {
  normalizeSlots(node);
}
export function handleDisconnect(node /* , slotIdx1 */) {
  setTimeout(() => {
    if (!node.graph) return;
    normalizeSlots(node);
  }, 0);
}
