"""Text Overlay Pixaroma — single-text overlay on a required image.

Reads state from a hidden TextOverlayState input populated by
js/text_overlay/index.js's app.graphToPrompt hook. Renders the single
text via nodes/_text_render_helpers.py::render_text_layer on top of the
required upstream image.
"""
import json
import numpy as np
import torch
from PIL import Image

from ._text_render_helpers import render_text_layer


class PixaromaTextOverlay:
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Adds a single styled text overlay on top of an input image. "
        "Edit quickly via the widgets on the node, or click 'Open Text "
        "Editor' for a fullscreen visual editor with drag, snap, and align tools."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Required upstream image. Text is overlayed on this."}),
            },
            "optional": {
                "text": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Optional. When wired to an upstream STRING source, overrides the panel's text at render time.",
                }),
            },
            "hidden": {
                "TextOverlayState": ("STRING", {"default": "{}"}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "build"

    def build(self, image, text=None, TextOverlayState="{}"):
        try:
            state = json.loads(TextOverlayState) if TextOverlayState else {}
        except json.JSONDecodeError:
            print("[Text Overlay Pixaroma] WARN: malformed TextOverlayState, treating as empty")
            state = {}

        # Optional text input overrides the panel's text when wired (text is
        # None when the slot is not connected).
        if text is not None:
            state["text"] = str(text)

        # state IS the single text dict (or empty dict = no overlay)
        outputs = []
        for b in range(image.shape[0]):
            frame = image[b].clamp(0, 1).cpu().numpy()
            frame = (frame * 255).astype(np.uint8)
            pil = Image.fromarray(frame, "RGB").convert("RGBA")
            if state and state.get("text"):
                render_text_layer(pil, state)
            outputs.append(self._pil_to_tensor_array(pil))
        return (torch.stack(outputs, dim=0),)

    @staticmethod
    def _pil_to_tensor_array(pil):
        rgb = pil.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return torch.from_numpy(arr)


NODE_CLASS_MAPPINGS = {"PixaromaTextOverlay": PixaromaTextOverlay}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaTextOverlay": "Text Overlay Pixaroma"}
