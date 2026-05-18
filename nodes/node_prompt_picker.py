"""Prompt Picker Pixaroma - row-based prompt library with a single active selection.

Backend contract:
- 1 hidden STRING input (PromptPickerState) carrying the resolved active row text as JSON.
- 1 STRING output (text) carrying that active prompt.

All row state, ordering, and the active-index selection live in JS
(js/prompt_picker/index.js). Python sees only the resolved active prompt text
via the hidden PromptPickerState payload, which is injected at submission time
by app.graphToPrompt (see Vue Compat #9 in CLAUDE.md).

Different from Prompt Multi: this node outputs ONE prompt (the active one) per
queue run; it does NOT loop / queue multiple workflow runs. Drop several Prompt
Picker nodes in a workflow and set each one to a different row to send
different prompts to different downstream slots (scenes, characters, etc.).
"""
import json


class PixaromaPromptPicker:
    DESCRIPTION = (
        "Prompt Picker Pixaroma - hold a library of labeled prompts on one "
        "node and pick which one is sent out using a small number selector. "
        "Click + Add prompt to add a row. Type a label and the prompt text "
        "for each row. Use the Active selector at the top to pick which row "
        "is the output. The active row is highlighted with an orange border. "
        "Drag the handle on the left to reorder. Clear text wipes all rows "
        "but keeps the row structure. Reset goes back to one empty row.\n\n"
        "Use this when you want a library of prompts you can switch between "
        "without rewiring, or to send different prompts to different parts of "
        "the same workflow by dropping several Prompt Picker nodes and "
        "setting each to a different row. Unlike Prompt Multi, this does NOT "
        "queue multiple runs; one Run produces one output per Picker node."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {"PromptPickerState": ("STRING", {"default": "{}"})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
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
        return (state.get("activeText", ""),)


NODE_CLASS_MAPPINGS = {"PixaromaPromptPicker": PixaromaPromptPicker}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptPicker": "Prompt Picker Pixaroma"}
