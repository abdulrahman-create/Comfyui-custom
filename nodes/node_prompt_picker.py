"""Prompt Picker Pixaroma - row-based prompt library.

Two outputs:
- text (STRING): the active row's text. Use this for the simple "pick one
  prompt from a library" case - wire straight into CLIP Text Encode.
- prompts (PIXAROMA_PROMPT_LIST): a list of every row's text. Use this for
  the "fan out to many slots" case - wire into one or more Prompt From List
  Pixaroma nodes downstream, each picking its own index, so different parts
  of the workflow get different prompts.

Backend contract:
- 1 hidden STRING input (PromptPickerState) carrying { activeText, rowTexts }
  as JSON. Injected at submission time by app.graphToPrompt (Vue Compat #9).

All row state, ordering, and the active-index selection live in JS
(js/prompt_picker/index.js). Python sees only the resolved active text and
the list of row texts via the hidden PromptPickerState payload.
"""
import json


# Custom type so only matching Prompt From List Pixaroma nodes (or anything
# else that opts into this exact type string) can wire into our list output.
PIXAROMA_PROMPT_LIST = "PIXAROMA_PROMPT_LIST"


class PixaromaPromptPicker:
    DESCRIPTION = (
        "Prompt Picker Pixaroma - hold a library of labeled prompts on one "
        "node. Two outputs let you use the library two different ways:\n\n"
        "text: the active row's prompt as a plain string. Pick the active "
        "row with the small number selector at the top. Wire this into a "
        "CLIP Text Encode for the simple single-prompt case.\n\n"
        "prompts: a list of every row's prompt. Wire this into one or more "
        "Prompt From List Pixaroma nodes downstream; each of those is tiny "
        "and just picks one row by number. Use this when you want different "
        "parts of the same workflow (scene 1, scene 2, scene 3) to receive "
        "different prompts from the same library, without piling many "
        "output dots on this node.\n\n"
        "Click + Add prompt to add a row. Drag the handle to reorder. "
        "Clear text wipes all rows but keeps the row structure. Reset goes "
        "back to one empty row."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptPickerState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING", PIXAROMA_PROMPT_LIST)
    RETURN_NAMES = ("text", "prompts")
    FUNCTION = "build"
    CATEGORY = "👑 Pixaroma"

    @classmethod
    def IS_CHANGED(cls, PromptPickerState="{}", **kwargs):
        return PromptPickerState

    def build(self, PromptPickerState="{}"):
        try:
            state = json.loads(PromptPickerState) if PromptPickerState else {}
            if not isinstance(state, dict):
                state = {}
        except (ValueError, TypeError):
            print("[Pixaroma] Prompt Picker: invalid PromptPickerState JSON, returning empty")
            state = {}

        active = state.get("activeText", "")
        if not isinstance(active, str):
            active = ""

        rows = state.get("rowTexts")
        if not isinstance(rows, list):
            rows = []
        # Normalize: every entry must be a string.
        rows = [r if isinstance(r, str) else "" for r in rows]

        return (active, rows)


NODE_CLASS_MAPPINGS = {"PixaromaPromptPicker": PixaromaPromptPicker}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptPicker": "Prompt Picker Pixaroma"}
