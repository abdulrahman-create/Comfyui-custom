import { app } from "/scripts/app.js";

const FX_OPTIONS = [
  "None",
  "Pixaroma Orange",
  "Ignition",
  "Sparkle",
  "Lightning",
  "Rocket",
];

const FX_CLASSES = ["pix-rb-orange", "pix-rb-rocket-shake"];

let currentFx = "None";
let currentButton = null;
let cleanupCurrent = () => {};
let observer = null;
let pendingCheck = false;

function injectCSS() {
  if (document.querySelector("#pix-rb-fx-css")) return;
  const style = document.createElement("style");
  style.id = "pix-rb-fx-css";
  style.textContent = `
    button.pix-rb-orange {
      background: linear-gradient(180deg, #ff7a4d, #f66744) !important;
      color: #ffffff !important;
      border-color: #c44520 !important;
      transition: filter 180ms, transform 120ms, box-shadow 180ms;
    }
    button.pix-rb-orange:hover {
      filter: brightness(1.15);
      box-shadow: 0 0 14px rgba(246, 103, 68, 0.65);
    }
    button.pix-rb-orange:active {
      transform: scale(0.96);
    }

    .pix-rb-fx-flame {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      background: radial-gradient(ellipse at right center,
        rgba(255, 245, 120, 1) 0%,
        rgba(255, 180, 40, 0.95) 18%,
        rgba(255, 100, 30, 0.85) 42%,
        rgba(220, 40, 30, 0.55) 70%,
        rgba(220, 40, 30, 0) 100%);
      filter: blur(2.5px);
      transform-origin: right center;
      clip-path: polygon(
        0% 50%,
        12% 35%, 25% 28%, 40% 25%, 55% 22%, 70% 28%, 85% 32%,
        100% 38%, 100% 62%,
        85% 68%, 70% 72%, 55% 78%, 40% 75%, 25% 72%, 12% 65%
      );
      animation: pix-rb-flame-anim 650ms ease-out forwards;
    }
    @keyframes pix-rb-flame-anim {
      0%   { transform: scaleX(0.2) scaleY(0.8); opacity: 0; }
      18%  { transform: scaleX(1) scaleY(1); opacity: 1; }
      55%  { transform: scaleX(1.3) scaleY(0.95); opacity: 0.85; }
      100% { transform: scaleX(1.7) scaleY(0.6); opacity: 0; }
    }

    .pix-rb-fx-sparkle {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #ffeb3b;
      box-shadow: 0 0 6px #ffeb3b, 0 0 3px #ffffff;
      animation: pix-rb-sparkle-anim 1.6s ease-out forwards;
    }
    @keyframes pix-rb-sparkle-anim {
      0%   { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(-32px) scale(0); opacity: 0; }
    }

    .pix-rb-fx-sparkleburst {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ffeb3b;
      box-shadow: 0 0 8px #ffeb3b, 0 0 4px #ffffff;
      animation: pix-rb-sparkleburst-anim 900ms ease-out forwards;
    }
    @keyframes pix-rb-sparkleburst-anim {
      0%   { transform: translate(0, 0) scale(1); opacity: 1; }
      100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
    }

    .pix-rb-fx-arc {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      border: 2px solid #aaccff;
      border-radius: 6px;
      box-shadow: 0 0 12px #aaccff, inset 0 0 6px #aaccff;
      box-sizing: border-box;
      animation: pix-rb-arc-anim 450ms ease-out forwards;
    }
    @keyframes pix-rb-arc-anim {
      0%   { opacity: 0; transform: scale(0.92); }
      20%  { opacity: 1; transform: scale(1.05); }
      100% { opacity: 0; transform: scale(1.3); }
    }

    button.pix-rb-rocket-shake {
      animation: pix-rb-rocket-shake-anim 420ms ease-in-out;
    }
    @keyframes pix-rb-rocket-shake-anim {
      0%, 100% { transform: translate(0, 0); }
      15%      { transform: translate(-1px, 1px); }
      30%      { transform: translate(2px, -1px); }
      45%      { transform: translate(-2px, 0); }
      60%      { transform: translate(2px, 1px); }
      75%      { transform: translate(-1px, -1px); }
      90%      { transform: translate(1px, 0); }
    }

    .pix-rb-fx-exhaust {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      background: radial-gradient(ellipse at top center,
        rgba(255, 245, 120, 1) 0%,
        rgba(255, 180, 40, 0.95) 18%,
        rgba(255, 100, 30, 0.85) 42%,
        rgba(220, 40, 30, 0.55) 70%,
        rgba(220, 40, 30, 0) 100%);
      filter: blur(2.5px);
      transform-origin: top center;
      clip-path: polygon(
        50% 100%,
        35% 88%, 28% 75%, 22% 60%, 25% 45%, 28% 30%, 32% 15%,
        38% 0%, 62% 0%,
        68% 15%, 72% 30%, 75% 45%, 78% 60%, 72% 75%, 65% 88%
      );
      animation: pix-rb-exhaust-anim 700ms ease-out forwards;
    }
    @keyframes pix-rb-exhaust-anim {
      0%   { transform: scaleY(0.2) scaleX(0.8); opacity: 0; }
      18%  { transform: scaleY(1) scaleX(1); opacity: 1; }
      55%  { transform: scaleY(1.3) scaleX(0.95); opacity: 0.85; }
      100% { transform: scaleY(1.7) scaleX(0.6); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function findRunButton() {
  const byTestId = document.querySelector('button[data-testid="queue-button"]');
  if (byTestId) return byTestId;
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    const text = (btn.textContent || "").trim();
    if (text === "Run") return btn;
  }
  return null;
}

function spawnFlamePuff(button, opts) {
  const r = button.getBoundingClientRect();
  const w = 70 + Math.random() * 35;
  const h = r.height * (0.7 + Math.random() * 0.5);
  const yOffset = (Math.random() - 0.5) * r.height * 0.35;
  const el = document.createElement("div");
  el.className = "pix-rb-fx-flame";
  el.style.left = (r.left - w + 4) + "px";
  el.style.top = (r.top + (r.height - h) / 2 + yOffset) + "px";
  el.style.width = w + "px";
  el.style.height = h + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function spawnFlame(button) {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => spawnFlamePuff(button), i * 55);
  }
}

function spawnExhaustPuff(button) {
  const r = button.getBoundingClientRect();
  const w = r.width * (0.45 + Math.random() * 0.3);
  const h = 45 + Math.random() * 25;
  const xOffset = (Math.random() - 0.5) * r.width * 0.22;
  const el = document.createElement("div");
  el.className = "pix-rb-fx-exhaust";
  el.style.left = (r.left + (r.width - w) / 2 + xOffset) + "px";
  el.style.top = (r.bottom - 4) + "px";
  el.style.width = w + "px";
  el.style.height = h + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

function spawnExhaust(button) {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => spawnExhaustPuff(button), i * 55);
  }
}

function spawnArc(button) {
  const r = button.getBoundingClientRect();
  const pad = 4;
  const el = document.createElement("div");
  el.className = "pix-rb-fx-arc";
  el.style.left = (r.left - pad) + "px";
  el.style.top = (r.top - pad) + "px";
  el.style.width = (r.width + pad * 2) + "px";
  el.style.height = (r.height + pad * 2) + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 550);
}

function spawnSparkle(button) {
  const r = button.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "pix-rb-fx-sparkle";
  el.style.left = (r.left + Math.random() * r.width) + "px";
  el.style.top = (r.top + r.height * 0.65 + Math.random() * 6) + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

function spawnSparkleBurst(button) {
  const r = button.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const count = 16;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
    const dist = 40 + Math.random() * 25;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const el = document.createElement("div");
    el.className = "pix-rb-fx-sparkleburst";
    el.style.left = cx + "px";
    el.style.top = cy + "px";
    el.style.setProperty("--dx", dx + "px");
    el.style.setProperty("--dy", dy + "px");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
}

function attachIgnition(button) {
  const handler = () => spawnFlame(button);
  button.addEventListener("click", handler);
  return () => button.removeEventListener("click", handler);
}

function attachLightning(button) {
  const handler = () => spawnArc(button);
  button.addEventListener("click", handler);
  return () => button.removeEventListener("click", handler);
}

function attachSparkle(button) {
  const id = setInterval(() => {
    if (button.isConnected) spawnSparkle(button);
  }, 550);
  const clickHandler = () => spawnSparkleBurst(button);
  button.addEventListener("click", clickHandler);
  return () => {
    clearInterval(id);
    button.removeEventListener("click", clickHandler);
  };
}

function attachRocket(button) {
  const handler = () => {
    button.classList.remove("pix-rb-rocket-shake");
    void button.offsetWidth;
    button.classList.add("pix-rb-rocket-shake");
    setTimeout(() => button.classList.remove("pix-rb-rocket-shake"), 440);
    spawnExhaust(button);
  };
  button.addEventListener("click", handler);
  return () => {
    button.removeEventListener("click", handler);
    button.classList.remove("pix-rb-rocket-shake");
  };
}

function clearButtonStyling(button) {
  if (!button) return;
  for (const cls of FX_CLASSES) button.classList.remove(cls);
}

function applyFx(button, fx) {
  cleanupCurrent();
  cleanupCurrent = () => {};
  clearButtonStyling(button);

  switch (fx) {
    case "Pixaroma Orange":
      button.classList.add("pix-rb-orange");
      break;
    case "Ignition":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachIgnition(button);
      break;
    case "Sparkle":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachSparkle(button);
      break;
    case "Lightning":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachLightning(button);
      break;
    case "Rocket":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachRocket(button);
      break;
    default:
      break;
  }
}

function checkButton() {
  if (currentButton && document.body.contains(currentButton)) return;
  const btn = findRunButton();
  if (!btn) return;
  currentButton = btn;
  applyFx(btn, currentFx);
}

function scheduleCheck() {
  if (pendingCheck) return;
  pendingCheck = true;
  requestAnimationFrame(() => {
    pendingCheck = false;
    checkButton();
  });
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  cleanupCurrent();
  cleanupCurrent = () => {};
  clearButtonStyling(currentButton);
  currentButton = null;
}

function onFxChange(v) {
  currentFx = v || "None";
  if (currentFx === "None") {
    stopObserver();
    return;
  }
  injectCSS();
  if (currentButton && document.body.contains(currentButton)) {
    applyFx(currentButton, currentFx);
  } else {
    currentButton = null;
  }
  startObserver();
  checkButton();
}

app.registerExtension({
  name: "Pixaroma.RunButtonFX",
  settings: [
    {
      id: "Pixaroma.RunButton.FX",
      name: "Run Button FX",
      type: "combo",
      defaultValue: "None",
      options: FX_OPTIONS,
      tooltip: "Visual effect for the Run button. Pure visuals - never blocks queueing.",
      category: ["👑 Pixaroma", "Run Button"],
      onChange: onFxChange,
    },
  ],
  async setup() {
    const v = app.ui.settings.getSettingValue("Pixaroma.RunButton.FX") || "None";
    currentFx = v;
    if (currentFx !== "None") {
      injectCSS();
      startObserver();
      checkButton();
    }
  },
});
