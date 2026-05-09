import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

async function playSound(filename, volume01) {
  if (typeof filename !== "string" || !filename) return;
  const url = `/pixaroma/assets/sounds/${encodeURIComponent(filename)}`;
  const audio = new Audio(url);
  const v = Number(volume01);
  audio.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
  try {
    await audio.play();
  } catch (e) {
    console.warn("[Notify Pixaroma] playback failed:", e?.message || e);
  }
}

app.registerExtension({
  name: "Pixaroma.Notify",

  settings: [
    {
      id: "Pixaroma.Notify.Enabled",
      name: "Enabled",
      type: "boolean",
      defaultValue: true,
      tooltip:
        "Master switch for all Notify Pixaroma nodes. When off, no Notify node plays sound.",
      category: ["👑 Pixaroma", "Notify"],
    },
  ],

  setup() {
    api.addEventListener("executed", (e) => {
      const out = e?.detail?.output?.pixaroma_notify;
      if (!Array.isArray(out) || out.length === 0) return;
      const masterOn =
        app.ui.settings.getSettingValue("Pixaroma.Notify.Enabled") !== false;
      if (!masterOn) {
        console.log("[Notify Pixaroma] muted (master toggle off)");
        return;
      }
      for (const ev of out) {
        console.log(
          `[Notify Pixaroma] ▶ ${ev.label}  (${ev.sound} @ ${ev.volume}%)`
        );
        playSound(ev.sound, (ev.volume ?? 80) / 100);
      }
    });
  },
});
