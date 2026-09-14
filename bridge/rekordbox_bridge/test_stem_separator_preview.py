from __future__ import annotations

import tempfile
import unittest
import wave
from pathlib import Path

from stem_separator import separate_to_pair


def write_silence(path: Path, duration_ms: int, sample_rate: int = 8000) -> None:
    frame_count = round(duration_ms * sample_rate / 1000)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)


class PreviewWindowSeparationTests(unittest.TestCase):
    def test_separates_only_requested_window_and_cleans_extracted_source(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dropdex-preview-worker-") as directory:
            root = Path(directory)
            source = root / "source.wav"
            output = root / "output"
            write_silence(source, 40_000)
            seen_sources: list[Path] = []

            def fake_runner(separation_source: Path, work_dir: Path, _model_root: Path, _model_name: str) -> None:
                seen_sources.append(separation_source)
                with wave.open(str(separation_source), "rb") as handle:
                    frames = handle.readframes(handle.getnframes())
                    channels = handle.getnchannels()
                    sample_width = handle.getsampwidth()
                    sample_rate = handle.getframerate()
                generated = work_dir / "htdemucs" / "preview-source"
                generated.mkdir(parents=True, exist_ok=True)
                for filename in ("vocals.wav", "no_vocals.wav"):
                    with wave.open(str(generated / filename), "wb") as handle:
                        handle.setnchannels(channels)
                        handle.setsampwidth(sample_width)
                        handle.setframerate(sample_rate)
                        handle.writeframes(frames)

            result = separate_to_pair(
                source=source,
                output_root=output,
                model_root=root / "models",
                model_name="htdemucs",
                expected_duration_ms=32_000,
                runner=fake_runner,
                window_start_ms=4_000,
                window_duration_ms=32_000,
            )

            self.assertEqual(result["vocals"]["durationMs"], 32_000)
            self.assertEqual(result["instrumental"]["durationMs"], 32_000)
            self.assertEqual(len(seen_sources), 1)
            self.assertEqual(seen_sources[0].name, "preview-source.wav")
            self.assertNotEqual(seen_sources[0], source)
            self.assertFalse((output / "preview-source.wav").exists())
            self.assertTrue((output / "pair" / "vocals.wav").is_file())
            self.assertTrue((output / "pair" / "instrumental.wav").is_file())


if __name__ == "__main__":
    unittest.main()
