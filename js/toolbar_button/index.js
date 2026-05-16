// Pixaroma toolbar button - one-click access to the 👑 Pixaroma settings.
//
// Mounts a small button with the Pixaroma logo in the floating top toolbar,
// next to Align Pixaroma's button. Click → open the Settings dialog AND
// auto-select the 👑 Pixaroma category in the sidebar.
//
// Mount pattern: app.menu.settingsGroup.element.before(group) - same as
// Align Pixaroma uses, same as the rgthree pattern.

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
      padding: 0 !important;
      width: 28px !important;
      height: 28px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-sizing: border-box !important;
    }
    .pixaroma-toolbar-btn:hover {
      background-color: #3a3d40 !important;
      filter: brightness(1.08);
    }
    .pixaroma-toolbar-btn .pixaroma-toolbar-icon {
      width: 18px;
      height: 18px;
      display: block;
      pointer-events: none;
      object-fit: contain;
    }
  `;
  document.head.appendChild(style);
}

// Click the native settings cog. Works across every ComfyUI version because it
// just simulates a user click on the existing button.
function clickNativeSettingsCog() {
  const candidates = [
    '[data-testid="settings-button"]',
    'button[aria-label*="Setting" i]',
    'button[title*="Setting" i]',
    '.comfy-settings-btn',
    // P-Menu (Vue / PrimeVue) settings cog inside the menu group
    '.comfyui-menu .pi-cog',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (!el) continue;
    // If it's the icon itself, click its closest button parent.
    const btn = el.closest("button") || el;
    btn.click();
    return true;
  }
  return false;
}

// After the dialog opens, find the 👑 Pixaroma row in the sidebar and click it.
// Vue uses PrimeVue components - the sidebar items are usually .p-listbox-option
// or similar. We match by exact text content so the lookup is layout-agnostic.
// Polls for ~1.5 s in case the dialog mounts asynchronously.
function selectPixaromaCategory() {
  const tryOnce = () => {
    const items = document.querySelectorAll(
      ".p-listbox-option, .p-tree-node-content, .p-menu-list .p-menuitem, [role='option'], [role='treeitem']",
    );
    for (const el of items) {
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
    console.warn("[Pixaroma.ToolbarButton] could not locate the native Settings cog");
    return;
  }
  // Give the dialog a tick to mount, then drill into 👑 Pixaroma.
  setTimeout(selectPixaromaCategory, 80);
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
