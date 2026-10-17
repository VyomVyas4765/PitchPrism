import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from ai.ingest.classify import detect_format

FFMPEG = shutil.which(os.getenv("FFMPEG_BINARY", "ffmpeg"))


class DetectFormatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name: str, content: bytes) -> Path:
        path = self.dir / name
        path.write_bytes(content)
        return path

    def test_signatures_decide_and_extensions_are_ignored(self):
        cases = {
            ("plan.mp3", b"%PDF-1.7\n%synthetic"): "pdf",
            ("photo.pdf", b"\x89PNG\r\n\x1a\n" + b"\x00" * 16): "image",
            ("scan.txt", b"\xff\xd8\xff\xe0" + b"\x00" * 16): "image",
            ("form.jpg", b"RIFF\x00\x00\x00\x00WEBPVP8 "): "image",
            ("phone.heic", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8): "image",
            ("intake.pdf", b"PK\x03\x04" + b"\x00" * 16): "archive",
            ("answer.bin", "मेरा व्यवसाय पापड़ बनाना है।".encode()): "text",
            ("random.pdf", b"\x00\x01\x02\x03binary"): "unknown",
            ("empty.txt", b""): "unknown",
        }
        for (name, content), kind in cases.items():
            with self.subTest(name=name):
                self.assertEqual(detect_format(self.write(name, content))["kind"], kind)

    def test_text_cut_inside_a_multibyte_character_is_still_text(self):
        content = ("అ" * 3000).encode()  # 3 bytes each; 8 KiB boundary falls inside a character
        self.assertEqual(detect_format(self.write("long.txt", content))["kind"], "text")

    @unittest.skipUnless(FFMPEG, "ffmpeg is not installed")
    def test_media_containers_need_an_audio_stream(self):
        audio = self.dir / "pitch.m4a"
        subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", "-y", str(audio)], check=True)
        silent_video = self.dir / "clip.mp4"
        subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=32x32:duration=1", "-c:v", "mpeg4", "-y", str(silent_video)], check=True)
        result = detect_format(audio)
        self.assertEqual((result["kind"], result["container"], result["has_video"]), ("audio", "mp4", False))
        self.assertEqual(detect_format(silent_video), {"kind": "unknown", "container": "mp4", "reason": "no_audio_stream", "checks": ["signature", "ffprobe"]})
        self.assertEqual(detect_format(self.write("fake.ogg", b"OggS" + b"\x00" * 32))["kind"], "unknown")


if __name__ == "__main__":
    unittest.main()
