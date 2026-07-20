import os
import uuid

import folder_paths
import numpy as np
from PIL import Image

# _json_safe: strip NaN/Inf (PROMPT's is_changed:[NaN]) so the ui payload sent
# over the websocket is valid JSON - else the frontend JSON.parse drops the
# whole executed message (preview frames + save metadata both lost).
from ._save_helpers import _build_pnginfo, _json_safe, _safe_prefix


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image."""
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


class PixaromaPreview:
    """Preview an image (or batch) inline in the node body, with buttons for
    Save-to-Disk and Save-to-Output. The image is also exposed on the output
    edge.

    Modes:
      preview (default): all batch frames are written to ComfyUI's temp/
        directory and shown in the node strip; nothing is saved permanently.
        The temp PNGs embed the workflow (like native PreviewImage), so a
        preview can be dragged back onto the canvas to restore the workflow.
      save:              all batch frames are saved to output/ with embedded
        workflow metadata, exactly like the native SaveImage node, AND still
        shown in the strip preview.
    """

    DESCRIPTION = (
        "Preview Image Pixaroma - inline image preview with Save Disk, Save Output, Copy, and Open buttons, "
        "batch-aware. Wire any IMAGE source into the input. All batch frames render in the node body; click any "
        "thumbnail to expand it inline. Arrow keys flip through the batch, click anywhere on the open image to "
        "advance, Esc or X collapses. Toggle Grid / Strip layout via the small icon in the top-right corner of "
        "the preview area.\n\n"
        "Save Disk picks any folder on your computer; the suggested filename auto-increments per click. Save "
        "Output writes to ComfyUI's output/ folder. Copy puts the selected frame on your OS clipboard as PNG so "
        "you can paste straight into another node, paint app, message, etc. Open opens the selected frame in a "
        "new browser tab for full-screen viewing or comparing multiple side by side. All four buttons act on the "
        "currently selected frame; Save Disk and Save Output embed the workflow into the PNG so you can drag it "
        "back into ComfyUI later.\n\n"
        "Output format: PNG (lossless, embeds workflow), JPG (smaller, no workflow), or WebP (smallest, good for "
        "websites). Use preserve_filename with the filename from Load Images from Folder to keep original names.\n\n"
        "Flip save_mode to 'save' and the node becomes a drop-in replacement for SaveImage: every batch frame is "
        "automatically written to output/ on each Run with embedded workflow metadata. The preview also survives "
        "workflow tab switching, so you can leave it on a specific frame and come back to it.\n\n"
        "The filename_prefix field supports subfolder syntax with '/' (e.g. 'SDXL/portrait'), date tokens like "
        "VHS / VideoHelperSuite (e.g. '%date:yyyy-MM-dd%/img' -> 'output/2026-05-10/img_00001_.png'), and native "
        "ComfyUI tokens (%year%, %month%, %day%, %hour%, %minute%, %second%, %width%, %height%). Date format codes "
        "are yyyy yy MM dd HH mm ss. It also supports node-reference tokens like %Seed Pixaroma.seed% (or "
        "%KSampler.seed%) that insert another node's field value into the name, just like the native Save Image "
        "node. See the project README for the full token reference."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image (or batch) to preview. Each frame appears as a thumbnail in the strip; click one to expand it inline. Wire any IMAGE source here."}),
                "filename_prefix": ("STRING", {"default": "img", "tooltip": (
                    "Filename stem written to output/. The node adds a 5-digit counter and .png. "
                    "Use '/' for subfolders (e.g. 'SDXL/portrait'). "
                    "Supports date tokens like %date:yyyy-MM-dd% (same syntax as VHS / VideoHelperSuite), "
                    "native ComfyUI tokens like %year%, %month%, %day%, and node references like "
                    "%Seed Pixaroma.seed% that print another node's field value into the name. "
                    "See the node's Info panel (right sidebar) for the full token reference and examples."
                )}),
                "preserve_filename": ("BOOLEAN", {"default": False, "tooltip": "When ON, the filename_prefix is used EXACTLY as the output filename (with the chosen format extension). No counter, no date tokens — the file is overwritten on each run. Wire the filename output from Load Images from Folder here to keep the original name."}),
                "output_format": (["png", "jpg", "webp"], {"default": "png", "tooltip": "PNG: lossless, embeds workflow metadata. JPG: smaller file, no workflow. WebP: smallest file size, great for websites and web use."}),
                "save_mode": (["preview", "save"], {"default": "preview", "tooltip": "preview: write each batch frame to ComfyUI's temp/ folder, auto-cleared on restart. Use this while iterating so you don't clutter output/. The temp PNGs embed the workflow, so you can drag a preview back onto the canvas to restore the graph (just like the native Preview node). save: write every batch frame to output/ with embedded workflow metadata, exactly like the native SaveImage node. The on-node preview strip works the same in both modes; the manual Save to Disk / Save to Output buttons are independent of save_mode."}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The image(s) passed through unchanged, so you can chain a preview inline without breaking the wire.",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Always re-execute so each Run re-saves the file and emits fresh
        # frame URLs. Without this, if the user deletes the saved file on
        # disk and clicks Run, ComfyUI's input-hash cache skips execution
        # and the preview shows stale URLs pointing to the deleted file.
        return float("nan")

    def preview(
        self,
        image,
        filename_prefix,
        preserve_filename,
        output_format,
        save_mode,
        prompt=None,
        extra_pnginfo=None,
    ):
        prefix = _safe_prefix(filename_prefix) or "Preview"
        fmt = output_format or "png"
        ext = f".{fmt}"

        results = []
        if save_mode == "save":
            output_dir = folder_paths.get_output_directory()

            def _save_one(pil, path, pnginfo=None):
                """Save a PIL image in the chosen format."""
                if fmt == "png":
                    pil.save(path, "PNG", pnginfo=pnginfo, compress_level=4)
                elif fmt == "jpg":
                    rgb = pil.convert("RGB") if pil.mode != "RGB" else pil
                    rgb.save(path, "JPEG", quality=92)
                elif fmt == "webp":
                    pil.save(path, "WEBP", quality=85, method=6)

            if preserve_filename:
                # Exact filename — no counter, no date tokens, no subfolder parsing.
                # Save directly to output/ root. Overwrites on re-run (user's intent).
                for i, tensor in enumerate(image):
                    pil = _tensor_to_pil(tensor)
                    pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo) if fmt == "png" else None
                    fname = f"{prefix}{ext}"
                    _save_one(pil, os.path.join(output_dir, fname), pnginfo)
                    results.append({
                        "filename": fname,
                        "subfolder": "",
                        "type": "output",
                    })
            else:
                full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                    prefix, output_dir, image.shape[2], image.shape[1]
                )
                os.makedirs(full_folder, exist_ok=True)
                for i, tensor in enumerate(image):
                    pil = _tensor_to_pil(tensor)
                    pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo) if fmt == "png" else None
                    fname = f"{name}_{counter + i:05}_.{fmt}"
                    _save_one(pil, os.path.join(full_folder, fname), pnginfo)
                    results.append({
                        "filename": fname,
                        "subfolder": subfolder,
                        "type": "output",
                    })
        else:  # preview mode
            # Embed the workflow/prompt into the temp PNG too (same helper save
            # mode uses, and the same thing native PreviewImage does), so a temp
            # preview can be dragged back onto the canvas to restore the workflow
            # without having to switch to save mode and clean up output/ after.
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo)
            for tensor in image:
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
                pil.save(os.path.join(temp_dir, fname), "PNG", pnginfo=pnginfo)
                results.append({
                    "filename": fname,
                    "subfolder": "",
                    "type": "temp",
                })

        # Hand the EXECUTION-time prompt + workflow to the frontend so the
        # Save Disk / Save Output buttons embed the seed that ACTUALLY produced
        # this image. The buttons otherwise call app.graphToPrompt() at click
        # time, which - with "control after generate: randomize" - captures the
        # NEXT (already-randomized) seed, so dragging the saved PNG back into
        # ComfyUI reproduced a different image. This matches what save_mode=save
        # bakes in server-side.
        workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
        # Sanitize: PROMPT contains is_changed:[NaN] (IS_CHANGED returns nan),
        # which is invalid JSON and would break the whole executed message.
        meta = _json_safe({"prompt": prompt, "workflow": workflow})

        # Embed the workflow/prompt metadata as an extra field on the FIRST
        # frame entry instead of in a separate `pixaroma_preview_meta` ui
        # key. ComfyUI's server-side get_outputs_summary (comfy_execution/
        # jobs.py) counts EVERY dict item across EVERY list-keyed ui array
        # as a separate "output" - which becomes the Assets panel's stack-
        # count badge. A separate meta key would add +1 to that count for
        # every save, surfacing as a confusing "2" or "3" badge on a single
        # PNG. Embedding meta as an extra field on the frame dict keeps the
        # count at 1 (server counts dicts, not nested fields). The frontend
        # safely ignores unknown fields like `_pixaroma_meta` per the
        # ResultItemImpl constructor in dialogService bundle - only known
        # fields (filename, subfolder, type, mediaType, nodeId) are copied.
        if results:
            results[0]["_pixaroma_meta"] = meta

        # Save mode emits the standard `ui.images` key so the Media Assets
        # panel refreshes (it uses that key as its "new output file" signal).
        # Preview mode uses our custom `pixaroma_preview_frames` key so
        # ComfyUI doesn't try to auto-populate node.imgs (defineProperty in
        # js/preview/index.js also blocks that as belt-and-braces). Either
        # way it's ONE ui key with ONE dict per frame, so the stack badge
        # never gets inflated.
        ui_key = "images" if save_mode == "save" else "pixaroma_preview_frames"
        return {
            "ui": {ui_key: results},
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Image Pixaroma"}
