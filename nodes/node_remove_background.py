"""Remove Background Pixaroma - one-node background removal with a built-in
model dropdown.

Replaces the older wire-based version (1.3.32) that required a separate
Load Background Removal Model node upstream. Loads BiRefNet weights from
ComfyUI/models/background_removal/ and picks the right preprocessing
resolution from the filename:
    contains "matt" -> 2048 (matting models, soft edges)
    has "hr" as a word-piece -> 2048 (HR models, hard edges + detail)
    otherwise -> 1024 (standard)

ComfyUI's native loader hardcodes 1024 in birefnet.json, so we bypass it
and build BackgroundRemovalModel ourselves with the right image_size.
"""

import logging
import os
import re
from collections import OrderedDict

import torch
import folder_paths

import comfy.bg_removal_model
import comfy.model_management
import comfy.model_patcher
import comfy.ops
import comfy.utils

SENTINEL_NO_MODELS = "(no models - see Info tab)"

# Filename rule: case-insensitive. "matt" catches matte / matting. "hr"
# uses word-piece matching (no ASCII letter on either side, start/end of
# string counts) so birefnet-hr.safetensors matches but birefnet-shrunk
# does not.
_HR_RE = re.compile(r"(?<![a-z])hr(?![a-z])", re.IGNORECASE)


def _resolution_for_filename(name):
    """Return 2048 for matting / HR filenames, 1024 otherwise.

    Operates on the stem (no extension) so a stray ".pth" or
    ".safetensors" can't cause weird matches.
    """
    stem = os.path.splitext(name)[0]
    lower = stem.lower()
    if "matt" in lower:
        return 2048
    if _HR_RE.search(stem):
        return 2048
    return 1024


# Sentinel state-dict key that marks weights as the official BiRefNet
# architecture. Matches what comfy.bg_removal_model.load_background_removal_model
# checks for. We refuse to load anything that's missing it.
_BIREFNET_MARKER = "bb.layers.1.blocks.0.attn.relative_position_index"


class _PixaromaBgModel(comfy.bg_removal_model.BackgroundRemovalModel):
    """BackgroundRemovalModel that accepts a config dict instead of a json
    file path, so we can pass a custom image_size without writing a temp
    json. Mirrors the parent body line-for-line except for the dict-vs-file
    config source."""

    def __init__(self, config):
        # Intentionally skip super().__init__ - we replicate its body with
        # a dict source. If ComfyUI changes the parent signature, we'll
        # notice immediately on import.
        self.image_size = config.get("image_size", 1024)
        self.image_mean = config.get("image_mean", [0.0, 0.0, 0.0])
        self.image_std = config.get("image_std", [1.0, 1.0, 1.0])
        self.model_type = config.get("model_type", "birefnet")
        self.config = config.copy()

        model_class = comfy.bg_removal_model.BG_REMOVAL_MODELS.get(self.model_type)
        if model_class is None:
            raise ValueError(
                f"Remove Background Pixaroma: unknown model_type {self.model_type!r}. "
                "This node currently only supports 'birefnet'."
            )

        self.load_device = comfy.model_management.text_encoder_device()
        offload_device = comfy.model_management.text_encoder_offload_device()
        self.dtype = comfy.model_management.text_encoder_dtype(self.load_device)
        self.model = model_class(config, self.dtype, offload_device, comfy.ops.manual_cast)
        self.model.eval()

        self.patcher = comfy.model_patcher.CoreModelPatcher(
            self.model,
            load_device=self.load_device,
            offload_device=offload_device,
        )


def _load_bg_model(ckpt_path, image_size):
    """Load a BiRefNet safetensors at the requested input resolution.

    Returns a _PixaromaBgModel ready to call .encode_image(image).
    Raises ValueError with a helpful message if the file isn't a BiRefNet
    state dict.
    """
    sd = comfy.utils.load_torch_file(ckpt_path)
    if _BIREFNET_MARKER not in sd:
        raise ValueError(
            f"Remove Background Pixaroma: {os.path.basename(ckpt_path)} does not "
            "look like a BiRefNet model (missing the expected backbone keys). "
            "This node only supports BiRefNet variants. Download one from:\n"
            "  https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal"
        )

    config = {
        "model_type": "birefnet",
        "image_size": image_size,
        "image_mean": [0.0, 0.0, 0.0],
        "image_std": [1.0, 1.0, 1.0],
        "resize_to_original": True,
    }
    bg_model = _PixaromaBgModel(config)
    m, u = bg_model.load_sd(sd)
    if m:
        logging.warning(
            "Remove Background Pixaroma: %d missing keys when loading %s",
            len(m),
            os.path.basename(ckpt_path),
        )
    # Drop unused keys to free memory (matches comfy's native loader).
    u = set(u)
    for k in list(sd.keys()):
        if k not in u:
            sd.pop(k)
    return bg_model


# Stub class so the file imports; will be filled in Task 4.
class PixaromaRemoveBackground:
    pass


NODE_CLASS_MAPPINGS = {
    "PixaromaRemoveBackground": PixaromaRemoveBackground,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRemoveBackground": "Remove Background Pixaroma",
}
