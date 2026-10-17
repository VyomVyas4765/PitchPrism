"""A-02 (first part): detect a document's format from its content, never from its name or declared type.

Covered: audio / pdf / image / text / archive / unknown. Still pending in A-02: digital-versus-scanned
per page and script per page (need a PDF layout library; licence choice open) and template
fingerprints (need the organiser templates on the worker host). Results say which checks ran.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess

from ai.providers import CapabilityUnavailable

IMAGE_BRANDS = {b"heic", b"heix", b"hevc", b"mif1", b"msf1", b"avif"}


def _probe_streams(path: Path) -> list[dict]:
    configured = os.getenv("FFPROBE_BINARY") or str(Path(os.getenv("FFMPEG_BINARY", "ffmpeg")).with_name("ffprobe"))
    binary = shutil.which(configured) or shutil.which("ffprobe")
    if not binary:
        raise CapabilityUnavailable("ffprobe is not installed on the worker; media containers cannot be classified.")
    result = subprocess.run([binary, "-v", "error", "-protocol_whitelist", "file", "-show_entries",
                             "stream=codec_type:stream_disposition=attached_pic", "-of", "json", str(path)],
                            capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        return []
    return json.loads(result.stdout or "{}").get("streams", [])


def _media(path: Path, container: str) -> dict:
    streams = _probe_streams(path)
    audio = any(stream.get("codec_type") == "audio" for stream in streams)
    video = any(stream.get("codec_type") == "video" and not stream.get("disposition", {}).get("attached_pic") for stream in streams)
    if audio:
        # A phone recording in .mp4 may carry a video track; only the audio is read.
        return {"kind": "audio", "container": container, "has_video": video}
    return {"kind": "unknown", "container": container, "reason": "no_audio_stream"}


def detect_format(path: Path) -> dict:
    with open(path, "rb") as handle:
        head = handle.read(8192)
    checks = ["signature"]
    if head.startswith(b"%PDF-"):
        return {"kind": "pdf", "container": "pdf", "page_kinds": "pending", "checks": checks}
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return {"kind": "image", "container": "png", "checks": checks}
    if head.startswith(b"\xff\xd8\xff"):
        return {"kind": "image", "container": "jpeg", "checks": checks}
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return {"kind": "image", "container": "webp", "checks": checks}
    if head.startswith(b"PK\x03\x04"):
        # Intake ZIPs are unpacked by bulk import (W-19); office documents are not a listed format.
        return {"kind": "archive", "container": "zip", "checks": checks}
    media = None
    if head[4:8] == b"ftyp":
        if head[8:12] in IMAGE_BRANDS:
            return {"kind": "image", "container": "heif", "checks": checks}
        media = "3gp" if head[8:11] in (b"3gp", b"3g2") else "mp4"
    elif head.startswith(b"OggS"):
        media = "ogg"
    elif head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        media = "wav"
    elif head.startswith(b"\x1a\x45\xdf\xa3"):
        media = "matroska"
    elif head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        media = "mp3"
    if media:
        return {**_media(path, media), "checks": [*checks, "ffprobe"]}
    if head and b"\x00" not in head:
        try:
            head.decode("utf-8")
            return {"kind": "text", "container": "utf-8", "checks": checks}
        except UnicodeDecodeError as error:
            # A multi-byte character may be cut at the 8 KiB boundary.
            if error.start >= len(head) - 3:
                return {"kind": "text", "container": "utf-8", "checks": checks}
    return {"kind": "unknown", "container": None, "reason": "unrecognised_signature", "checks": checks}
