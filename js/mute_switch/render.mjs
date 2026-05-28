// Pure paint + hit-test for Mute Switch Pixaroma.
//
// The node body has TWO regions stacked vertically:
//   Y in [0, MODE_BAR_H) ........... mode bar (two pills at top)
//   Y in [MODE_BAR_H + TOP_PAD, ...] row area (one row per input slot)
//
// LiteGraph draws input dots starting at body-local Y = TOP_PAD + i*ROW_H
// + ROW_H/2 by default, so we override slot.pos in core.mjs::normalizeSlots
// to push the dots below the mode bar (Vue Compat #16: slot.pos IS read by
// calculateInputSlotPosFromSlot in this LG fork).

import { app } from "/scripts/app.js";

export const BRAND = "#f66744";
export const MODE_BAR_H = 28;        // height of the two-pills row at top
export const ROW_H = 20;             // matches LG NODE_SLOT_HEIGHT
export const TOP_PAD = 4;            // gap between mode bar and first row
export const SIDE_PAD = 8;

// Mode bar layout
const MODE_PILL_W = 92;
const MODE_PILL_H = 18;

// Row layout
const ROW_PILL_W = 28;
const ROW_PILL_H = 14;
const ROW_PILL_R = 7;
const ROW_KNOB_R = 4;
const ROW_PILL_RIGHT_PAD = 10;
const DOT_GUTTER = 28;

// ── Mode bar rects (body-local) ──────────────────────────────────────────

export function selectModePillRect(nodeWidth) {
  return {
    x: SIDE_PAD,
    y: (MODE_BAR_H - MODE_PILL_H) / 2,
    w: MODE_PILL_W,
    h: MODE_PILL_H,
  };
}

export function mutePillRect(nodeWidth) {
  return {
    x: nodeWidth - SIDE_PAD - MODE_PILL_W,
    y: (MODE_BAR_H - MODE_PILL_H) / 2,
    w: MODE_PILL_W,
    h: MODE_PILL_H,
  };
}

// ── Row rects (body-local) ───────────────────────────────────────────────

export function rowCenterY(slotIdx0) {
  return MODE_BAR_H + TOP_PAD + slotIdx0 * ROW_H + ROW_H / 2;
}

export function rowPillRect(nodeWidth, slotIdx0) {
  const cy = rowCenterY(slotIdx0);
  return {
    x: nodeWidth - ROW_PILL_RIGHT_PAD - ROW_PILL_W,
    y: cy - ROW_PILL_H / 2,
    w: ROW_PILL_W,
    h: ROW_PILL_H,
  };
}

export function labelRect(nodeWidth, slotIdx0) {
  const cy = rowCenterY(slotIdx0);
  const left = DOT_GUTTER + 4;
  const right = nodeWidth - ROW_PILL_RIGHT_PAD - ROW_PILL_W - 6;
  return {
    x: left,
    y: cy - ROW_H / 2,
    w: Math.max(0, right - left),
    h: ROW_H,
  };
}

function inside(pos, r) {
  return (
    pos[0] >= r.x && pos[0] <= r.x + r.w &&
    pos[1] >= r.y && pos[1] <= r.y + r.h
  );
}

export function hitSelectModePill(pos, nodeWidth) {
  return inside(pos, selectModePillRect(nodeWidth));
}
export function hitMutePill(pos, nodeWidth) {
  return inside(pos, mutePillRect(nodeWidth));
}
export function hitRowPill(pos, nodeWidth, slotIdx0) {
  return inside(pos, rowPillRect(nodeWidth, slotIdx0));
}
export function hitLabel(pos, nodeWidth, slotIdx0) {
  return inside(pos, labelRect(nodeWidth, slotIdx0));
}

// Mirrors js/switch/render.mjs::labelScreenRect for the inline DOM editor.
export function labelScreenRect(node, slotIdx1) {
  const slotIdx0 = slotIdx1 - 1;
  const r = labelRect(node.size?.[0] || 280, slotIdx0);
  const ds = app.canvas?.ds;
  const scale = ds?.scale || 1;
  const offsetX = ds?.offset?.[0] || 0;
  const offsetY = ds?.offset?.[1] || 0;
  const canvasEl = app.canvas?.canvas;
  const canvasRect = canvasEl ? canvasEl.getBoundingClientRect() : { left: 0, top: 0 };
  const baseLeft = canvasRect.left + offsetX * scale;
  const baseTop = canvasRect.top + offsetY * scale;
  return {
    x: baseLeft + (node.pos[0] + r.x) * scale,
    y: baseTop + (node.pos[1] + r.y) * scale,
    w: r.w * scale,
    h: r.h * scale,
  };
}

// ── Paint ────────────────────────────────────────────────────────────────
// Task 2: placeholder stub - replaced in Task 4.

export function drawMuteSwitch(node, ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, node.size[0], MODE_BAR_H);
  ctx.fillStyle = "#666";
  ctx.font = "11px 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("(mode pills - Task 4)", SIDE_PAD, MODE_BAR_H / 2);
  ctx.restore();
}
