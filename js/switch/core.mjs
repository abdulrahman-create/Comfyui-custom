import { app } from "/scripts/app.js";
import { attachRowWidgets } from "./render.mjs";

// State lives on node.properties.switchState. LiteGraph serializes
// node.properties natively into the workflow JSON, so labels and the
// active index survive workflow save/load and tab switching.
const STATE_PROP = "switchState";
const MAX_INPUTS = 32;
const SLOT_NAME = (i) => `input_${i}`;  // 1-based

function defaultState() {
  return { activeIndex: 0, labels: {}, visibleCount: 1 };
}

function readState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties[STATE_PROP]) {
    node.properties[STATE_PROP] = defaultState();
  }
  return node.properties[STATE_PROP];
}

function isSlotConnected(node, slotIdx /* 1-based */) {
  const slot = node.inputs?.[slotIdx - 1];
  return slot != null && slot.link != null;
}

function connectedCount(node) {
  let n = 0;
  for (let i = 1; i <= MAX_INPUTS; i++) {
    if (isSlotConnected(node, i)) n++;
  }
  return n;
}

// Strip every native input slot that ComfyUI auto-created from the 32
// pre-declared optional inputs. We rebuild only the slots we want
// (connected + one trailing empty) ourselves.
function clearNativeInputs(node) {
  if (!node.inputs) return;
  // Walk backwards so removeInput's array shift doesn't skip entries.
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    node.removeInput(i);
  }
}

// Add a single empty input slot at the bottom (1-based index = current
// length + 1). slot.name is the contiguous input_N string and must stay
// intact - it becomes the workflow JSON key that Python reads via kwargs.
function addInputSlot(node, idx) {
  const slot = node.addInput(SLOT_NAME(idx), "*");
  // Suppress the visible slot label without touching slot.name.
  //
  // Both the canvas renderer (NodeSlot.renderingLabel getter) and the
  // Vue InputSlot component use logical-OR chains:
  //   slot.label || slot.localized_name || slot.name
  // An empty string ("") is falsy, so "" falls through to slot.name
  // ("input_1", "input_2", ...) and the name text is rendered.
  //
  // A zero-width space (​) is truthy, so the chain stops there and
  // renders an invisible character -- no text visible, name stays intact
  // for Python kwarg routing.  label is also NOT serialized into the
  // workflow JSON (configure() only restores name/type/shape/localized_name)
  // so restoreFromProperties re-applies this on every workflow load.
  slot.label = "​";
  return slot;
}

export function setupNode(node) {
  const state = readState(node);
  clearNativeInputs(node);
  // Rebuild: connected slots first, then one trailing empty.
  // (For a fresh node, state.visibleCount = 1, so just one empty slot.)
  const target = Math.max(1, Math.min(state.visibleCount || 1, MAX_INPUTS));
  for (let i = 1; i <= target; i++) {
    addInputSlot(node, i);
  }
  state.visibleCount = target;
  attachRowWidgets(node);
  installConnectionPosOverride(node);
  // Recompute node height from the actual slot/widget count now that we
  // have stripped the 32 auto-created inputs down to just `target`.
  // Without this the node body stays at the ~1100 px height LiteGraph
  // computed before we called clearNativeInputs.
  node.setSize(node.computeSize());
  node.graph?.setDirtyCanvas?.(true, true);
}

// Called from index.js's onConfigure to re-render after workflow load
// restores node.properties + node.inputs from JSON.
export function restoreFromProperties(node) {
  const state = readState(node);
  // The slots themselves are restored by LiteGraph from the saved JSON.
  // Re-apply the zero-width-space label to every slot so the visible name
  // text stays suppressed (see addInputSlot comment for full rationale).
  // slot.label is NOT in the serialized keys so it is not restored from
  // JSON and must be patched here after every workflow load.
  if (node.inputs) {
    for (const slot of node.inputs) slot.label = "​";
  }
  state.visibleCount = node.inputs?.length || 1;
  attachRowWidgets(node);
  installConnectionPosOverride(node);
  node.setSize(node.computeSize());
  node.graph?.setDirtyCanvas?.(true, true);
}

// Move the input slot dots out of LiteGraph's default top-stacked
// position into the centre-left of each row widget. The wire endpoint
// follows because LG uses getConnectionPos for wire routing.
//
// Each input slot index N (0-based in LG's array) corresponds to row
// widget _slotIdx = N + 1 (1-based). We look up the widget by _slotIdx
// and use its last_y (set by LG during draw) as the row's top.
function installConnectionPosOverride(node) {
  if (node._switchGetConnectionPosInstalled) return;
  node._switchGetConnectionPosInstalled = true;
  const orig = node.getConnectionPos.bind(node);
  const ROW_H_HALF = 14;  // matches ROW_H / 2 from render.mjs

  node.getConnectionPos = function (isInput, slotIdx, out) {
    out = out || [0, 0];
    if (isInput) {
      // Match input slot N (0-based) to its row widget (1-based _slotIdx).
      const widget = this.widgets?.find(
        (w) => w._slotIdx === slotIdx + 1
      );
      if (widget && widget.last_y != null) {
        out[0] = this.pos[0];                           // left edge of the node
        out[1] = this.pos[1] + widget.last_y + ROW_H_HALF;
        return out;
      }
    }
    return orig(isInput, slotIdx, out);
  };
}

export { STATE_PROP, MAX_INPUTS };
