// Pixaroma toolbar button - one-click access to the 👑 Pixaroma settings.
//
// Mounts a small button with the Pixaroma logo in the floating top toolbar,
// next to Align Pixaroma's button. Click → opens ComfyUI's native Settings
// dialog and auto-selects the 👑 Pixaroma category.
//
// Mount pattern: app.menu.settingsGroup.element.before(group) - the same
// approach Align Pixaroma uses (and the same rgthree pattern). The native
// cog button lives INSIDE that same settingsGroup element, so we click it
// directly rather than guessing selectors that could accidentally match
// other extensions' "Settings" buttons (like rgthree's).

import { app } from "/scripts/app.js";

const LOGO_URL = "/pixaroma/assets/pixaroma_logo.svg";
const PNG_FALLBACK = "/pixaroma/assets/pixaroma_logo.png";
const CSS_ID = "pixaroma-toolbar-button-css";
const PIXAROMA_CATEGORY_LABEL = "👑 Pixaroma";

const state = {
  mounted: false,
  btn: null,
};

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .pixaroma-toolbar-btn {
      background-color: #2a2c2e !important;
      color: #ddd !important;
      border-color: #444 !important;
    }
    .pixaroma-toolbar-btn:hover {
      background-color: #3a3d40 !important;
      filter: brightness(1.08);
    }
    .pixaroma-toolbar-btn .pixaroma-toolbar-icon {
      display: inline-block;
      width: 18px;
      height: 18px;
      object-fit: contain;
      pointer-events: none;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);
}

// Click the native settings cog. It lives inside app.menu.settingsGroup -
// the exact same element we mounted our button next to. Walk the children
// for an actual <button>, which is what gets click-handled by the Vue menu.
function clickNativeSettingsCog() {
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) return false;
  const cog = settingsGroupEl.querySelector("button");
  if (!cog) return false;
  cog.click();
  return true;
}

// After the dialog opens, find the 👑 Pixaroma row in the sidebar and click it.
// Vue uses PrimeVue components; sidebar rows can show up as several different
// element types. Match by exact text content so the lookup is layout-agnostic.
// Polls for ~1.5 s in case the dialog mounts asynchronously.
function selectPixaromaCategory() {
  const tryOnce = () => {
    const candidates = document.querySelectorAll(
      ".p-listbox-option, .p-tree-node-content, .p-menu-list .p-menuitem, [role='option'], [role='treeitem'], li[data-pc-name='listboxoption']",
    );
    for (const el of candidates) {
      const txt = (el.textContent || "").trim();
      if (txt === PIXAROMA_CATEGORY_LABEL || txt.startsWith(PIXAROMA_CATEGORY_LABEL)) {
        el.click();
        return true;
      }
    }
    return false;
  };

  let attempts = 0;
  const tick = () => {
    if (tryOnce()) return;
    if (++attempts >= 15) return; // 15 × 100 ms = 1.5 s
    setTimeout(tick, 100);
  };
  tick();
}

function openPixaromaSettings() {
  if (!clickNativeSettingsCog()) {
    console.warn("[Pixaroma.ToolbarButton] could not find the native Settings cog inside app.menu.settingsGroup");
    return;
  }
  setTimeout(selectPixaromaCategory, 120);
}

function mount() {
  if (state.mounted && state.btn?.isConnected) return;
  const settingsGroupEl = app.menu?.settingsGroup?.element;
  if (!settingsGroupEl) {
    if (mount._tries == null) mount._tries = 0;
    if (++mount._tries > 20) {
      console.warn("[Pixaroma.ToolbarButton] toolbar mount: app.menu.settingsGroup never appeared");
      return;
    }
    setTimeout(mount, 250);
    return;
  }

  injectCSS();

  const btn = document.createElement("button");
  // .comfyui-button supplies the natural button size + padding (matches
  // other toolbar buttons exactly). We only add color theming on top.
  btn.className = "comfyui-button pixaroma-toolbar-btn";
  btn.title = "Open Pixaroma Settings";
  btn.type = "button";

  const img = document.createElement("img");
  img.className = "pixaroma-toolbar-icon";
  img.src = LOGO_URL;
  img.alt = "Pixaroma";
  img.draggable = false;
  img.addEventListener("error", () => {
    if (img.src !== PNG_FALLBACK) img.src = PNG_FALLBACK;
  });
  btn.appendChild(img);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPixaromaSettings();
  });

  const group = document.createElement("div");
  group.className = "comfyui-button-group pixaroma-toolbar-group";
  group.appendChild(btn);

  settingsGroupEl.before(group);
  state.btn = btn;
  state.mounted = true;
}

app.registerExtension({
  name: "Pixaroma.ToolbarButton",
  async setup() {
    mount();
  },
});
