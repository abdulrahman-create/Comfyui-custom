"""Krea LoRA Converter Pixaroma.

Convert a Krea 2 LoRA trained on fal.ai into a ComfyUI-compatible file. The
conversion is a lossless key rename (see _krea_lora_convert_helpers) - the
weights are copied byte-for-byte, only the layer names change.

`inspect_lora` and `resolve_and_convert` are the folder_paths-aware wrappers the
server routes (js Convert button + live readout) share with this node's Run path.
The pure conversion math lives in the helpers module and never imports comfy /
folder_paths, so it stays testable on its own.

Independent tool: not affiliated with or endorsed by Krea or fal.ai.
"""
import os

import folder_paths

from ._krea_lora_convert_helpers import (
    KreaConvertError,
    analyze,
    convert_file,
    default_output_name,
    read_safetensors_header,
    sanitize_output_name,
)

_NO_LORAS = "(put LoRAs in models/loras)"


def _lora_list():
    try:
        files = list(folder_paths.get_filename_list("loras"))
    except Exception:
        files = []
    return files or [_NO_LORAS]


def _resolve_lora_path(lora_name):
    if not lora_name or not isinstance(lora_name, str) or lora_name == _NO_LORAS:
        return None
    try:
        return folder_paths.get_full_path("loras", lora_name)
    except Exception:
        return None


def inspect_lora(lora_name):
    """Detection info for the node readout: what the picked file is + suggested output."""
    path = _resolve_lora_path(lora_name)
    if not path or not os.path.isfile(path):
        return {"ok": False, "message": "File not found."}
    try:
        _, header = read_safetensors_header(path)
    except KreaConvertError as exc:
        return {"ok": False, "message": str(exc)}
    except Exception as exc:
        return {"ok": False, "message": "Could not read the file: {}".format(exc)}
    info = analyze(header)
    info["ok"] = True
    info["suggested_output"] = default_output_name(path)
    return info


def resolve_and_convert(lora_name, output_name, overwrite):
    """Do the conversion. Returns a result dict (never raises) for the route + Run path."""
    path = _resolve_lora_path(lora_name)
    if not path or not os.path.isfile(path):
        return {"ok": False, "message": "File not found."}
    try:
        typed = (output_name or "").strip()
        out_name = sanitize_output_name(typed) if typed else default_output_name(path)
        out_path = os.path.join(os.path.dirname(path), out_name)
        stats = convert_file(path, out_path, overwrite=bool(overwrite))
    except KreaConvertError as exc:
        return {"ok": False, "message": str(exc)}
    except Exception as exc:
        return {"ok": False, "message": "Conversion failed: {}".format(exc)}

    skipped = stats.get("skipped", [])
    return {
        "ok": True,
        "output_name": stats["output_name"],
        "converted": stats["converted"],
        "total": stats["total"],
        "skipped_count": len(skipped),
        "skipped_sample": skipped[:12],
        "message": "Converted {} of {} layers.".format(stats["converted"], stats["total"]),
    }


class KreaLoraConvertPixaroma:
    DESCRIPTION = (
        "Convert a Krea 2 LoRA trained on fal.ai into a ComfyUI-compatible file. "
        "fal.ai's Krea 2 LoRAs use layer names ComfyUI does not recognize, so they "
        "do not load; this node renames them and saves a new copy in your loras "
        "folder that any LoRA loader can use. The weights are copied exactly, so the "
        "result is identical, just loadable. Pick a LoRA, check the readout, and click "
        "Convert. It only reads your file and writes a new one: it never changes the "
        "original and never downloads anything. "
        "Independent tool, not affiliated with or endorsed by Krea or fal.ai."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora_name": (_lora_list(), {
                    "tooltip":
                        "The LoRA to convert. Pick a Krea 2 LoRA you trained on fal.ai. "
                        "The readout on the node confirms whether it is a fal Krea 2 "
                        "LoRA before you convert."
                }),
                "output_name": ("STRING", {
                    "default": "", "multiline": False,
                    "tooltip":
                        "Filename for the converted copy (saved next to the original). "
                        "Leave blank to use the original name plus _comfyui."
                }),
                "overwrite": ("BOOLEAN", {
                    "default": False,
                    "tooltip":
                        "If a file with the output name already exists, replace it. "
                        "Off by default so you never overwrite a file by accident."
                }),
            },
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "convert"
    CATEGORY = "👑 Pixaroma/🧰 Utility"

    @classmethod
    def IS_CHANGED(cls, lora_name, output_name, overwrite, **kwargs):
        # Re-run only when the selection, the options, or the source file change.
        path = _resolve_lora_path(lora_name)
        try:
            mtime = os.path.getmtime(path) if path and os.path.isfile(path) else 0
        except OSError:
            mtime = 0
        return "{}|{}|{}|{}".format(lora_name, output_name, overwrite, mtime)

    def convert(self, lora_name, output_name, overwrite):
        result = resolve_and_convert(lora_name, output_name, bool(overwrite))
        if result.get("ok"):
            tag = result["output_name"]
            print("[Krea LoRA Converter] {} -> {}".format(lora_name, tag))
            if result.get("skipped_count"):
                print("[Krea LoRA Converter] WARNING: {} layer(s) were not recognized "
                      "and were skipped.".format(result["skipped_count"]))
        else:
            print("[Krea LoRA Converter] {}".format(result.get("message", "failed")))
        return {"ui": {"pixaroma_krea_convert": [result]}}


NODE_CLASS_MAPPINGS = {"KreaLoraConvertPixaroma": KreaLoraConvertPixaroma}
NODE_DISPLAY_NAME_MAPPINGS = {"KreaLoraConvertPixaroma": "Krea LoRA Converter Pixaroma"}
