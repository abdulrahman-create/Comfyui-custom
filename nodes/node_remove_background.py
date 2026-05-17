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

    # ComfyUI's BiRefNet hardcodes a Swin-L backbone (embed_dim=192). The
    # lite variant uses Swin-T (embed_dim=96) - same architecture name but
    # totally different tensor shapes. Catch it here with a clear error
    # before load_sd explodes with a wall of size mismatches.
    patch_weight = sd.get("bb.patch_embed.proj.weight")
    if patch_weight is not None and patch_weight.shape[0] != 192:
        raise ValueError(
            f"Remove Background Pixaroma: {os.path.basename(ckpt_path)} looks "
            f"like a different BiRefNet variant (embed_dim={patch_weight.shape[0]}, "
            "probably the 'lite' Swin-T version). This node only supports the "
            "Swin-L backbone variants (standard, HR, HR-matting). Pick a "
            "different file from the dropdown, or download one of:\n"
            "  https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal\n"
            "  https://huggingface.co/ZhengPeng7/BiRefNet_HR\n"
            "  https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting"
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


# LRU cache, cap 2. Typical compare-flow is standard vs HR (or HR vs
# matting), so keeping two warm avoids reloads while staying small in
# memory. Keyed on (path, image_size) so a rename / resolution change
# is correctly cache-busted.
_MODEL_CACHE = OrderedDict()
_CACHE_CAP = 2


def _get_cached_model(ckpt_path, image_size):
    key = (os.path.abspath(ckpt_path), image_size)
    if key in _MODEL_CACHE:
        _MODEL_CACHE.move_to_end(key)
        return _MODEL_CACHE[key]
    model = _load_bg_model(ckpt_path, image_size)
    _MODEL_CACHE[key] = model
    while len(_MODEL_CACHE) > _CACHE_CAP:
        _MODEL_CACHE.popitem(last=False)
    return model


_INSTALL_MESSAGE = (
    "No background-removal models found.\n"
    "\n"
    "Drop a BiRefNet .safetensors into ComfyUI/models/background_removal/ and "
    "refresh the workflow.\n"
    "\n"
    "Recommended files:\n"
    "  birefnet.safetensors           standard, 1024, hard edges\n"
    "  birefnet-hr.safetensors        HR, 2048, hard edges, more detail\n"
    "  birefnet-matting.safetensors   HR, 2048, soft edges (hair / fur)\n"
    "\n"
    "Filenames containing 'matt' or 'hr' (case-insensitive) preprocess at 2048; "
    "everything else at 1024. 2048 is slower and uses more VRAM.\n"
    "\n"
    "Download:\n"
    "  Standard:   https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal\n"
    "  HR:         https://huggingface.co/ZhengPeng7/BiRefNet_HR\n"
    "  HR-matting: https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting"
)


_DEFAULT_MODEL_NAME = "birefnet.safetensors"


def _list_models():
    """Return the list of model filenames the dropdown should show.
    Sentinel item when the folder is empty so the dropdown is never blank.
    `birefnet.safetensors` (the standard model) is pinned to position 0 so
    it becomes the default selection. The rest are alphabetical."""
    try:
        names = folder_paths.get_filename_list("background_removal")
    except Exception:
        names = []
    if not names:
        return [SENTINEL_NO_MODELS]
    names = sorted(names)
    if _DEFAULT_MODEL_NAME in names:
        names.remove(_DEFAULT_MODEL_NAME)
        names.insert(0, _DEFAULT_MODEL_NAME)
    return names


class PixaromaRemoveBackground:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": (_list_models(),),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "MASK")
    RETURN_NAMES = ("image", "mask", "inverted_mask")
    FUNCTION = "execute"
    CATEGORY = "👑 Pixaroma"
    DESCRIPTION = (
        "Remove an image background with a BiRefNet model and return the "
        "cutout (RGBA), the foreground mask, and the inverted mask in one "
        "node.\n\n"
        "Models load from ComfyUI/models/background_removal/. Filename "
        "controls preprocessing resolution: 'matt' or 'hr' in the name "
        "(case-insensitive) preprocesses at 2048; all others at 1024. "
        "Recommended names: birefnet.safetensors (standard), "
        "birefnet-hr.safetensors (HR), birefnet-matting.safetensors "
        "(HR matting for hair / fur).\n\n"
        "Downloads:\n"
        "  https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal\n"
        "  https://huggingface.co/ZhengPeng7/BiRefNet_HR\n"
        "  https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting"
    )

    def execute(self, image, model):
        if model == SENTINEL_NO_MODELS:
            raise ValueError(_INSTALL_MESSAGE)

        ckpt_path = folder_paths.get_full_path("background_removal", model)
        if not ckpt_path or not os.path.isfile(ckpt_path):
            raise ValueError(
                f"Remove Background Pixaroma: model file {model!r} not found "
                "in ComfyUI/models/background_removal/. The dropdown may be "
                "stale - reload the page to refresh it."
            )

        image_size = _resolution_for_filename(model)
        bg_model = _get_cached_model(ckpt_path, image_size)

        # encode_image returns (B, 1, H, W). Squeeze to canonical MASK
        # shape (B, H, W) so downstream mask-math nodes don't have to
        # branch on it.
        mask = bg_model.encode_image(image)
        if mask.ndim == 4 and mask.shape[1] == 1:
            mask = mask.squeeze(1)
        elif mask.ndim == 4 and mask.shape[-1] == 1:
            mask = mask.squeeze(-1)

        # Match image device + dtype before concat so RGBA stays on one
        # device and we don't get a float64 promotion on CPU.
        mask = mask.to(device=image.device, dtype=image.dtype)

        # Build RGBA: keep RGB (drop any pre-existing alpha), stack fg
        # mask as alpha. fg=1 -> opaque, bg=0 -> transparent.
        image_rgba = torch.cat([image[..., :3], mask.unsqueeze(-1)], dim=-1)

        inverted = 1.0 - mask
        return (image_rgba, mask, inverted)


NODE_CLASS_MAPPINGS = {
    "PixaromaRemoveBackground": PixaromaRemoveBackground,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaRemoveBackground": "Remove Background Pixaroma",
}
