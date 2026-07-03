import os
import sys
import json
import uuid
import wave
import shutil
import subprocess
import threading

import numpy as np
import torch

import folder_paths
import comfy.model_management

# Honour ComfyUI's global --disable-metadata flag (same as SaveImage). Wrapped so
# the node still imports on a build that lacks it.
try:
    from comfy.cli_args import args as _comfy_cli_args
except Exception:
    _comfy_cli_args = None


def _escape_ffmetadata(value):
    """Escape a value for an ffmpeg FFMETADATA file: backslash-escape = ; # \\
    and newline (per the ffmetadata spec). Done in one pass so the backslashes we
    add are never themselves re-escaped."""
    out = []
    for ch in value:
        if ch in ("=", ";", "#", "\\"):
            out.append("\\")
            out.append(ch)
        elif ch == "\n":
            out.append("\\\n")
        else:
            out.append(ch)
    return "".join(out)


def _build_video_meta_json(prompt, extra_pnginfo):
    """JSON string {"workflow":..., "prompt":...} to embed in the mp4's comment
    atom, or None if neither is available. This is the exact shape the
    VideoHelperSuite frontend parses out of an mp4's comment when you drag the
    video back into ComfyUI, so the workflow is restored."""
    meta = {}
    if isinstance(extra_pnginfo, dict):
        wf = extra_pnginfo.get("workflow")
        if wf is not None:
            meta["workflow"] = wf
    if prompt is not None:
        meta["prompt"] = prompt
    if not meta:
        return None
    try:
        return json.dumps(meta)
    except Exception:
        return None


def _write_ffmetadata_comment(path, comment_json):
    """Write an FFMETADATA file with a single `comment` key. ffmpeg's mov muxer
    maps `comment` to the standard ©cmt atom (NO -movflags use_metadata_tags, so
    it stays the ilst form the VHS reader scans for)."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(";FFMETADATA1\n")
        f.write("comment=" + _escape_ffmetadata(comment_json) + "\n")


def _resolve_ffmpeg():
    """Locate the ffmpeg binary. Prefer imageio-ffmpeg's bundled exe (already
    on disk if comfyui-videohelpersuite or imageio is installed), then fall
    back to ffmpeg on PATH."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    raise RuntimeError(
        "[Pixaroma] Save Mp4: ffmpeg was not found, and it is needed to make the video.\n"
        "   Easiest fix is to install imageio-ffmpeg (a bundled ffmpeg, no system setup):\n"
        "     Portable ComfyUI (Windows) - run this in your ComfyUI folder\n"
        "       (the one that holds the python_embeded folder):\n"
        "         python_embeded\\python.exe -m pip install imageio-ffmpeg\n"
        "     Or in ComfyUI Manager, use its pip install option and enter: imageio-ffmpeg\n"
        "     Your own Python (venv/conda): pip install imageio-ffmpeg\n"
        "   Or install ffmpeg system-wide from https://ffmpeg.org/download.html\n"
    )


_COUNTER_LOCK = threading.Lock()


def _next_mp4_counter(folder, prefix):
    """Find the next free counter N for `<folder>/<prefix>_<N:05d>.mp4`.
    folder_paths.get_save_image_path's built-in counter assumes Comfy's
    `<prefix>_<N>_.<ext>` pattern (note the trailing underscore) and parses
    `int("00001.mp4")` for our cleaner `<prefix>_<N>.mp4` — which raises and
    silently returns 1, so every save overwrites Video_00001.mp4. We scan
    ourselves instead."""
    if not os.path.isdir(folder):
        return 1
    pat = prefix + "_"
    max_n = 0
    for f in os.listdir(folder):
        if not f.startswith(pat) or not f.endswith(".mp4"):
            continue
        middle = f[len(pat):-len(".mp4")]
        try:
            n = int(middle)
        except ValueError:
            continue
        if n > max_n:
            max_n = n
    return max_n + 1


def _write_wav_pcm16(path, waveform, sample_rate):
    """Write a Comfy AUDIO waveform tensor [C, samples] (or [B, C, samples])
    as 16-bit PCM WAV using only stdlib + numpy. Avoids torchaudio backend
    issues on Windows."""
    if waveform.dim() == 3:
        waveform = waveform[0]
    n_ch = int(waveform.shape[0])
    if n_ch == 0:
        raise ValueError("[Pixaroma] Save Mp4 — audio waveform has 0 channels.")
    samples = waveform.detach().cpu().numpy()
    # np.clip leaves NaN as NaN (NaN * 32767 -> garbage int16); scrub NaN/Inf to
    # silence / extremes before the cast.
    samples = np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0)
    samples = np.clip(samples, -1.0, 1.0)
    samples = (samples * 32767.0).astype(np.int16)
    interleaved = samples.T.tobytes()
    with wave.open(path, "wb") as f:
        f.setnchannels(n_ch)
        f.setsampwidth(2)
        f.setframerate(int(sample_rate))
        f.writeframes(interleaved)


class PixaromaSaveMp4:
    """Encode an IMAGE batch (and optional AUDIO) to a single H.264 mp4.
    save_mode=save writes to ComfyUI's output/ folder; save_mode=preview
    writes to ComfyUI's temp/ folder (auto-cleared on restart) so users can
    iterate without cluttering output/. No conflict with VHS Video Combine —
    separate class, separate category, fewer knobs, opinionated defaults."""

    DESCRIPTION = (
        "Save Mp4 Pixaroma - encode an IMAGE batch (and optional AUDIO) to a "
        "single H.264 mp4 with a built-in <video> preview right on the node "
        "body so you can watch the result without leaving ComfyUI.\n\n"
        "Frames stream straight to ffmpeg's stdin (no temp PNG files); audio "
        "is muxed in as AAC 192k. Pairs with AudioReact Pixaroma but works "
        "with any source that produces frames + AUDIO.\n\n"
        "The workflow is embedded in the saved mp4 (its comment metadata), so "
        "you can drag the video back into ComfyUI to restore the graph - reading "
        "it back needs a video pack like VideoHelperSuite installed.\n\n"
        "ffmpeg binary is auto-located: imageio-ffmpeg's bundled exe is "
        "preferred (no system install needed - 'pip install imageio-ffmpeg'), "
        "with ffmpeg on PATH as a fallback. yuv420p requires even width and "
        "height; the node surfaces a clear error rather than ffmpeg's opaque "
        "crash if dimensions are odd.\n\n"
        "Encoder is hardcoded to libx264 / preset medium / CRF 19. Bring those "
        "back to INPUT_TYPES if a workflow needs per-clip control."
    )

    # Hardcoded encoder defaults — exposed as widgets earlier, removed for a
    # cleaner UI. Bring them back to INPUT_TYPES if a workflow needs control.
    _CRF = 19
    _PIX_FMT = "yuv420p"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_frames": ("IMAGE", {"tooltip": "Frame batch to encode. Wire Audio React Pixaroma's video_frames output here."}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0,
                    "tooltip": "Output frame rate. Wire Audio React Pixaroma's fps output here so it always matches what produced the frames."}),
                "filename_prefix": ("STRING", {"default": "Video",
                    "tooltip": "Filename stem. The node appends a 5-digit counter and .mp4 (e.g. Video_00001.mp4). Use '/' for subfolders, date tokens like %date:yyyy-MM-dd%, and node references like %Seed Pixaroma.seed% that print another node's field value into the name."}),
                "save_mode": (["save", "preview"], {"default": "save",
                    "tooltip": "save: write to ComfyUI's output/ folder, kept across restarts. preview: write to ComfyUI's temp/ folder, auto-cleared on restart — use while iterating so you don't clutter output/. The in-node video preview works the same in both modes."}),
                "trim_to_audio": ("BOOLEAN", {"default": False,
                    "tooltip": "Off (default): keep every video frame; the audio simply ends where it ends. On: end the video exactly at the audio's length (ffmpeg -shortest), for when the audio is the master (e.g. with Audio React). On can drop the last frame or two when the audio is slightly shorter than the video."}),
            },
            "optional": {
                "audio": ("AUDIO", {"tooltip": "Optional audio track to mux into the mp4 as AAC 192k. Connect Audio React Pixaroma's audio output here."}),
            },
            # The workflow + prompt, embedded into the mp4 so dragging it back into
            # ComfyUI restores the graph (read by VideoHelperSuite's video loader).
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def save(self, video_frames, fps, filename_prefix, save_mode, trim_to_audio, audio=None,
             prompt=None, extra_pnginfo=None):
        if video_frames is None or video_frames.shape[0] == 0:
            raise ValueError("[Pixaroma] Save Mp4 — input video_frames batch is empty.")

        ffmpeg_path = _resolve_ffmpeg()
        crf = self._CRF
        pix_fmt = self._PIX_FMT
        fps_int = max(1, int(round(float(fps))))

        frames = video_frames
        n_frames, H, W, _ = frames.shape

        # yuv420p requires even dimensions; surface a clear error rather than
        # the opaque "height not divisible by 2" ffmpeg crash.
        if pix_fmt == "yuv420p" and (W % 2 != 0 or H % 2 != 0):
            raise ValueError(
                f"[Pixaroma] Save Mp4 — encoder requires even width and "
                f"height, got {W}x{H}. Resize input frames to even dimensions "
                f"(Audio React Pixaroma snaps to multiples of 8 automatically)."
            )

        # Resolve subfolder + base filename via folder_paths (handles
        # filename_prefix that contains a subfolder like "videos/clip"); use
        # our own counter scan because Comfy's built-in one assumes the
        # `<prefix>_<N>_.<ext>` trailing-underscore convention and silently
        # returns 1 for our cleaner `<prefix>_<N>.mp4` naming.
        # save_mode picks the destination root: output/ for keepers, temp/
        # for ad-hoc previews (auto-cleared on ComfyUI restart). The JS
        # reads entry.type, so the in-node <video> works for both via /view.
        if save_mode == "preview":
            out_dir = folder_paths.get_temp_directory()
            file_type = "temp"
        else:
            out_dir = folder_paths.get_output_directory()
            file_type = "output"
        full_folder, fname, _ignored, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, out_dir, W, H,
        )
        os.makedirs(full_folder, exist_ok=True)
        # Hold a lock around scan + claim so two save_mp4 nodes in the
        # same workflow can't both pick the same counter and overwrite
        # each other. Touch the file inside the lock to claim it.
        with _COUNTER_LOCK:
            counter = _next_mp4_counter(full_folder, fname)
            while True:
                out_filename = f"{fname}_{counter:05d}.mp4"
                out_path = os.path.join(full_folder, out_filename)
                try:
                    # O_EXCL atomically claims the name across processes too.
                    # Re-claim on each bump so a collision can't slip through
                    # (the scan saw N as max, but another writer just took N+1).
                    fd = os.open(out_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    os.close(fd)
                    break
                except FileExistsError:
                    counter += 1
                    if counter > 99999:
                        raise RuntimeError(
                            "[Pixaroma] Save Mp4 — could not find a free output "
                            "filename."
                        )

        # If audio is supplied, write it to a temp wav alongside so ffmpeg can
        # mux both inputs in a single pass.
        temp_audio_path = None
        if audio is not None and audio.get("waveform") is not None and audio["waveform"].numel() > 0:
            temp_audio_path = os.path.join(
                folder_paths.get_temp_directory(),
                f"pixaroma_save_mp4_{uuid.uuid4().hex}.wav",
            )
            os.makedirs(os.path.dirname(temp_audio_path), exist_ok=True)
            try:
                _write_wav_pcm16(temp_audio_path, audio["waveform"], audio["sample_rate"])
            except Exception as e:
                # Don't leak the partial WAV, and don't fail the whole save just
                # because audio prep failed - drop the audio and encode video only.
                print(f"[Pixaroma] Save Mp4 — could not prepare audio ({e}); "
                      f"encoding without it.")
                if os.path.exists(temp_audio_path):
                    try:
                        os.remove(temp_audio_path)
                    except OSError:
                        pass
                temp_audio_path = None

        # Embed the workflow (+ prompt) as the mp4's comment atom, so dragging the
        # video back into ComfyUI restores the graph. Via an FFMETADATA file (not a
        # command-line arg) so a big workflow can't blow the Windows command-line
        # length limit. Skipped when metadata is globally disabled (--disable-metadata)
        # or when there's nothing to embed (e.g. a pure-API run).
        metadata_path = None
        disable_meta = bool(getattr(_comfy_cli_args, "disable_metadata", False))
        if not disable_meta:
            meta_json = _build_video_meta_json(prompt, extra_pnginfo)
            if meta_json:
                try:
                    metadata_path = os.path.join(
                        folder_paths.get_temp_directory(),
                        f"pixaroma_save_mp4_meta_{uuid.uuid4().hex}.txt",
                    )
                    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
                    _write_ffmetadata_comment(metadata_path, meta_json)
                except Exception as e:
                    print(f"[Pixaroma] Save Mp4 — could not prepare metadata ({e}); "
                          f"saving without it.")
                    if metadata_path is not None and os.path.exists(metadata_path):
                        try:
                            os.remove(metadata_path)
                        except OSError:
                            pass
                    metadata_path = None

        # Build ffmpeg command. Frames piped on stdin as raw RGB24.
        cmd = [
            ffmpeg_path, "-y",
            "-loglevel", "error",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", f"{W}x{H}",
            "-r", str(fps_int),
            "-i", "-",
        ]
        if temp_audio_path is not None:
            cmd += ["-i", temp_audio_path]
        # The FFMETADATA input has no A/V streams, so it never disturbs ffmpeg's
        # video/audio auto-selection or -shortest; it's added last and pulled in via
        # -map_metadata <its input index>.
        meta_input_index = None
        if metadata_path is not None:
            meta_input_index = 1 + (1 if temp_audio_path is not None else 0)
            cmd += ["-i", metadata_path]
        cmd += [
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", str(crf),
            "-pix_fmt", pix_fmt,
        ]
        if temp_audio_path is not None:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
            if trim_to_audio:
                cmd += ["-shortest"]
        if meta_input_index is not None:
            cmd += ["-map_metadata", str(meta_input_index)]
        cmd += [out_path]

        print(f"[Pixaroma] Save Mp4 [{save_mode}] — writing {n_frames} frames @ {fps_int}fps "
              f"({W}x{H}, crf={crf}, {pix_fmt}"
              f"{', +audio' if temp_audio_path else ''}) -> {out_filename}")

        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
            )
        except Exception:
            # Popen failed (e.g. ffmpeg vanished). Don't leak the temp WAV, and
            # remove the 0-byte output file we already claimed (O_EXCL) so
            # output/ has no junk and the counter doesn't drift.
            if temp_audio_path is not None and os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except OSError:
                    pass
            if metadata_path is not None and os.path.exists(metadata_path):
                try:
                    os.remove(metadata_path)
                except OSError:
                    pass
            if os.path.exists(out_path):
                try:
                    os.remove(out_path)
                except OSError:
                    pass
            raise

        # Drain stderr in a background thread. Otherwise the OS pipe buffer
        # (4 KB on Windows) fills if ffmpeg emits any output and the next
        # stdin.write() blocks forever.
        stderr_chunks = []

        def _drain(pipe):
            try:
                for chunk in iter(lambda: pipe.read(4096), b""):
                    stderr_chunks.append(chunk)
            except Exception:
                pass

        drain_thread = threading.Thread(target=_drain, args=(proc.stderr,), daemon=True)
        drain_thread.start()

        broke_pipe = False
        success = False
        try:
            try:
                for i in range(n_frames):
                    comfy.model_management.throw_exception_if_processing_interrupted()
                    frame_u8 = (frames[i].clamp(0.0, 1.0).cpu().numpy() * 255.0
                                ).astype(np.uint8)
                    proc.stdin.write(frame_u8.tobytes())
            except BrokenPipeError:
                # ffmpeg closed its input before we fed every frame. This is the
                # EXPECTED outcome when trim_to_audio adds -shortest and the audio
                # is shorter than the frames: ffmpeg finalizes the mp4 at the
                # audio's end and exits, so the remaining frame writes break the
                # pipe. The output is already complete (trimmed to the audio).
                # Stop feeding; a genuine ffmpeg failure still surfaces as a
                # non-zero exit code below.
                broke_pipe = True
            try:
                if not proc.stdin.closed:
                    proc.stdin.close()
            except OSError:
                pass
            proc.wait()
            drain_thread.join()
            if proc.returncode != 0:
                stderr = b"".join(stderr_chunks).decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"[Pixaroma] Save Mp4 — ffmpeg failed (exit {proc.returncode}):\n"
                    f"{stderr}"
                )
            success = True  # rc 0 (incl. a -shortest broke_pipe) -> valid output
        finally:
            # On the exception path the explicit close above never ran. Close
            # the pipe so the OS handle isn't leaked (Windows is sensitive to
            # this) before killing.
            try:
                if proc.stdin and not proc.stdin.closed:
                    proc.stdin.close()
            except OSError:
                pass
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            if drain_thread.is_alive():
                drain_thread.join(timeout=2)
            if temp_audio_path is not None and os.path.exists(temp_audio_path):
                try:
                    os.remove(temp_audio_path)
                except OSError:
                    pass
            if metadata_path is not None and os.path.exists(metadata_path):
                try:
                    os.remove(metadata_path)
                except OSError:
                    pass
            # If the encode didn't finish cleanly (error / interrupt / non-zero
            # exit), drop the claimed-but-empty or partial out file so output/
            # has no 0-byte junk and the counter doesn't drift past it. A
            # successful -shortest trim (success=True) keeps its valid file.
            if not success and os.path.exists(out_path):
                try:
                    os.remove(out_path)
                except OSError:
                    pass

        if broke_pipe:
            print("[Pixaroma] Save Mp4 — video trimmed to the audio length (trim_to_audio is on).")
        if save_mode == "preview":
            print(f"[Pixaroma] Save Mp4 — preview written to temp/ (auto-cleared on restart): {out_path}")
        else:
            print(f"[Pixaroma] Save Mp4 — saved {out_path}")

        # Two output keys so the file is visible BOTH in ComfyUI's standard
        # output panel and in our in-node <video> preview (js/save_mp4/index.js
        # listens for `pixaroma_videos`).
        entry = {
            "filename": out_filename,
            "subfolder": subfolder,
            "type": file_type,
            "format": "video/mp4",
        }
        return {"ui": {"images": [entry], "pixaroma_videos": [entry]}}


NODE_CLASS_MAPPINGS = {
    "PixaromaSaveMp4": PixaromaSaveMp4,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaSaveMp4": "Save Mp4 Pixaroma",
}
