// State + persistence helpers for Pause Image Pixaroma.
// State lives on node.properties so it survives workflow save AND Vue tab
// switches (LiteGraph serializes node.properties natively).

export const STATE_PROP = "pauseImageState";

// Persisted shape (kept MINIMAL so the load path never rewrites serialized
// state and falsely flags the workflow modified - Vue Compat #18):
//   gate:  "pause" (default) | "pass"
//   frame: { filename, subfolder, type } of the last snapshot (for restore)
// "hasSnapshot" and the dimensions label are RUNTIME-only (derived from whether
// the frame's file actually loads): node._pixPauseHasSnapshot, set by ui.mjs
// showFrame(). They must NOT live in node.properties, or a load-time image
// resolution (e.g. a temp snapshot gone after a restart) would mutate the saved
// state on open and dirty an unedited workflow.
export function getState(node) {
  node.properties = node.properties || {};
  let s = node.properties[STATE_PROP];
  if (!s || typeof s !== "object") {
    s = { gate: "pause", frame: null };
    node.properties[STATE_PROP] = s;
  }
  if (s.gate !== "pause" && s.gate !== "pass") s.gate = "pause";
  return s;
}

export function setGate(node, gate) {
  const s = getState(node);
  s.gate = gate === "pass" ? "pass" : "pause";
}
