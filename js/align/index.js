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
//
// Toolbar button: DOM-mounted via `app.menu.settingsGroup.element.before(btn)`,
// the same pattern rgthree-comfy uses (web/comfyui/comfy_ui_bar.js). The
// `commands` + `menuCommands` API in this ComfyUI version surfaces items in
// the menubar dropdowns, NOT the floating top action bar — so DOM mount is
// the right path for getting a button next to rgthree's logo.
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
    {
      id: SETTING_SNAP_DIST,
      name: "Align — Snap distance (screen pixels)",
      type: "slider",
      defaultValue: 8,
      attrs: { min: 4, max: 16, step: 1 },
      category: ["👑 Pixaroma", "Align (advanced)"],
      tooltip: "How close (in screen pixels) an edge must be before snap engages.",
      onChange: (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 4 && n <= 16) state.snapDistPx = n;
      },
    },
  ],
  setup() {
    // onChange fires only on subsequent changes — read current values now so
    // a user who had Enabled=ON across a restart gets the snap immediately.
    const s = app.ui?.settings;
    if (s) {
      state.enabled = !!s.getSettingValue(SETTING_ENABLED);
      const d = Number(s.getSettingValue(SETTING_SNAP_DIST));
      if (Number.isFinite(d) && d >= 4 && d <= 16) state.snapDistPx = d;
    }
    console.log("[Pixaroma.Align] setup: enabled=", state.enabled, "snapDist=", state.snapDistPx);
  },
});
