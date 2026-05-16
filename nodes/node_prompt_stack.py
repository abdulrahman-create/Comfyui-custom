"""Prompt Stack Pixaroma - ordered list of toggle-able prompt chunks joined into one STRING.

Backend contract:
- 16 optional STRING inputs (wire_1 .. wire_16) for wire-mode rows.
- 1 hidden STRING input (PromptStackState) carrying the row schema + resolved separator.
- 1 STRING output (text) carrying the joined result.

Joining rules (mirrors js/prompt_stack/core.mjs):
- Iterate rows in current visual order (top to bottom).
- Skip disabled rows.
- For wire-mode rows pull text from kwargs[f"wire_{wireIndex}"]; else use the row's typed text.
- Trim leading/trailing whitespace; strip a single trailing comma so the user can be sloppy.
- Skip empty after cleanup.
- Join with state['separator'] (default ", ").
"""
import json


MAX_WIRES = 16


class PixaromaPromptStack:
    DESCRIPTION = (
        "Prompt Stack Pixaroma - hold an ordered list of prompt chunks you "
        "can toggle on or off, label, reorder, and individually wire from "
        "an upstream text source. All enabled chunks are joined into one "
        "STRING output using your chosen separator (default comma+space, "
        "configurable in settings).\n\n"
        "Click + Add row to add a chunk. Click the toggle pill to mute "
        "or unmute it. Click the chain-link icon to flip the row to wire "
        "mode and pipe in text from an upstream node. Drag the handle on "
        "the left to reorder."
    )

    @classmethod
    def INPUT_TYPES(cls):
        optional = {
            f"wire_{i}": ("STRING", {"forceInput": True, "default": ""})
            for i in range(1, MAX_WIRES + 1)
        }
        return {
            "required": {},
            "optional": optional,
            "hidden": {"PromptStackState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma"

    def build(self, PromptStackState="{}", **kwargs):
        state = self._parse_state(PromptStackState)
        out_parts = []
        for row in state.get("rows", []):
            if not row.get("enabled"):
                continue
            if row.get("wireMode") and row.get("wireIndex"):
                txt = kwargs.get(f"wire_{row['wireIndex']}", "") or ""
            else:
                txt = row.get("text", "") or ""
            txt = txt.strip()
            if txt.endswith(","):
                txt = txt[:-1].rstrip()
            if not txt:
                continue
            out_parts.append(txt)
        sep = state.get("separator", ", ")
        return (sep.join(out_parts),)

    @staticmethod
    def _parse_state(raw):
        try:
            s = json.loads(raw) if isinstance(raw, str) else {}
            return s if isinstance(s, dict) else {}
        except (ValueError, TypeError):
            return {}


NODE_CLASS_MAPPINGS = {"PixaromaPromptStack": PixaromaPromptStack}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptStack": "Prompt Stack Pixaroma"}
