"""Video decode helpers for Load Video Pixaroma.

Frame decoding prefers PyAV (`av`) and falls back to imageio (which uses the
same bundled ffmpeg as Save Mp4). Audio is pulled via an ffmpeg subprocess to a
temp WAV and read back with stdlib `wave` + numpy — the mirror of Save Mp4's
`_write_wav_pcm16` — so the AUDIO output never depends on torchaudio.

All third-party imports are wrapped defensively (CLAUDE.md Background Removal
Pattern #0): a missing or broken library must NOT crash the whole plugin at
import time. The node only surfaces a clear, actionable error when it actually
runs and no backend is available.
"""

import os
import shutil
import subprocess
import tempfile
import uuid
import wave

import numpy as np
import torch

# ── Optional third-party backends (never crash import) ───────────────────────
try:
    import av  # PyAV — primary decoder (video + accurate metadata)
    _AV_OK = True
except Exception:
    av = None
    _AV_OK = False

try:
    import imageio  # fallback decoder (uses imageio-ffmpeg's bundled binary)
    _IMAGEIO_OK = True
except Exception:
    imageio = None
    _IMAGEIO_OK = False

try:
    import cv2  # used only for fast frame resize when present
    _CV2_OK = True
except Exception:
    cv2 = None
    _CV2_OK = False

try:
    import folder_paths
except Exception:
    folder_paths = None

try:
    import comfy.model_management as _mm
except Exception:
    _mm = None


# Extensions the file picker + uploader accept. Kept here so the node and the
# upload route can share one list.
VIDEO_EXTS = {
    "mp4", "mov", "mkv", "webm", "avi", "m4v", "gif",
    "mpg", "mpeg", "wmv", "flv", "ogv", "ts",
}


def video_backend_available() -> bool:
    return _AV_OK or _IMAGEIO_OK


def _need_backend():
    if not video_backend_available():
        raise RuntimeError(
            "[Pixaroma] Load Video needs a video reader, and none is installed.\n"
            "   Install PyAV (recommended) one of these ways:\n"
            "     ComfyUI Manager: use its pip-install option and enter:  av\n"
            "     Portable ComfyUI (Windows): in your ComfyUI folder (the one with\n"
            "       python_embeded) run:  python_embeded\\python.exe -m pip install av\n"
            "     Your own Python (venv/conda):  pip install av\n"
            "   (Alternatively:  pip install imageio imageio-ffmpeg )\n"
        )


def resolve_ffmpeg():
    """Locate ffmpeg the same way Save Mp4 does: imageio-ffmpeg's bundled exe
    first, then ffmpeg on PATH. Returns None if neither is found (audio is then
    skipped rather than crashing the load)."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return shutil.which("ffmpeg")


def _interrupt_check():
    """Let the user cancel a long load from the ComfyUI Stop button."""
    if _mm is not None:
        _mm.throw_exception_if_processing_interrupted()


# ── Frame transforms ─────────────────────────────────────────────────────────

def _scale_rgb(src, tw, th):
    """Plain (stretch) resize of an HxWx3 uint8 array to exactly (tw, th)."""
    H, W = src.shape[0], src.shape[1]
    if (tw, th) == (W, H):
        return np.ascontiguousarray(src)
    src = np.ascontiguousarray(src)
    if _CV2_OK:
        interp = cv2.INTER_AREA if (tw * th) < (W * H) else cv2.INTER_LANCZOS4
        return cv2.resize(src, (tw, th), interpolation=interp)
    from PIL import Image
    return np.asarray(Image.fromarray(src).resize((tw, th), Image.LANCZOS))


def _resize_rgb(arr, w, h):
    """Resize one HxWx3 uint8 frame:
      both 0    -> unchanged
      one 0     -> scale that axis, the other follows (keeps aspect)
      both set  -> COVER + center-crop to exactly (w, h): scale the frame to
                   fully cover the target box, then trim the overflow. Keeps the
                   picture's proportions and never stretches, matching Resize
                   Crop Pixaroma."""
    src = arr[..., :3]
    H, W = src.shape[0], src.shape[1]
    w = int(w) if w and w > 0 else 0
    h = int(h) if h and h > 0 else 0
    if w == 0 and h == 0:
        return np.ascontiguousarray(src)

    if w > 0 and h > 0:
        # Cover: scale so the frame fully covers (w, h), then center-crop.
        scale = max(w / float(W), h / float(H))
        rw = max(w, int(round(W * scale)))
        rh = max(h, int(round(H * scale)))
        resized = _scale_rgb(src, rw, rh)
        x0 = (rw - w) // 2
        y0 = (rh - h) // 2
        return np.ascontiguousarray(resized[y0:y0 + h, x0:x0 + w])

    # Single axis -> proportional scale.
    if w > 0:
        tw = w
        th = max(1, int(round(H * w / float(W))))
    else:
        th = h
        tw = max(1, int(round(W * h / float(H))))
    return _scale_rgb(src, tw, th)


def _resample_iter(raw_iter, native_fps, force_fps):
    """Nearest-hold resample a frame iterator from native_fps to force_fps.
    Drops frames when force < native, duplicates when force > native."""
    dt = 1.0 / force_fps
    next_t = 0.0
    for i, fr in enumerate(raw_iter):
        t = i / native_fps
        guard = 0
        while next_t <= t + 1e-9:
            yield fr
            next_t += dt
            guard += 1
            if guard > 4096:  # pathological force/native ratio safety
                break


def _collect(raw_iter, native_fps, force_fps, skip_first, max_frames,
             custom_w, custom_h):
    """Run the raw frame iterator through resample -> window -> skip, resizing
    each kept frame. Returns (list_of_uint8_frames, out_fps).

    Window model: max_frames is how many frames to read from the START (the
    window; 0 = all). skip_first then trims from the FRONT of that window, so the
    output is source frames [skip_first, max_frames). This bounds the decode to
    at most max_frames source frames."""
    if force_fps > 0 and native_fps > 0:
        src = _resample_iter(raw_iter, native_fps, force_fps)
        base_fps = force_fps
    else:
        src = raw_iter
        base_fps = native_fps

    out = []
    idx = -1
    for fr in src:
        _interrupt_check()
        idx += 1
        if max_frames and idx >= max_frames:
            break  # window end reached - stop reading
        if idx < skip_first:
            continue  # trim the front of the window
        out.append(_resize_rgb(fr, custom_w, custom_h))

    out_fps = base_fps if base_fps > 0 else 0.0
    return out, out_fps


# ── Backends ─────────────────────────────────────────────────────────────────

def _decode_av(path, force_fps, skip_first, max_frames, custom_w, custom_h):
    container = av.open(path)
    try:
        vstreams = container.streams.video
        if not vstreams:
            raise RuntimeError(
                f"[Pixaroma] Load Video — no video stream in "
                f"{os.path.basename(path)}."
            )
        v = vstreams[0]
        try:
            v.thread_type = "AUTO"
        except Exception:
            pass
        rate = v.average_rate or v.guessed_rate or getattr(v, "base_rate", None)
        native_fps = float(rate) if rate else 30.0
        if not (native_fps > 0):
            native_fps = 30.0
        cw = int(getattr(v.codec_context, "width", 0) or getattr(v, "width", 0) or 0)
        ch = int(getattr(v.codec_context, "height", 0) or getattr(v, "height", 0) or 0)

        def raw():
            for frame in container.decode(v):
                yield frame.to_ndarray(format="rgb24")

        out, out_fps = _collect(
            raw(), native_fps, force_fps, skip_first,
            max_frames, custom_w, custom_h,
        )
    finally:
        container.close()

    if out:
        height, width = out[0].shape[0], out[0].shape[1]
    else:
        width, height = cw, ch
    return out, out_fps, width, height


def _decode_imageio(path, force_fps, skip_first, max_frames, custom_w, custom_h):
    reader = imageio.get_reader(path, "ffmpeg")
    try:
        meta = reader.get_meta_data() or {}
        native_fps = float(meta.get("fps") or 0.0)
        if not (native_fps > 0):
            native_fps = 30.0
        size = meta.get("size") or (0, 0)
        cw, ch = int(size[0]), int(size[1])

        def raw():
            for fr in reader:
                a = np.asarray(fr)
                if a.ndim == 2:  # grayscale -> RGB
                    a = np.stack([a, a, a], axis=-1)
                elif a.shape[-1] == 1:  # single channel with axis
                    a = np.repeat(a, 3, axis=-1)
                elif a.shape[-1] == 2:  # gray + alpha -> replicate gray
                    a = np.repeat(a[..., :1], 3, axis=-1)
                yield a[..., :3]

        out, out_fps = _collect(
            raw(), native_fps, force_fps, skip_first,
            max_frames, custom_w, custom_h,
        )
    finally:
        reader.close()

    if out:
        height, width = out[0].shape[0], out[0].shape[1]
    else:
        width, height = cw, ch
    return out, out_fps, width, height


# ── Public API ───────────────────────────────────────────────────────────────

def decode(path, *, max_frames=0, force_fps=0.0, skip_first=0,
           custom_w=0, custom_h=0) -> dict:
    """Decode a video file to a frame batch + metadata.

    Returns {frames: IMAGE tensor [N,H,W,3] float32, fps, width, height,
    duration, frame_count}. Raises a clear error when no backend is available
    or no frames could be read.
    """
    _need_backend()
    skip_first = max(0, int(skip_first))
    max_frames = max(0, int(max_frames))
    force_fps = float(force_fps) if force_fps and force_fps > 0 else 0.0

    if _AV_OK:
        try:
            out, out_fps, width, height = _decode_av(
                path, force_fps, skip_first, max_frames, custom_w, custom_h,
            )
        except Exception as e:
            if _IMAGEIO_OK:
                print(f"[Pixaroma] Load Video — PyAV could not read this file "
                      f"({e}); falling back to imageio.")
                out, out_fps, width, height = _decode_imageio(
                    path, force_fps, skip_first, max_frames, custom_w, custom_h,
                )
            else:
                raise
    else:
        out, out_fps, width, height = _decode_imageio(
            path, force_fps, skip_first, max_frames, custom_w, custom_h,
        )

    if not out:
        if skip_first > 0:
            raise ValueError(
                f"[Pixaroma] Load Video — Skip first frames ({skip_first}) "
                f"removed every loaded frame of {os.path.basename(path)}. Lower "
                f"it, or raise Max frames, and try again."
            )
        raise ValueError(
            f"[Pixaroma] Load Video — no frames could be read from "
            f"{os.path.basename(path)}. The file may be corrupt or in an "
            f"unsupported format."
        )

    # Build the float32 IMAGE batch with the SMALLEST peak memory: stack to
    # uint8, release the per-frame list, then convert + scale IN PLACE. The old
    # `.astype(float32) / 255.0` allocated an EXTRA full-size temporary (a ~3GB
    # spike for a 120-frame 1080p clip) on top of the result, which on a busy
    # session can push into swap and make a fast load feel like a hang.
    frames_np = np.stack(out, axis=0)   # uint8 (N, H, W, 3)
    out = None                          # free the per-frame arrays before the float alloc
    frame_count = int(frames_np.shape[0])
    frames_np = frames_np.astype(np.float32)
    frames_np /= 255.0                  # in place - no second full-size copy
    duration = frame_count / out_fps if out_fps > 0 else 0.0
    tensor = torch.from_numpy(frames_np)
    return {
        "frames": tensor,
        "fps": float(out_fps),
        "width": int(width),
        "height": int(height),
        "duration": float(duration),
        "frame_count": frame_count,
    }


def extract_audio(path):
    """Pull the soundtrack as a ComfyUI AUDIO dict via an ffmpeg subprocess.
    Returns None when the file has no audio, ffmpeg is missing, or extraction
    fails (the node then outputs no audio rather than crashing)."""
    ffmpeg = resolve_ffmpeg()
    if not ffmpeg:
        return None

    temp_dir = None
    if folder_paths is not None:
        try:
            temp_dir = folder_paths.get_temp_directory()
        except Exception:
            temp_dir = None
    if not temp_dir:
        temp_dir = tempfile.gettempdir() or os.path.dirname(path) or "."
    try:
        os.makedirs(temp_dir, exist_ok=True)
    except OSError:
        pass

    wav_path = os.path.join(temp_dir, f"pixaroma_load_video_{uuid.uuid4().hex}.wav")
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-i", path, "-vn",
        "-acodec", "pcm_s16le",
        wav_path,
    ]
    try:
        try:
            proc = subprocess.run(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            print("[Pixaroma] Load Video — audio extraction timed out; "
                  "continuing without audio.")
            return None
        if (proc.returncode != 0 or not os.path.exists(wav_path)
                or os.path.getsize(wav_path) < 64):
            return None
        with wave.open(wav_path, "rb") as wf:
            n_ch = wf.getnchannels()
            sr = wf.getframerate()
            n = wf.getnframes()
            raw = wf.readframes(n)
        if n_ch <= 0 or sr <= 0 or not raw:
            return None
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        # Guard a truncated WAV whose length isn't a clean multiple of channels.
        usable = (data.shape[0] // n_ch) * n_ch
        if usable == 0:
            return None
        data = data[:usable].reshape(-1, n_ch).T  # (channels, samples)
        waveform = torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0)  # (1, C, S)
        return {"waveform": waveform, "sample_rate": int(sr)}
    except Exception as e:
        print(f"[Pixaroma] Load Video — audio extraction failed: {e}")
        return None
    finally:
        if os.path.exists(wav_path):
            try:
                os.remove(wav_path)
            except OSError:
                pass
