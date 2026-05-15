"""
Notify Pixaroma - terminal node that emits a notification event when reached.

Plays a chosen sound (from assets/sounds/) via the JS frontend when the
workflow reaches this node. Drop one at the end of a workflow to hear
"render finished", or branch one off any node to be alerted at a checkpoint.
Sound only - no desktop notification banner. See docs spec for full design.
"""
import os

from ._type_helpers import ANY

# Sound folder lives at <pkg-root>/assets/sounds/. node_notify.py is at
# <pkg-root>/nodes/, so dirname(dirname(__file__)) walks up to <pkg-root>.
SOUNDS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "assets",
    "sounds",
)


def _list_sounds():
    """Return a sorted list of sound filenames in assets/sounds/.

    Falls back to ["Vista.mp3"] if the folder is missing or empty so
    INPUT_TYPES never returns an empty combo (which would crash ComfyUI).
    """
    if not os.path.isdir(SOUNDS_DIR):
        return ["Vista.mp3"]
    files = sorted(
        f for f in os.listdir(SOUNDS_DIR)
        if f.lower().endswith((".mp3", ".wav", ".ogg"))
    )
    return files or ["Vista.mp3"]


class NotifyPixaroma:
    DESCRIPTION = (
        "Plays a notification sound when this node is reached during a workflow run. "
        "Drop one at the end of a workflow to hear when rendering finishes, or branch "
        "one off any node mid-graph to be alerted at a checkpoint. Useful when you are "
        "in another browser tab or app while ComfyUI is running.\n\n"
        "Sound files are auto-enumerated from assets/sounds/ - drop in a .mp3, .wav, "
        "or .ogg there to add more (restart ComfyUI to pick up new files).\n\n"
        "A master toggle lives in Settings -> Pixaroma -> Notify -> Enabled. Each "
        "node also has its own per-node enabled toggle. The Preview button bypasses "
        "both toggles, since clicking it is a manual request to hear the sound right now."
    )

    @classmethod
    def INPUT_TYPES(cls):
        sounds = _list_sounds()
        default = "Vista.mp3" if "Vista.mp3" in sounds else sounds[0]
        return {
            "required": {
                "any": (ANY, {
                    "tooltip":
                        "Connect any node's output here. The notification fires "
                        "when this node is reached during workflow execution. The "
                        "wire's data is not used or modified - this node is a "
                        "terminal (no output)."
                }),
                "enabled": ("BOOLEAN", {
                    "default": True,
                    "tooltip":
                        "Per-node mute toggle. When OFF, this specific node stays "
                        "silent on every Run (no sound, no console log). Other "
                        "Notify nodes in the workflow are unaffected."
                }),
                "sound": (sounds, {
                    "default": default,
                    "tooltip":
                        "Notification sound to play. The dropdown lists every "
                        ".mp3 / .wav / .ogg in assets/sounds/."
                }),
                "volume": ("INT", {
                    "default": 80, "min": 0, "max": 100, "step": 1,
                    "tooltip":
                        "Playback volume from 0 (silent) to 100 (full). Affects "
                        "both the Run-time notification and the Preview button."
                }),
                "label": ("STRING", {
                    "default": "", "multiline": False,
                    "tooltip":
                        "Optional name shown in browser and ComfyUI console logs "
                        "when the node fires. Helpful when multiple Notify nodes "
                        "fire in one workflow. Leave blank to use the sound name."
                }),
            },
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so the notification fires on every Run, even when
        # upstream is fully cached. NaN never equals itself, so ComfyUI's
        # change-detection treats this node as dirty every time.
        return float("nan")

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "notify"
    CATEGORY = "👑 Pixaroma"

    def notify(self, any, enabled, sound, volume, label):
        if not enabled:
            return {"ui": {}}
        msg = (label or "").strip() or sound.rsplit(".", 1)[0]
        print(f"[Notify Pixaroma] {msg}  ({sound} @ {volume}%)")
        return {
            "ui": {
                "pixaroma_notify": [
                    {"sound": sound, "volume": int(volume), "label": msg}
                ]
            }
        }


NODE_CLASS_MAPPINGS = {"NotifyPixaroma": NotifyPixaroma}
NODE_DISPLAY_NAME_MAPPINGS = {"NotifyPixaroma": "Notify Pixaroma"}
