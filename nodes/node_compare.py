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
        "in Settings -> Pixaroma -> Compare."
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
        return {
            "required": {
                "image1": ("IMAGE", {"tooltip": "First image to compare. Wire any IMAGE output here (e.g. the 'before' image)."}),
                "image2": ("IMAGE", {"tooltip": "Second image to compare. Wire any IMAGE output here (e.g. the 'after' image). The on-node viewer lets you flip between side-by-side / overlap / diff modes after both images arrive."}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "compare_images"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def compare_images(self, image1, image2):
        results = []
        prefix = "pixaroma_compare" + self.prefix_append
        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                prefix, self.output_dir,
                image1[0].shape[1], image1[0].shape[0],
            )
        )

        for tensor in [image1, image2]:
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
            })
            counter += 1

        return {"ui": {"images": results}}


NODE_CLASS_MAPPINGS = {
    "PixaromaCompare": PixaromaCompare,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaCompare": "Image Compare Pixaroma",
}
