import { app } from "/scripts/app.js";

const FX_OPTIONS = [
  "None",
  "Pixaroma Orange",
  "Ignition",
  "Pulse",
  "Sparkle",
  "Lightning",
  "Aurora",
  "Rocket",
];

const FX_CLASSES = [
  "pix-rb-orange",
  "pix-rb-pulse",
  "pix-rb-aurora",
  "pix-rb-rocket-shake",
];

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
    button.pix-rb-orange,
    button.pix-rb-pulse,
    button.pix-rb-aurora {
      background: linear-gradient(180deg, #ff7a4d, #f66744) !important;
      color: #ffffff !important;
      border-color: #c44520 !important;
      transition: filter 180ms, transform 120ms, box-shadow 180ms;
    }
    button.pix-rb-orange:hover,
    button.pix-rb-pulse:hover {
      filter: brightness(1.15);
      box-shadow: 0 0 14px rgba(246, 103, 68, 0.65);
    }
    button.pix-rb-orange:active,
    button.pix-rb-pulse:active,
    button.pix-rb-aurora:active {
      transform: scale(0.96);
    }

    button.pix-rb-pulse {
      animation: pix-rb-pulse-anim 2.2s ease-in-out infinite;
    }
    @keyframes pix-rb-pulse-anim {
      0%, 100% { box-shadow: 0 0 4px rgba(246, 103, 68, 0.35); }
      50%      { box-shadow: 0 0 18px rgba(246, 103, 68, 0.95); }
    }

    button.pix-rb-aurora {
      background: linear-gradient(90deg, #f66744, #ff9d7d, #ffb088, #f66744, #c44520, #f66744) !important;
      background-size: 400% 100% !important;
      animation: pix-rb-aurora-anim 6s linear infinite;
    }
    @keyframes pix-rb-aurora-anim {
      0%   { background-position: 0% 50%; }
      100% { background-position: 400% 50%; }
    }

    .pix-rb-fx-flame {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      background: radial-gradient(ellipse at right center,
        rgba(255, 235, 59, 1) 0%,
        rgba(255, 152, 0, 0.95) 22%,
        rgba(244, 67, 54, 0.85) 50%,
        rgba(244, 67, 54, 0) 100%);
      filter: blur(3px);
      transform-origin: right center;
      animation: pix-rb-flame-anim 600ms ease-out forwards;
    }
    @keyframes pix-rb-flame-anim {
      0%   { transform: scaleX(0); opacity: 0; }
      20%  { transform: scaleX(1); opacity: 1; }
      100% { transform: scaleX(1.7); opacity: 0; }
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
      animation: pix-rb-rocket-shake-anim 400ms ease-in-out;
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
    .pix-rb-fx-rocketflame {
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      font-size: 22px;
      line-height: 1;
      animation: pix-rb-rocketflame-anim 600ms ease-out forwards;
    }
    @keyframes pix-rb-rocketflame-anim {
      0%   { opacity: 0; transform: translateY(-6px) scale(0.8); }
      30%  { opacity: 1; transform: translateY(0) scale(1); }
      100% { opacity: 0; transform: translateY(22px) scale(0.7); }
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

function spawnFlame(button) {
  const r = button.getBoundingClientRect();
  const w = 90;
  const el = document.createElement("div");
  el.className = "pix-rb-fx-flame";
  el.style.left = (r.left - w) + "px";
  el.style.top = r.top + "px";
  el.style.width = w + "px";
  el.style.height = r.height + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
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

function spawnRocketFlame(button) {
  const r = button.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "pix-rb-fx-rocketflame";
  el.textContent = "🔥";
  el.style.left = (r.left + r.width / 2 - 11) + "px";
  el.style.top = (r.bottom + 2) + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
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
  return () => clearInterval(id);
}

function attachRocket(button) {
  const handler = () => {
    button.classList.remove("pix-rb-rocket-shake");
    void button.offsetWidth;
    button.classList.add("pix-rb-rocket-shake");
    setTimeout(() => button.classList.remove("pix-rb-rocket-shake"), 420);
    spawnRocketFlame(button);
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
    case "Pulse":
      button.classList.add("pix-rb-pulse");
      break;
    case "Sparkle":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachSparkle(button);
      break;
    case "Lightning":
      button.classList.add("pix-rb-orange");
      cleanupCurrent = attachLightning(button);
      break;
    case "Aurora":
      button.classList.add("pix-rb-aurora");
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
