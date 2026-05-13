"""Prompt Reader Pixaroma - extract the positive prompt embedded in an image.

Reads PNG tEXt chunks (ComfyUI workflow JSON or A1111 'parameters'), walks the
graph back from the sampler to the positive CLIP-text-encode node, and returns
the underlying text. STRING output only - no IMAGE/MASK side. If the image
has no embedded prompt, returns a short notice string explaining that, so
downstream nodes still receive a usable value.
"""

import hashlib
import os

import folder_paths

from ._prompt_reader_helpers import read_prompt_from_image


class PixaromaPromptReader:
    DESCRIPTION = (
        "Prompt Reader Pixaroma - load an image that was generated with "
        "ComfyUI (or Automatic1111 / Forge) and read the positive prompt "
        "saved inside its PNG metadata. No image preview, just the text. "
        "Outputs the prompt as STRING so you can wire it straight into a "
        "CLIPTextEncode (or any text input) and re-use it.\n\n"
        "Drag-drop a PNG onto the node, hit the Upload button, or pick from "
        "the input combo. If the image has no embedded prompt (e.g. JPG, "
        "screenshot, or a PNG whose metadata was stripped), the readout "
        "shows a short explanatory message and the STRING output carries "
        "that same message so downstream wiring still works."
    )

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        try:
            files = [
                f for f in os.listdir(input_dir)
                if os.path.isfile(os.path.join(input_dir, f))
            ]
            files = folder_paths.filter_files_content_types(files, ["image"])
        except Exception:
            files = []
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
        }

    CATEGORY = "👑 Pixaroma"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "read"
    OUTPUT_NODE = True

    def read(self, image: str):
        try:
            image_path = folder_paths.get_annotated_filepath(image)
        except Exception:
            text = "Image file not found in the input folder."
            return {"ui": {"text": [text]}, "result": (text,)}

        result = read_prompt_from_image(image_path)
        if result.get("found"):
            text = result.get("text") or ""
        else:
            text = result.get("message") or "No prompt found in this image."
        return {"ui": {"text": [text]}, "result": (text,)}

    @classmethod
    def IS_CHANGED(cls, image):
        try:
            image_path = folder_paths.get_annotated_filepath(image)
            m = hashlib.sha256()
            with open(image_path, "rb") as f:
                m.update(f.read())
            return m.hexdigest()
        except Exception:
            return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaPromptReader": PixaromaPromptReader}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPromptReader": "Prompt Reader Pixaroma"}
