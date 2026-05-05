import { app } from "/scripts/app.js";
import { BRAND } from "../shared/index.mjs";

// =============================================================================
// Align Pixaroma — toggleable snap & alignment guides for the node canvas.
//
// Architecture: monkey-patches LGraphCanvas.prototype.processMouseMove (snap)
// and onDrawForeground (guide rendering). Both early-return when disabled, so
// the cost when OFF is one boolean read per mousemove.
//
// Patches WRAP, never REPLACE. We save the original at install time and call
// through. This lets us coexist with rgthree-comfy and similar extensions.
// =============================================================================

const SETTING_ENABLED = "Pixaroma.Align.Enabled";
const SETTING_SNAP_DIST = "Pixaroma.Align.SnapDistance";

const state = {
  enabled: false,
  snapDistPx: 8,
  activeGuides: [],
  toolbarBtn: null,
};

app.registerExtension({
  name: "Pixaroma.Align",
  settings: [
    {
      id: SETTING_ENABLED,
      name: "Align Pixaroma — snap & guides",
      type: "boolean",
      defaultValue: false,
      category: ["👑 Pixaroma", "Align"],
      tooltip: "Snap nodes to others' edges and centers while dragging or resizing. Hold Alt to bypass.",
      onChange: (v) => {
        state.enabled = !!v;
        console.log("[Pixaroma.Align] enabled =", state.enabled);
      },
    },
  ],
  setup() {
    console.log("[Pixaroma.Align] extension setup complete");
  },
});
