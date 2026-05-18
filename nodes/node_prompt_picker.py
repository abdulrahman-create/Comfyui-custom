"""Prompt Picker Pixaroma - row-based prompt library with multiple independent outputs.

Backend contract:
- 1 hidden STRING input (PromptPickerState) carrying picks JSON.
- MAX_OUTPUTS STRING outputs (text_1, text_2, ..., text_8).
  Each output sends the text of whichever library row the user picked for
  that output slot. Outputs not actively used by the workflow are unwired
  and ignored.

All row state, ordering, and the per-output pick mapping live in JS
(js/prompt_picker/index.js). Python sees only the resolved per-output text
list via the hidden PromptPickerState payload, injected at submission time by
app.graphToPrompt (see Vue Compat #9 in CLAUDE.md).

Different from Prompt Multi: this node outputs N prompts in ONE workflow run
(one per output slot), it does NOT loop / queue multiple runs.
"""
import json


MAX_OUTPUTS = 8


class PixaromaPromptPicker:
    DESCRIPTION = (
        "Prompt Picker Pixaroma - hold a library of labeled prompts on one "
        "node and send different prompts to different parts of the workflow "
        "by wiring multiple outputs.\n\n"
        "Each row in the library is a labeled prompt. The Outputs section "
        "below the library lists one entry per output slot; for each output, "
        "pick which library row's text gets sent through it. Click + Add "
        "output to add another output (up to 8). Wire each output to "
        "wherever you need (scene 1, scene 2, character description, etc.).\n\n"
        "Click + Add prompt to add a library row. Drag the handle on the "
        "left to reorder. Clear text wipes all rows but keeps the row "
        "structure. Reset goes back to one empty row and one output.\n\n"
        "Use this when you want a single library of prompts feeding multiple "
        "slots in one workflow. Unlike Prompt Multi, this does NOT queue "
        "multiple runs; one Run produces one output per output slot."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptPickerState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",) * MAX_OUTPUTS
    RETURN_NAMES = tuple(f"text_{i + 1}" for i in range(MAX_OUTPUTS))
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

        # The JS graphToPrompt hook bakes the resolved per-output texts into
        # state["pickTexts"] at submit time, so the backend doesn't need to
        # know the row contents at all. Fallback to empty strings for any
        # unused output slots.
        pick_texts = state.get("pickTexts")
        if not isinstance(pick_texts, list):
            pick_texts = []
        result = []
        for i in range(MAX_OUTPUTS):
            if i < len(pick_texts) and isinstance(pick_texts[i], str):
                result.append(pick_texts[i])
            else:
                result.append("")
        return tuple(result)


NODE_CLASS_MAPPINGS = {"PixaromaPromptPicker": PixaromaPromptPicker}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptPicker": "Prompt Picker Pixaroma"}
