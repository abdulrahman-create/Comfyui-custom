class PixaromaLabel:
    """Annotation label — pure UI node, no image processing."""

    DESCRIPTION = (
        "Label Pixaroma - a simple text label for documenting workflows. Click "
        "the node to open a fullscreen editor where you set the text content, "
        "font family, font size (up to 256 px), text color, and background color.\n\n"
        "Pure annotation - no image processing, no inputs to wire, no outputs "
        "to chain. The styled label is rendered directly on the node body and "
        "saves / restores with the workflow."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "label_json": ("STRING", {"default": '{"text":"Label Pixaroma","fontSize":18,"fontFamily":"Arial"}', "multiline": True, "tooltip": "Internal serialized state (text, font, sizes, colors). Do not edit directly - click the node to open the editor instead."}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    # OUTPUT_NODE intentionally NOT set (defaults to False) so ComfyUI's
    # executor skips Label entirely on Run. The label is pure decoration
    # rendered in JS; there is no Python-side work to do. Skipping
    # execution also stops ComfyUI from drawing an "X.Xs" timing badge
    # above the node every run, which looks weird on what is just a
    # styled text caption.
    CATEGORY = "👑 Pixaroma/📝 Notes & Overlay"

    def noop(self, label_json):
        return {}


NODE_CLASS_MAPPINGS = {
    "PixaromaLabel": PixaromaLabel,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaLabel": "Label Pixaroma",
}
