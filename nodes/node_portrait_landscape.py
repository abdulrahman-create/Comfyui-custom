"""Portrait Landscape Pixaroma — output a width/height in the chosen
orientation. Enter (or wire) two dimensions and click Portrait or Landscape:
Portrait returns the TALL arrangement (smaller value as width), Landscape the
WIDE arrangement (larger value as width). One node replaces the
WH + WH + Switch WH 'flip orientation' setup.

The Portrait/Landscape choice lives on node.properties.portraitLandscapeState
and is injected into the hidden PortraitLandscapeState input by the JS
graphToPrompt hook (Resolution Pixaroma pattern, CLAUDE.md Vue Compat #9), so
no extra input slot is exposed for it."""


class PixaromaPortraitLandscape:
    DESCRIPTION = (
        "Output a width and height in the orientation you pick. Enter your two "
        "dimensions (or wire them in from another node), then click Portrait or "
        "Landscape. Portrait gives the tall arrangement (the smaller number "
        "becomes the width), Landscape gives the wide arrangement (the larger "
        "number becomes the width). Flipping orientation is one click, with no "
        "need to keep two WH nodes and a switch. The order you enter the two "
        "numbers does not matter. Outputs width and height."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 832, "min": 8, "max": 16384, "step": 8, "tooltip": "One of your two dimensions. Type a value or wire a number in. Portrait/Landscape decides whether this becomes the long or short side, so the order you enter the two numbers does not matter."}),
                "height": ("INT", {"default": 1216, "min": 8, "max": 16384, "step": 8, "tooltip": "The other dimension. Type a value or wire a number in."}),
            },
            "hidden": {
                "PortraitLandscapeState": ("STRING", {"default": "portrait"}),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    OUTPUT_TOOLTIPS = (
        "The output width. In Portrait this is the smaller of your two numbers; in Landscape it is the larger.",
        "The output height. In Portrait this is the larger of your two numbers; in Landscape it is the smaller.",
    )
    FUNCTION = "orient"
    CATEGORY = "👑 Pixaroma/🔢 Values"

    def orient(self, width=832, height=1216, PortraitLandscapeState="portrait"):
        w = int(width)
        h = int(height)
        lo, hi = min(w, h), max(w, h)
        if PortraitLandscapeState == "landscape":
            return (hi, lo)   # wide
        return (lo, hi)       # portrait / tall (default)


NODE_CLASS_MAPPINGS = {"PixaromaPortraitLandscape": PixaromaPortraitLandscape}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPortraitLandscape": "Portrait Landscape Pixaroma"}
