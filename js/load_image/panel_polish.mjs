// Per-mode panel post-processors for Load Image Pixaroma. Adapted from
// js/image_resize/index.js; class names use the .pix-li-* family that the
// scoped CSS in ui.mjs targets. Keeps Image Resize untouched.

const INLINE_LABELS = {
  max_mp: "Max megapixels",
  longest_side: "Longest side",
  scale_factor: "Scale by ×",
};

// Single-input modes: drop the section header, move the name INTO the input.
export function applyInlineLabel(panel, mode) {
  const label = INLINE_LABELS[mode];
  if (!label) return;
  panel.querySelector(".pix-li-panel-label")?.remove();
  const num = panel.querySelector(".pix-li-numinput");
  if (!num || num.querySelector(".pix-li-inline-label")) return;
  const lab = document.createElement("span");
  lab.className = "pix-li-inline-label";
  lab.textContent = label;
  num.insertBefore(lab, num.firstChild);
  num.classList.add("pix-li-num-labeled");
}

// Fit/Crop (W × H): W/H labels inside inputs, drop redundant size text, reflow
// into two columns (W/H/swap stacked left, aspect rect right).
export function applyWHLayout(panel) {
  const fields = [...panel.querySelectorAll(".pix-li-wh-field")];
  const tags = ["W", "H"];
  fields.forEach((f, i) => {
    f.querySelector(".pix-li-wh-label")?.remove();
    const num = f.querySelector(".pix-li-numinput");
    if (num && !num.querySelector(".pix-li-inline-label")) {
      const lab = document.createElement("span");
      lab.className = "pix-li-inline-label";
      lab.textContent = tags[i] || "";
      num.insertBefore(lab, num.firstChild);
      num.classList.add("pix-li-num-labeled");
    }
  });
  panel.querySelector(".pix-li-wh-rect-label")?.remove();

  const row = panel.querySelector(".pix-li-wh-row");
  const swap = panel.querySelector(".pix-li-swap");
  const preview = panel.querySelector(".pix-li-wh-preview");
  if (row && fields.length === 2 && preview && !panel.querySelector(".pix-li-wh-grid")) {
    const grid = document.createElement("div");
    grid.className = "pix-li-wh-grid";
    const col = document.createElement("div");
    col.className = "pix-li-wh-col";
    col.append(fields[0], fields[1]);
    if (swap) col.append(swap);
    grid.append(col, preview);
    row.replaceWith(grid);
  }
}

// Crop-to-fill extras: Fill/Crop scale toggle + 3×3 anchor picker.
export function applyCoverControls(node, panel, readState, writeState, onChange) {
  const state = readState(node);

  const swap = panel.querySelector(".pix-li-swap");
  if (swap && !panel.querySelector(".pix-li-fillcrop")) {
    const row = document.createElement("div");
    row.className = "pix-li-swaprow";
    const toggle = document.createElement("div");
    toggle.className = "pix-li-fillcrop";
    const fillOpt = document.createElement("div");
    fillOpt.textContent = "Fill"; fillOpt.dataset.cropScale = "1";
    fillOpt.title = "Scale to fill exactly, trim overflow";
    const cropOpt = document.createElement("div");
    cropOpt.textContent = "Crop"; cropOpt.dataset.cropScale = "0";
    cropOpt.title = "Cut a 1:1-pixel piece, no scaling";
    const scaleOn = state.crop_scale !== false;
    fillOpt.classList.toggle("active", scaleOn);
    cropOpt.classList.toggle("active", !scaleOn);
    toggle.append(fillOpt, cropOpt);
    swap.replaceWith(row);
    row.append(swap, toggle);
    toggle.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-crop-scale]");
      if (!opt) return;
      const on = opt.dataset.cropScale === "1";
      writeState(node, { ...readState(node), crop_scale: on });
      fillOpt.classList.toggle("active", on);
      cropOpt.classList.toggle("active", !on);
      onChange?.();
    });
  }

  const preview = panel.querySelector(".pix-li-wh-preview");
  if (preview && !panel.querySelector(".pix-li-anchor")) {
    const ANCHORS = [
      "top-left", "top", "top-right",
      "left", "center", "right",
      "bottom-left", "bottom", "bottom-right",
    ];
    const cur = state.crop_anchor || "center";
    const grid = document.createElement("div");
    grid.className = "pix-li-anchor";
    grid.title = "Where to crop from";
    for (const a of ANCHORS) {
      const cell = document.createElement("div");
      cell.className = "pix-li-anchor-cell" + (a === cur ? " active" : "");
      cell.dataset.anchor = a;
      cell.title = a.replace("-", " ");
      grid.appendChild(cell);
    }
    preview.replaceWith(grid);
    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".pix-li-anchor-cell");
      if (!cell) return;
      writeState(node, { ...readState(node), crop_anchor: cell.dataset.anchor });
      for (const c of grid.children) c.classList.toggle("active", c === cell);
      onChange?.();
    });
  }
}
