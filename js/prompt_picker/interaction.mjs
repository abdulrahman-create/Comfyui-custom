// Prompt Picker Pixaroma - input field wiring (label, textarea) +
// drag-to-reorder + themed confirm dialog. Mirrors Prompt Multi's helpers.
//
// All input events use stopImmediatePropagation so they don't escape into
// ComfyUI's canvas keybindings (Load Image Pattern #6).

import { setLabel, setText } from "./core.mjs";

export function attachLabelEditor(node, inputEl, rowId) {
  const original = inputEl.value;
  let staged = original;

  const commit = () => {
    if (staged !== inputEl.dataset.committed) {
      setLabel(node, rowId, staged);
      inputEl.dataset.committed = staged;
    }
  };

  inputEl.dataset.committed = original;

  inputEl.addEventListener("input", (e) => {
    e.stopImmediatePropagation();
    staged = inputEl.value;
    if (typeof node._pixPpRefreshClear === "function") node._pixPpRefreshClear();
  });

  inputEl.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      inputEl.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      inputEl.value = inputEl.dataset.committed;
      staged = inputEl.dataset.committed;
      inputEl.blur();
    }
  });

  inputEl.addEventListener("blur", commit);

  inputEl.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  inputEl.addEventListener("mousedown", (e) => e.stopImmediatePropagation());
}

export function attachTextareaEditor(node, taEl, rowId) {
  taEl.dataset.committed = taEl.value;
  let pending = false;

  const commit = () => {
    if (taEl.value !== taEl.dataset.committed) {
      setText(node, rowId, taEl.value);
      taEl.dataset.committed = taEl.value;
    }
    pending = false;
  };

  taEl.addEventListener("input", (e) => {
    e.stopImmediatePropagation();
    autoGrow(taEl);
    if (typeof node._pixPpGrow === "function") node._pixPpGrow();
    if (typeof node._pixPpRefreshClear === "function") node._pixPpRefreshClear();
    if (!pending) {
      pending = true;
      requestAnimationFrame(commit);
    }
  });

  taEl.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
  });

  taEl.addEventListener("blur", commit);

  taEl.addEventListener("pointerdown", (e) => e.stopImmediatePropagation());
  taEl.addEventListener("mousedown", (e) => e.stopImmediatePropagation());

  requestAnimationFrame(() => {
    autoGrow(taEl);
    if (typeof node._pixPpGrow === "function") node._pixPpGrow();
  });
}

function autoGrow(ta) {
  ta.style.height = "auto";
  const h = Math.min(ta.scrollHeight, 120);
  ta.style.height = h + "px";
}

// pixConfirm: themed confirm dialog. Returns Promise<boolean>.
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


// Drag-to-reorder rows. Same HTML5 drag-drop pattern as Prompt Multi.
const _drag = { id: null };

export function attachDragHandlers(node, rowEl, rowId, onDrop) {
  rowEl.addEventListener("dragstart", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "button") {
      e.preventDefault();
      return;
    }
    _drag.id = rowId;
    rowEl.classList.add("is-dragging");
    try { e.dataTransfer.effectAllowed = "move"; } catch (_) {}
    try { e.dataTransfer.setData("text/plain", rowId); } catch (_) {}
  });

  rowEl.addEventListener("dragover", (e) => {
    if (!_drag.id || _drag.id === rowId) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
    const rect = rowEl.getBoundingClientRect();
    const isAbove = (e.clientY - rect.top) < rect.height / 2;
    rowEl.classList.toggle("is-drop-target-above", isAbove);
    rowEl.classList.toggle("is-drop-target-below", !isAbove);
  });

  rowEl.addEventListener("dragleave", () => {
    rowEl.classList.remove("is-drop-target-above");
    rowEl.classList.remove("is-drop-target-below");
  });

  rowEl.addEventListener("drop", (e) => {
    if (!_drag.id || _drag.id === rowId) return;
    e.preventDefault();
    const above = rowEl.classList.contains("is-drop-target-above");
    rowEl.classList.remove("is-drop-target-above");
    rowEl.classList.remove("is-drop-target-below");
    onDrop(_drag.id, rowId, above);
    _drag.id = null;
  });

  rowEl.addEventListener("dragend", () => {
    rowEl.classList.remove("is-dragging");
    _drag.id = null;
    const siblings = rowEl.parentElement?.querySelectorAll(".pix-pp-row") || [];
    siblings.forEach((s) => {
      s.classList.remove("is-drop-target-above");
      s.classList.remove("is-drop-target-below");
      s.classList.remove("is-dragging");
    });
  });
}
