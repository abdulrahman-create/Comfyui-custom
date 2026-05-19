import { app } from "/scripts/app.js";
import { openPixaromaColorPickerModal } from "../shared/color_picker.mjs";

// ── Pixaroma node colors: right-click menu + presets + favorite ──────────
// Adds two entries to the standard node right-click menu:
//   • "👑 Pixaroma colors" → submenu of 6 curated dark presets + Favorite
//     (from Settings) + Pick custom... (live picker for title + body).
//   • "Reset node colors" clears the override.
//
// The colors are written to each node's own .color / .bgcolor, so they
// serialize into the workflow JSON and travel to recipients without
// requiring this plugin installed.
//
// Multi-select aware: if 2+ nodes are selected AND the right-click target
// is one of them, the action applies to all of them, and the label shows
// "(N nodes)".

// 6 curated dark presets (title slightly darker than body, matching the
// brand convention from js/brand/index.js).
const PRESETS = [
  { id: "dark",   label: "Dark",   title: "#1d1d1d", body: "#2a2a2a" },
  { id: "slate",  label: "Slate",  title: "#1a2332", body: "#25334a" },
  { id: "forest", label: "Forest", title: "#13261c", body: "#1d3a2d" },
  { id: "plum",   label: "Plum",   title: "#2a1a2e", body: "#3d2842" },
  { id: "rose",   label: "Rose",   title: "#2e1a1f", body: "#3f2730" },
  { id: "amber",  label: "Amber",  title: "#2a1f12", body: "#3d2e1a" },
];

const FAVORITE_TITLE_ID = "Pixaroma.NodeColors.FavoriteTitle";
const FAVORITE_BODY_ID  = "Pixaroma.NodeColors.FavoriteBody";

function getFavorite() {
  const s = app.ui?.settings;
  const t = s?.getSettingValue?.(FAVORITE_TITLE_ID) || "#1d1d1d";
  const b = s?.getSettingValue?.(FAVORITE_BODY_ID)  || "#2a2a2a";
  return { title: t, body: b };
}

function setFavorite(title, body) {
  const s = app.ui?.settings;
  if (!s) return;
  try {
    if (typeof s.setSettingValueAsync === "function") {
      s.setSettingValueAsync(FAVORITE_TITLE_ID, title);
      s.setSettingValueAsync(FAVORITE_BODY_ID,  body);
    } else if (typeof s.setSettingValue === "function") {
      s.setSettingValue(FAVORITE_TITLE_ID, title);
      s.setSettingValue(FAVORITE_BODY_ID,  body);
    }
  } catch (e) { /* non-fatal: colors are already applied to the nodes */ }
}

function getTargetNodes(currentNode) {
  const sel = app.canvas?.selected_nodes;
  if (sel) {
    const nodes = Object.values(sel);
    if (nodes.length > 1 && nodes.includes(currentNode)) return nodes;
  }
  return [currentNode];
}

function applyColors(nodes, titleHex, bodyHex) {
  for (const n of nodes) {
    n.color   = titleHex;
    n.bgcolor = bodyHex;
  }
  app.graph?.setDirtyCanvas(true, true);
}

function resetColors(nodes) {
  for (const n of nodes) {
    delete n.color;
    delete n.bgcolor;
  }
  app.graph?.setDirtyCanvas(true, true);
}

function pickCustom(nodes) {
  const fav = getFavorite();
  openPixaromaColorPickerModal({
    title: "Pick title bar color",
    initialColor: fav.title,
    onPick: (titleHex) => {
      openPixaromaColorPickerModal({
        title: "Pick body color",
        initialColor: fav.body,
        onPick: (bodyHex) => {
          applyColors(nodes, titleHex, bodyHex);
          setFavorite(titleHex, bodyHex);
        },
      });
    },
  });
}

function buildSubmenuOptions(targets) {
  const items = PRESETS.map((p) => ({
    content: p.label,
    callback: () => applyColors(targets, p.title, p.body),
  }));
  items.push(null); // separator
  items.push({
    content: "Favorite (from settings)",
    callback: () => {
      const fav = getFavorite();
      applyColors(targets, fav.title, fav.body);
    },
  });
  items.push({
    content: "Pick custom...",
    callback: () => pickCustom(targets),
  });
  return items;
}

app.registerExtension({
  name: "Pixaroma.NodeColors",

  settings: [
    {
      id: FAVORITE_TITLE_ID,
      name: "Favorite Title Color (default #1d1d1d)",
      type: "color",
      defaultValue: "#1d1d1d",
      tooltip: "Your personal favorite title bar color. Applied by the 'Favorite' entry in the right-click menu under '👑 Pixaroma colors'. NOTE: ComfyUI's color field shows saved values without '#' but requires '#' when typing, so enter '#1d1d1d' to reset, or use the color picker.",
      category: ["👑 Pixaroma", "Favorite Title"],
    },
    {
      id: FAVORITE_BODY_ID,
      name: "Favorite Body Color (default #2a2a2a)",
      type: "color",
      defaultValue: "#2a2a2a",
      tooltip: "Your personal favorite body color. Applied by the 'Favorite' entry in the right-click menu under '👑 Pixaroma colors'. NOTE: same '#' typing rule as the Favorite Title setting.",
      category: ["👑 Pixaroma", "Favorite Body"],
    },
  ],

  async setup() {
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas?.prototype?.getNodeMenuOptions) {
      return;
    }
    const origGetNodeMenuOptions = LGraphCanvas.prototype.getNodeMenuOptions;
    LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
      const options = origGetNodeMenuOptions.apply(this, arguments);
      const targets = getTargetNodes(node);
      const count   = targets.length;
      const suffix  = count > 1 ? ` (${count} nodes)` : "";
      options.push(
        null,
        {
          content: `👑 Pixaroma colors${suffix}`,
          has_submenu: true,
          callback: function (value, opts, e, menu) {
            new LiteGraph.ContextMenu(
              buildSubmenuOptions(targets),
              { event: e, parentMenu: menu, node: node }
            );
          },
        },
        {
          content: `Reset node colors${suffix}`,
          callback: () => resetColors(targets),
        }
      );
      return options;
    };
  },
});
