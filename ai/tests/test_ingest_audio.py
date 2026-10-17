import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave

from ai.ingest.audio import MAX_CHUNK_SECONDS, AudioRejected, plan_chunks, prepare
from ai.providers import CapabilityUnavailable

FFMPEG = shutil.which(os.getenv("FFMPEG_BINARY", "ffmpeg"))


def synthesize(target: Path, parts: list[tuple[str, float]], codec: list[str]):
    """Synthetic tones and silences only: ("tone"|"silence"|"loud", seconds)."""
    inputs, labels = [], []
    for index, (kind, seconds) in enumerate(parts):
        source = {"tone": f"sine=frequency=220:sample_rate=44100:duration={seconds}",
                  "loud": f"sine=frequency=220:sample_rate=44100:duration={seconds}",
                  "silence": f"anullsrc=r=44100:cl=mono:d={seconds}"}[kind]
        inputs += ["-f", "lavfi", "-i", source]
        labels.append(f"[{index}]" + ("volume=40dB," if kind == "loud" else "") + f"aformat=channel_layouts=mono[a{index}]")
    graph = ";".join(labels) + ";" + "".join(f"[a{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1"
    subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", *inputs, "-filter_complex", graph, *codec, "-y", str(target)], check=True)


class ChunkPlanTests(unittest.TestCase):
    def test_packs_speech_and_cuts_inside_pauses(self):
        spans = plan_chunks(70.0, [(10.0, 11.0), (25.0, 26.0), (40.0, 41.0), (60.0, 61.0)])
        self.assertEqual(spans, [(0.0, 25.2, False), (25.8, 40.2, False), (40.8, 70.0, False)])

    def test_hard_cuts_only_when_no_pause_exists(self):
        spans = plan_chunks(65.0, [])
        self.assertEqual(spans, [(0.0, 29.5, True), (29.5, 59.0, True), (59.0, 65.0, False)])

    def test_every_span_is_under_the_limit_ordered_and_non_overlapping(self):
        pauses = [(float(second), second + 0.36) for second in range(7, 300, 13)]
        spans = plan_chunks(300.0, pauses)
        for start, end, _ in spans:
            self.assertLessEqual(end - start, MAX_CHUNK_SECONDS)
        for (_, end, _), (next_start, _, _) in zip(spans, spans[1:]):
            self.assertLessEqual(end, next_start)

    def test_leading_trailing_and_long_silences_are_not_sent(self):
        spans = plan_chunks(80.0, [(0.0, 2.0), (20.0, 50.0), (70.0, 80.0)])
        self.assertEqual(spans, [(1.8, 20.2, False), (49.8, 70.2, False)])
        self.assertEqual(plan_chunks(10.0, [(0.0, 10.0)]), [])


@unittest.skipUnless(FFMPEG, "ffmpeg is not installed")
class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_phone_and_voice_note_formats_become_16k_mono_chunks_with_original_time_anchors(self):
        parts = [("tone", 12), ("silence", 1), ("tone", 14), ("silence", 1), ("tone", 20), ("silence", 1), ("tone", 8)]
        for name, codec in (("pitch.m4a", ["-c:a", "aac"]), ("note.ogg", ["-c:a", "libopus"])):
            with self.subTest(name=name):
                source = self.dir / name
                synthesize(source, parts, codec)
                original = source.read_bytes()
                report = prepare(source, self.dir / f"work-{name}")
                self.assertEqual(source.read_bytes(), original)
                self.assertAlmostEqual(report.duration, 57.0, delta=0.2)
                self.assertGreaterEqual(len(report.chunks), 2)
                self.assertEqual(report.forced_cuts, 0)
                for chunk in report.chunks:
                    self.assertLess(chunk.end - chunk.start, 30.0)
                    with wave.open(chunk.path, "rb") as audio:
                        self.assertEqual((audio.getframerate(), audio.getnchannels(), audio.getsampwidth()), (16000, 1, 2))
                        self.assertAlmostEqual(audio.getnframes() / 16000, chunk.end - chunk.start, delta=0.01)
                # Cuts fall inside the synthetic pauses (12-13 s, 27-28 s, 48-49 s).
                for chunk in report.chunks[:-1]:
                    self.assertTrue(any(begin <= chunk.end <= end for begin, end in ((12, 13), (27, 28), (48, 49))), chunk)

    def test_unusable_recordings_are_rejected_with_a_reason(self):
        cases = {"near_silent": [("silence", 5)], "too_short": [("tone", 0.5)], "clipped": [("loud", 3)]}
        for reason, parts in cases.items():
            with self.subTest(reason=reason):
                source = self.dir / f"{reason}.wav"
                synthesize(source, parts, ["-c:a", "pcm_s16le"])
                with self.assertRaises(AudioRejected) as raised:
                    prepare(source, self.dir / f"work-{reason}")
                self.assertEqual(raised.exception.reason, reason)

    def test_unreadable_input_fails_without_echoing_paths(self):
        source = self.dir / "secret-name.m4a"
        source.write_bytes(b"not audio")
        with self.assertRaises(ValueError) as raised:
            prepare(source, self.dir / "work")
        self.assertNotIn("secret-name", str(raised.exception))

    def test_missing_ffmpeg_is_an_explicit_capability_gap(self):
        with patch.dict(os.environ, {"FFMPEG_BINARY": "definitely-not-installed-ffmpeg"}):
            with self.assertRaises(CapabilityUnavailable):
                prepare(self.dir / "any.m4a", self.dir / "work")


if __name__ == "__main__":
    unittest.main()
