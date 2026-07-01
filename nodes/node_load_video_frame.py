"""Load Video Frame Pixaroma — pick ONE exact frame out of a video and output it
as an image, like a Load Image node but for video.

Load a video, scrub the slider (or type a frame number / step with the arrows)
on the node body, and this decodes just that single frame. Decode + seek logic
lives in nodes/_video_helpers.py (PyAV primary, imageio fallback), shared with
Load Video Pixaroma, so this node file stays thin. The frame picker UI is
js/load_video_frame/index.js.
"""

import os

import numpy as np
import torch

import folder_paths

from ._video_helpers import decode_one
from .node_load_video import _list_input_videos


class PixaromaLoadVideoFrame:
    DESCRIPTION = (
        "Load Video Frame Pixaroma - load a video and pick one exact frame to "
        "send into your workflow as an image. Like a Load Image node, but for "
        "video.\n\n"
        "On the node you get a preview with a slider: drag it to any spot, use "
        "the arrow buttons to step one frame back or forward, or type the exact "
        "frame number. The frame count is read for you, so the slider knows how "
        "many frames the video has.\n\n"
        "Outputs: image (the picked frame), mask, frame_count, fps, width and "
        "height. The frame number is 0-based, so 0 is the very first frame.\n\n"
        "Reads with PyAV when available, otherwise imageio. Grabbing a frame deep "
        "in a long video stays fast because it seeks straight to that frame "
        "instead of reading the whole clip."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": (_list_input_videos(), {
                    "tooltip": "The video to load from ComfyUI's input folder. Use the 'choose video to upload' button, or pick one from the dropdown."}),
                "frame": ("INT", {"default": 0, "min": 0, "max": 999999, "step": 1,
                    "tooltip": "Which frame to grab. 0 is the first frame. Drag the slider or use the arrow buttons on the node, or type the number here. If you enter a number past the end of the video, the last frame is used."}),
            },
        }

    CATEGORY = "👑 Pixaroma/🖼️ Image"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "FLOAT", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "frame_count", "fps", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The picked frame as an image.",
        "A blank (fully opaque) mask that matches the frame, so it drops into the same slots as Load Image.",
        "How many frames the whole video has.",
        "Frames per second of the video.",
        "Frame width in pixels.",
        "Frame height in pixels.",
    )
    FUNCTION = "load"

    def load(self, video, frame=0):
        if not video:
            raise ValueError(
                "[Pixaroma] Load Video Frame — no video selected. Click 'choose "
                "video to upload' or pick one from the dropdown."
            )
        path = folder_paths.get_annotated_filepath(video)
        if not path or not os.path.exists(path):
            raise ValueError(f"[Pixaroma] Load Video Frame — file not found: {video}")

        result = decode_one(path, frame)
        arr = result["frame"]  # HxWx3 uint8
        image = torch.from_numpy(arr.astype(np.float32) / 255.0).unsqueeze(0)  # [1,H,W,3]
        # A video frame has no alpha, so the mask is fully opaque (zeros), matching
        # native LoadImage's "no alpha -> blank mask" convention.
        mask = torch.zeros((1, arr.shape[0], arr.shape[1]), dtype=torch.float32)

        print(
            f"[Pixaroma] Load Video Frame — {os.path.basename(path)}: frame "
            f"{result['index']} / {max(0, result['frame_count'] - 1)} "
            f"@ {result['fps']:.3f}fps, {result['width']}x{result['height']}"
        )
        return (
            image, mask, result["frame_count"], result["fps"],
            result["width"], result["height"],
        )

    @classmethod
    def IS_CHANGED(cls, video, **kwargs):
        # Re-run when the file's bytes could have changed. The frame widget value
        # is already part of the prompt, so ComfyUI re-runs on a frame change
        # automatically; IS_CHANGED only needs the file signature.
        try:
            path = folder_paths.get_annotated_filepath(video)
            st = os.stat(path)
            return f"{st.st_mtime_ns}:{st.st_size}"
        except Exception:
            return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, video, **kwargs):
        if not video:
            return "No video selected."
        if not folder_paths.exists_annotated_filepath(video):
            return f"Video not found: {video}"
        return True


NODE_CLASS_MAPPINGS = {"PixaromaLoadVideoFrame": PixaromaLoadVideoFrame}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaLoadVideoFrame": "Load Video Frame Pixaroma"}
