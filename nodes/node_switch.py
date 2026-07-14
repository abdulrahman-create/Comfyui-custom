"""Switch Pixaroma - dynamic-input switch that passes one active input through.

The user wires multiple upstream sources, picks which one is active via a
per-row toggle in the JS frontend, and the active value flows through to
the single output unchanged. Works for any wire type (MODEL, CLIP, IMAGE,
STRING, AUDIO, etc) via the shared AnyType from _type_helpers.

INPUT_TYPES pre-declares 32 optional input slots so ComfyUI's workflow
validation accepts whatever subset of slots the JS frontend exposes at
runtime. The active slot index is carried via the hidden SwitchState
input (Pattern #9 - injected by the JS app.graphToPrompt hook).

BRANCH SELECTION IS SERVER-SIDE (lazy inputs). Every input_N is declared
"lazy": True and check_lazy_status() asks ComfyUI for ONLY the active row,
so the unselected upstream branches are never executed. This is what makes
an API-exported workflow work: the JS frontend cannot run for a headless
/prompt submission, so a purely frontend-side trick could never select the
branch there. The JS hook still prunes the inactive links at SUBMIT time
(browser runs only) - that is now a caching/validation optimisation, not
the mechanism: it keeps an unused branch out of the cache signature and out
of validation, exactly as before. See "Switch Pixaroma Patterns" in
CLAUDE.md.
"""
from ._type_helpers import ANY


MAX_INPUTS = 32


def _active_index(switch_state):
    """1-based active row from the hidden SwitchState. Out-of-range/garbage -> 1.

    Goes through float() so a hand-edited API export is forgiving: "2", 2, 2.0 and
    "2.0" all mean row 2. (An API-exported workflow is MEANT to be edited by hand -
    plain int("2.0") raises, which would have silently run row 1 instead.)
    """
    try:
        idx = int(float(str(switch_state).strip()))
    except (TypeError, ValueError):
        return 1
    if idx < 1 or idx > MAX_INPUTS:
        return 1
    return idx


class PixaromaSwitch:
    DESCRIPTION = (
        "Switch Pixaroma - pass-through switch that lets you pick one of "
        "many wired-in inputs to flow through the output. Wire any number "
        "of upstream nodes (up to 32) into the rows, then click a row's "
        "toggle to make it active. The active row's wire flows out "
        "unchanged - works for any wire type (MODEL, CLIP, IMAGE, STRING, "
        "AUDIO, etc).\n\n"
        "The node grows automatically as you connect wires: there is "
        "always one empty trailing row at the bottom waiting for the "
        "next connection. Disconnect a wire to remove its row. Each row "
        "has a label you can click to rename, so you remember which "
        "input is which."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # "lazy": True -> ComfyUI does not evaluate an input's upstream branch
        # until check_lazy_status() asks for it. That is how only the active
        # row's branch runs (and the ONLY way it can work for an API submission,
        # where our JS never runs).
        optional = {
            f"input_{i}": (ANY, {"forceInput": True, "lazy": True, "tooltip": "An input to route. Wire any node here; click a row's toggle on the node to make it the active one, and that row's value flows out unchanged."})
            for i in range(1, MAX_INPUTS + 1)
        }
        return {
            "required": {},
            "optional": optional,
            "hidden": {
                "SwitchState": ("STRING", {"default": "1"}),
            },
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("output",)
    OUTPUT_TOOLTIPS = ("The input from the active (highlighted) row, passed through unchanged.",)
    FUNCTION = "pick"
    CATEGORY = "👑 Pixaroma/🔀 Logic & Flow"

    def check_lazy_status(self, SwitchState="1", **kwargs):
        """Ask ComfyUI to evaluate ONLY the active row's upstream branch.

        A wired-but-not-yet-evaluated input arrives as key-present/value-None; an
        UNWIRED input's key is absent entirely. So `key in kwargs` distinguishes
        "wired, please evaluate it" from "not wired". Returning [] for the unwired
        case is deliberate: the node then runs and pick() raises the friendly
        "nothing connected to the active row" error instead of ComfyUI throwing a
        raw NodeInputError. Must return a LIST (ComfyUI ignores non-list returns).
        """
        key = f"input_{_active_index(SwitchState)}"
        if key in kwargs and kwargs[key] is None:
            return [key]
        return []

    def pick(self, SwitchState="1", **kwargs):
        key = f"input_{_active_index(SwitchState)}"
        val = kwargs.get(key)
        if val is None:
            raise ValueError(
                "Switch Pixaroma: no input is connected to the active "
                "row. Wire at least one upstream node into a row, then "
                "click that row's toggle to make it active."
            )
        return (val,)


NODE_CLASS_MAPPINGS = {"PixaromaSwitch": PixaromaSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaSwitch": "Switch Pixaroma"}
