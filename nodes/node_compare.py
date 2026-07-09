import os
import random
import numpy as np
from PIL import Image
import folder_paths


class PixaromaCompare:
    DESCRIPTION = (
        "Image Compare Pixaroma - the easiest way to see the difference between "
        "two images. Wire any two IMAGE outputs into image1 and image2 (e.g. "
        "before / after upscaling, original / inpainted, two checkpoint variants), "
        "then run the workflow.\n\n"
        "The on-node viewer offers three modes: side-by-side with a draggable "
        "slider, overlap with adjustable opacity, or 'diff' which highlights "
        "exactly what changed between the two. The default mode is configurable "
        "in Settings -> Pixaroma -> Compare.\n\n"
        "Both inputs are optional. If only one image is connected (for example "
        "when a branch feeding one input is muted or bypassed), the node just "
        "shows that image; if neither is connected it shows a short note - it "
        "never throws a system error, so it is safe to leave in a workflow that "
        "toggles between text-to-image and image-to-image."
    )

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_pixcmp_" + ''.join(
            random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5)
        )
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(s):
        # Both optional so a muted / bypassed / unconnected branch does NOT
        # raise ComfyUI's "required input is missing" system error. A false
        # positive in a workflow that toggles text-to-image vs image-to-image
        # (one input then has nothing feeding it). compare_images() handles a
        # missing image gracefully instead.
        return {
            "optional": {
                "image1": ("IMAGE", {"tooltip": "First image to compare (e.g. the 'before' image). Optional - if it isn't connected, or its branch is muted / bypassed, the node just shows the other image (or a note) instead of throwing an error."}),
                "image2": ("IMAGE", {"tooltip": "Second image to compare (e.g. the 'after' image). Optional - the on-node viewer compares once BOTH images arrive; with only one connected it simply shows that one, and with neither it shows a short note."}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "compare_images"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def compare_images(self, image1=None, image2=None):
        # Tag each saved image with its slot (1 / 2) so the frontend maps it to
        # the right side even when only one is present (a lone image2 must land
        # on side 2, not side 1). Missing inputs are simply skipped - never a
        # crash. With neither connected the frontend shows its "Connect images
        # & run to compare" note.
        pairs = [(1, image1), (2, image2)]
        present = [(slot, t) for (slot, t) in pairs if t is not None]

        results = []
        if present:
            first = present[0][1]
            prefix = "pixaroma_compare" + self.prefix_append
            full_output_folder, filename, counter, subfolder, _ = (
                folder_paths.get_save_image_path(
                    prefix, self.output_dir,
                    first[0].shape[1], first[0].shape[0],
                )
            )
            for (slot, tensor) in present:
                i = 255.0 * tensor[0].cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                file = f"{filename}_{counter:05}_.png"
                img.save(
                    os.path.join(full_output_folder, file),
                    compress_level=self.compress_level,
                )
                results.append({
                    "filename": file,
                    "subfolder": subfolder,
                    "type": self.type,
                    "slot": slot,
                })
                counter += 1

        return {"ui": {"images": results}}


NODE_CLASS_MAPPINGS = {
    "PixaromaCompare": PixaromaCompare,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaCompare": "Image Compare Pixaroma",
}
