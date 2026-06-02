// State + persistence helpers for Pause Image Pixaroma.
// State lives on node.properties so it survives workflow save AND Vue tab
// switches (LiteGraph serializes node.properties natively).

export const STATE_PROP = "pauseImageState";

// Shape:
//   gate:        "pause" (default) | "pass"
//   hasSnapshot: whether a snapshot preview is currently available
//   frame:       { filename, subfolder, type } of the last snapshot (for restore)
//   dims:        "1024 × 1024" label text
export function getState(node) {
  node.properties = node.properties || {};
  let s = node.properties[STATE_PROP];
  if (!s || typeof s !== "object") {
    s = { gate: "pause", hasSnapshot: false, frame: null, dims: "" };
    node.properties[STATE_PROP] = s;
  }
  if (s.gate !== "pause" && s.gate !== "pass") s.gate = "pause";
  return s;
}

export function setGate(node, gate) {
  const s = getState(node);
  s.gate = gate === "pass" ? "pass" : "pause";
}
