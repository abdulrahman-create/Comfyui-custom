import { app } from "/scripts/app.js";

// ── Pixaroma brand defaults ──────────────────────────────────────────────
// Single source of truth for the dark brand colors that every Pixaroma node
// ships with by default. Hooks every node whose Python `CATEGORY` starts
// with "👑 Pixaroma", so adding a new node automatically inherits the look
// — no per-node boilerplate, no risk of drift between files.
//
// Both `node.color` and `node.bgcolor` are guarded with `if (!this.color)` /
// `if (!this.bgcolor)` so two important user-driven paths win:
//   1. Workflow restore — saved colors land on the node before
//      `onNodeCreated` fires, so our wrapper sees them already set and
//      skips the assignment.
//   2. Right-click → Colors menu — the user's pick lands the same way.
//
// Extension load order is irrelevant: per-node extensions that wrap
// `onNodeCreated` for the same node still see the guard semantics, and
// since both the global and any per-node guard use the same `if (!...)`
// check, whichever runs first wins and the other is a no-op.

const TITLE_BAR_COLOR = "#1d1d1d";   // matches Resolution chip surface
const BODY_COLOR      = "#2a2a2a";   // matches Resolution root surface

app.registerExtension({
  name: "Pixaroma.BrandDefaults",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const cat = nodeData?.category;
    if (typeof cat !== "string" || !cat.startsWith("👑 Pixaroma")) return;
    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const ret = orig?.apply(this, arguments);
      if (!this.color)   this.color   = TITLE_BAR_COLOR;
      if (!this.bgcolor) this.bgcolor = BODY_COLOR;
      return ret;
    };
  },
});
