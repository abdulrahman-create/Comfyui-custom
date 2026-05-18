// Prompt Pack Pixaroma - CSS injection + DOM building.
//
// Layout:
//   .pix-pp-root
//     .pix-pp-modebar              (pill toggle at top)
//       .pix-pp-modepill[.active]  (Paragraph)
//       .pix-pp-modepill[.active]  (Line)
//     .pix-pp-tawrap               (textarea wrapper)
//       .pix-pp-ta                 (the textarea)
//     .pix-pp-bottombar            (bottom strip: clear left, counter right)
//       .pix-pp-clearbtn           (Clear prompts button - left)
//       .pix-pp-counter            (small pill - right)

const BRAND = "#f66744";

let _cssInjected = false;
export function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "pix-pp-css";
  style.textContent = `
    .pix-pp-root {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      color: #e0e0e0;
      font: 12px sans-serif;
    }
    .pix-pp-modebar {
      display: flex;
      gap: 0;
      align-self: flex-start;
      background: #1d1d1d;
      border-radius: 6px;
      padding: 2px;
      flex: 0 0 auto;
    }
    .pix-pp-modepill {
      padding: 3px 12px;
      font: 11px sans-serif;
      color: #888;
      cursor: pointer;
      border-radius: 4px;
      user-select: none;
      transition: background 0.1s, color 0.1s;
    }
    .pix-pp-modepill:hover { color: #ccc; }
    .pix-pp-modepill.active {
      background: ${BRAND};
      color: #fff;
    }
    .pix-pp-tawrap {
      position: relative;
      flex: 1 1 auto;
      min-height: 100px;
      display: flex;
    }
    .pix-pp-ta {
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #1d1d1d;
      color: #e0e0e0;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 6px 8px;
      font: 12px monospace;
      resize: none;
      outline: none;
    }
    .pix-pp-ta:focus { border-color: ${BRAND}; }
    .pix-pp-bottombar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 auto;
      gap: 8px;
      padding: 0 2px;
    }
    .pix-pp-clearbtn {
      background: #2a2a2a;
      border: 1px solid #3a3a3a;
      border-radius: 4px;
      color: #ddd;
      cursor: pointer;
      font: 11px sans-serif;
      padding: 4px 12px;
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    }
    .pix-pp-clearbtn:hover {
      background: #333;
      border-color: ${BRAND};
      color: #fff;
    }
    .pix-pp-clearbtn[disabled] {
      color: #555;
      cursor: default;
      background: #1d1d1d;
      border-color: #2a2a2a;
    }
    .pix-pp-clearbtn[disabled]:hover {
      background: #1d1d1d;
      border-color: #2a2a2a;
      color: #555;
    }
    .pix-pp-counter {
      font: 10px sans-serif;
      color: #888;
      background: #2a2a2a;
      padding: 2px 8px;
      border-radius: 10px;
      user-select: none;
      white-space: nowrap;
    }
    .pix-pp-counter.active {
      color: ${BRAND};
      background: #1d1d1d;
      border: 1px solid ${BRAND};
    }
    .pix-pp-counter.empty {
      color: #555;
    }
    .pix-pp-confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: inherit;
      -webkit-font-smoothing: antialiased;
    }
    .pix-pp-confirm-box {
      background: #1d1d1d;
      border: 1px solid #2e2e2e;
      border-radius: 6px;
      min-width: 320px;
      max-width: 480px;
      padding: 18px 20px;
      color: #ddd;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    }
    .pix-pp-confirm-title {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      margin: 0 0 8px 0;
    }
    .pix-pp-confirm-msg {
      font-size: 13px;
      color: #bbb;
      margin: 0 0 16px 0;
      line-height: 1.4;
    }
    .pix-pp-confirm-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .pix-pp-confirm-btn {
      background: #2a2a2a;
      border: 1px solid #3a3a3a;
      border-radius: 3px;
      color: #ddd;
      cursor: pointer;
      font-size: 12px;
      padding: 6px 14px;
      font-family: inherit;
    }
    .pix-pp-confirm-btn:hover { background: #333; border-color: #555; }
    .pix-pp-confirm-btn.primary {
      background: ${BRAND};
      border-color: ${BRAND};
      color: #fff;
    }
    .pix-pp-confirm-btn.primary:hover { background: #ff7a58; border-color: #ff7a58; }
  `;
  document.head.appendChild(style);
}

// Build the static DOM tree. Returns the root element. The textarea +
// counter + pill + clear button elements are stored on the root for the
// caller to wire up in interaction.mjs.
export function buildRoot() {
  const root = document.createElement("div");
  root.className = "pix-pp-root";

  const modebar = document.createElement("div");
  modebar.className = "pix-pp-modebar";

  const pillPara = document.createElement("div");
  pillPara.className = "pix-pp-modepill";
  pillPara.textContent = "Paragraph";
  pillPara.dataset.mode = "paragraph";

  const pillLine = document.createElement("div");
  pillLine.className = "pix-pp-modepill";
  pillLine.textContent = "Line";
  pillLine.dataset.mode = "line";

  modebar.appendChild(pillPara);
  modebar.appendChild(pillLine);

  const tawrap = document.createElement("div");
  tawrap.className = "pix-pp-tawrap";

  const ta = document.createElement("textarea");
  ta.className = "pix-pp-ta";
  ta.placeholder = "Paste your prompts here...\n\nParagraph mode: separate with a blank line.\nLine mode: one prompt per line.";
  ta.spellcheck = false;

  tawrap.appendChild(ta);

  const bottombar = document.createElement("div");
  bottombar.className = "pix-pp-bottombar";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "pix-pp-clearbtn";
  clearBtn.textContent = "Clear prompts";
  clearBtn.disabled = true;

  const counter = document.createElement("div");
  counter.className = "pix-pp-counter empty";
  counter.textContent = "0 prompts";

  bottombar.appendChild(clearBtn);
  bottombar.appendChild(counter);

  root.appendChild(modebar);
  root.appendChild(tawrap);
  root.appendChild(bottombar);

  root._pixPp = { pillPara, pillLine, ta, counter, clearBtn };

  return root;
}

// Apply the current state to the DOM.
//   - Pill active state matches state.mode
//   - Textarea value matches state.text (only if it differs - avoid stomping the caret)
//   - Counter updates via updateCounter()
//   - Clear button enabled state reflects whether there is text to clear
export function applyState(root, state, runState) {
  const els = root._pixPp;
  if (!els) return;
  els.pillPara.classList.toggle("active", state.mode === "paragraph");
  els.pillLine.classList.toggle("active", state.mode === "line");
  if (els.ta.value !== state.text) els.ta.value = state.text;
  updateCounter(root, state, runState);
  updateClearButton(root, state);
}

// Update just the counter pill. runState is optional:
//   { running: true, index: 3, total: 12 } -> "3 / 12" in orange
//   undefined / null / running:false       -> "N prompts" or "0 prompts"
//
// We use a small inline parse (mirrors core.mjs parsePrompts) so render.mjs
// doesn't depend on core.mjs at module load time.
export function updateCounter(root, state, runState) {
  const els = root._pixPp;
  if (!els || !els.counter) return;
  const text = state?.text || "";
  const mode = state?.mode || "paragraph";
  const splitter = (mode === "line") ? "\n" : /\n\s*\n+/;
  const total = text.split(splitter).map((p) => p.trim()).filter((p) => p.length > 0).length;

  els.counter.classList.remove("active", "empty");
  if (runState && runState.running) {
    els.counter.classList.add("active");
    els.counter.textContent = `${runState.index} / ${runState.total}`;
  } else if (total === 0) {
    els.counter.classList.add("empty");
    els.counter.textContent = "0 prompts";
  } else {
    els.counter.textContent = `${total} prompt${total === 1 ? "" : "s"}`;
  }
}

// Enable / disable the Clear prompts button based on whether the textarea
// has any content. Avoids accidental clicks on an empty textarea.
export function updateClearButton(root, state) {
  const els = root._pixPp;
  if (!els || !els.clearBtn) return;
  const hasContent = !!(state?.text && state.text.length > 0);
  els.clearBtn.disabled = !hasContent;
}
