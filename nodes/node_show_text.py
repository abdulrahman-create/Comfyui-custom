import torch

from .node_ref import any_type


class PixaromaShowText:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"source": (any_type, {})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "show"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma"

    def show(self, source):
        try:
            if isinstance(source, torch.Tensor):
                text = (
                    f"Tensor  shape={tuple(source.shape)}"
                    f"  dtype={source.dtype}"
                    f"  min={source.min().item():.4f}"
                    f"  max={source.max().item():.4f}"
                )
            elif isinstance(source, dict) and "samples" in source:
                s = source["samples"]
                text = f"Latent  shape={tuple(s.shape)}"
            else:
                text = str(source)
        except Exception:
            text = str(source)
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {
    "PixaromaShowText": PixaromaShowText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaShowText": "Show Text Pixaroma",
}
