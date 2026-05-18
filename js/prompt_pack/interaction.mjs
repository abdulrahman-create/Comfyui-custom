// Prompt Pack Pixaroma - event wiring.
//
// Hooks up the pill toggle, textarea, and Clear button to state mutations +
// counter updates. All real state changes go through core.mjs helpers; this
// module is just glue between DOM events and the state layer.

import { setMode, setText, readState, MODE_PARAGRAPH, MODE_LINE } from "./core.mjs";
import { applyState, updateCounter, updateClearButton } from "./render.mjs";

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
    const state = readState(node);
    updateCounter(root, state);
    updateClearButton(root, state);
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

  // Clear prompts button. Confirms before wiping (textarea Ctrl+Z does NOT
  // undo programmatic value assignment, so once cleared, the prompts are gone).
  els.clearBtn.addEventListener("click", async () => {
    if (els.clearBtn.disabled) return;
    const ok = await pixConfirm({
      title: "Clear prompts?",
      message: "This will empty the textarea. Cannot be undone.",
      okText: "Clear",
      cancelText: "Cancel",
    });
    if (!ok) return;
    setText(node, "");
    applyState(root, readState(node));
    node.setDirtyCanvas(true, true);
  });

  // Don't let pointer events on the button start a node drag.
  els.clearBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  els.clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
}

// Themed confirm dialog. Same pattern as Prompt Multi / Prompt Stack pixConfirm.
// Returns a Promise<boolean>: true on OK, false on Cancel / Escape / backdrop click.
export function pixConfirm({ title, message, okText = "OK", cancelText = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "pix-pp-confirm-backdrop";

    const box = document.createElement("div");
    box.className = "pix-pp-confirm-box";

    const titleEl = document.createElement("div");
    titleEl.className = "pix-pp-confirm-title";
    titleEl.textContent = title || "Confirm";
    box.appendChild(titleEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "pix-pp-confirm-msg";
      msgEl.textContent = message;
      box.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "pix-pp-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pix-pp-confirm-btn";
    cancelBtn.textContent = cancelText;
    actions.appendChild(cancelBtn);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pix-pp-confirm-btn primary";
    okBtn.textContent = okText;
    actions.appendChild(okBtn);

    box.appendChild(actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); finish(true); }
    };
    window.addEventListener("keydown", onKey, true);

    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) finish(false);
    });
    cancelBtn.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => finish(true));

    queueMicrotask(() => okBtn.focus());
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
