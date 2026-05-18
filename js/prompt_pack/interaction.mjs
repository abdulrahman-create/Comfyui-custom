// Prompt Pack Pixaroma - event wiring.
//
// Hooks up the pill toggle and textarea to state mutations + counter updates.
// All real state changes go through core.mjs helpers; this module is just
// glue between DOM events and the state layer.

import { setMode, setText, readState, MODE_PARAGRAPH, MODE_LINE } from "./core.mjs";
import { applyState, updateCounter } from "./render.mjs";

export function wireEvents(node, root) {
  const els = root._pixPp;
  if (!els) return;

  els.pillPara.addEventListener("click", () => {
    setMode(node, MODE_PARAGRAPH);
    applyState(root, readState(node));
    node.setDirtyCanvas(true, true);
  });
  els.pillLine.addEventListener("click", () => {
    setMode(node, MODE_LINE);
    applyState(root, readState(node));
    node.setDirtyCanvas(true, true);
  });

  // Textarea typing - update state on every keystroke (cheap) and recount.
  // We use 'input' (not 'change') so the counter is live.
  els.ta.addEventListener("input", () => {
    setText(node, els.ta.value);
    updateCounter(root, readState(node));
  });

  // Block ComfyUI / LiteGraph keyboard shortcuts from leaking out of the
  // textarea (e.g. Q for queue, Delete for node delete, Ctrl+Enter, etc.).
  // stopPropagation on keydown is enough - ComfyUI listens at document level.
  els.ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
  });

  // Prevent the canvas from grabbing focus when the user clicks inside the
  // textarea - same defensive pattern used in other Pixaroma nodes.
  els.ta.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
}

// Toast helper - same as Prompt Multi's showNoEnabledToast pattern.
// Uses ComfyUI's modern toast API first, falls back to a hand-rolled orange
// banner for older builds that don't have extensionManager.toast.
export function showNoPromptsToast(app) {
  const msg = "Paste at least one prompt to run.";
  const tm = app.extensionManager?.toast;
  if (tm && typeof tm.add === "function") {
    try {
      tm.add({ severity: "warn", summary: "Prompt Pack", detail: msg, life: 4000 });
      return;
    } catch (_e) { /* fall through */ }
  }
  console.warn("[Pixaroma.PromptPack] " + msg);
  try {
    const banner = document.createElement("div");
    banner.textContent = msg;
    banner.style.cssText = "position:fixed;top:60px;right:20px;background:#1d1d1d;color:#fff;font:14px sans-serif;padding:10px 14px;border-radius:6px;border:2px solid #f66744;z-index:99999;";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
  } catch (_e) {}
}
