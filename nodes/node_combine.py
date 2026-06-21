"""Combine Pixaroma - join two inputs into one batch.

Takes any two inputs (any_1 + any_2) and merges them into a single output:
- images / video-frame batches (tensors [B,H,W,C]) are concatenated along the
  batch dimension; mismatched sizes are rescaled to the first input's W/H,
- latents (dicts with "samples") are batched the same way,
- numbers / strings are collected into a list,
- anything else (lists / tuples) is concatenated.

If one side is missing (None / unconnected) the other side passes through
unchanged - which is exactly what you want on the first round of a loop, when
there is nothing accumulated yet. Pairs with Loop Start / Loop End to pile up
each round's result.
"""

import torch

from ._type_helpers import ANY


class PixaromaCombine:
    DESCRIPTION = (
        "Join two inputs into one batch. Wire any two things into any_1 and "
        "any_2 and Combine merges them: images and video frames are stacked "
        "into one batch, latents are batched, numbers and text are gathered "
        "into a list. If one side is empty it just passes the other side "
        "through, so it is safe to use as the accumulator inside a loop "
        "(round 1 has nothing to add yet). Works with any wire type."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "any_1": (ANY, {"tooltip": "First input. Images, video frames, latents, numbers, text - anything. Can be empty."}),
                "any_2": (ANY, {"tooltip": "Second input, joined onto the first. In a loop this is usually the new round's result, with any_1 carrying everything gathered so far."}),
            },
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("batch",)
    OUTPUT_TOOLTIPS = (
        "The two inputs joined together. For images/frames this is one bigger batch; for numbers/text it is a list.",
    )
    FUNCTION = "run"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    @staticmethod
    def _latent_batch(a, b):
        import comfy.utils

        out = a.copy()
        s1 = a["samples"]
        s2 = b["samples"]
        if s1.shape[1:] != s2.shape[1:]:
            s2 = comfy.utils.common_upscale(s2, s1.shape[3], s1.shape[2], "bilinear", "center")
        out["samples"] = torch.cat((s1, s2), dim=0)
        out["batch_index"] = (
            a.get("batch_index", list(range(s1.shape[0])))
            + b.get("batch_index", list(range(s2.shape[0])))
        )
        return out

    def run(self, any_1=None, any_2=None):
        a, b = any_1, any_2

        # Images / video-frame batches (tensors [B, H, W, C])
        if isinstance(a, torch.Tensor) or isinstance(b, torch.Tensor):
            if a is None:
                return (b,)
            if b is None:
                return (a,)
            if a.shape[1:] != b.shape[1:]:
                import comfy.utils

                b = comfy.utils.common_upscale(
                    b.movedim(-1, 1), a.shape[2], a.shape[1], "bilinear", "center"
                ).movedim(1, -1)
            return (torch.cat((a, b), 0),)

        # Latents (dict with "samples")
        if isinstance(a, dict) and "samples" in a:
            if b is None:
                return (a,)
            if isinstance(b, dict) and "samples" in b:
                return (self._latent_batch(a, b),)
        if isinstance(b, dict) and "samples" in b:
            if a is None:
                return (b,)
            if isinstance(a, dict) and "samples" in a:
                return (self._latent_batch(b, a),)

        # Numbers / strings -> gather into a list (bool is excluded so it is not
        # treated as an int)
        if isinstance(a, (str, float, int)) and not isinstance(a, bool):
            if b is None:
                return (a,)
            if isinstance(b, tuple):
                return (b + (a,),)
            if isinstance(b, list):
                return (b + [a],)
            return ([a, b],)
        if isinstance(b, (str, float, int)) and not isinstance(b, bool):
            if a is None:
                return (b,)
            if isinstance(a, tuple):
                return (a + (b,),)
            if isinstance(a, list):
                return (a + [b],)
            return ([b, a],)

        # Anything else (lists / tuples / objects)
        if a is None:
            return (b,)
        if b is None:
            return (a,)
        return (a + b,)


NODE_CLASS_MAPPINGS = {"PixaromaCombine": PixaromaCombine}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaCombine": "Combine Pixaroma"}
