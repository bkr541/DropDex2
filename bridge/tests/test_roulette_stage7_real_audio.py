from __future__ import annotations

import math
import os
import shutil
import struct
import wave
from pathlib import Path

import pytest

from rekordbox_bridge.stem_separator import check_runtime_health, inspect_wave, separate_to_pair


pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required by the Roulette runtime",
)


def write_generated_fixture(path: Path, *, seconds: float = 2.0, sample_rate: int = 44_100) -> None:
    """Create legal/local stereo PCM audio with silence + tones; no external fixture is required."""
    frame_count = int(seconds * sample_rate)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        payload = bytearray()
        for index in range(frame_count):
            t = index / sample_rate
            if t < 0.2:
                value = 0
            else:
                value = int(0.22 * 32767 * math.sin(2 * math.pi * 220 * t))
            payload.extend(struct.pack("<hh", value, value))
        handle.writeframes(bytes(payload))


def narrow_model_boundary(source: Path, work_dir: Path, _model_root: Path, _model_name: str) -> None:
    """Substitute only model inference; retain real extraction, validation, ffmpeg metrics and publishing."""
    target = work_dir / "htdemucs" / source.stem
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target / "vocals.wav")
    shutil.copy2(source, target / "no_vocals.wav")


def test_stage7_generated_audio_crosses_real_preview_decode_and_separator_boundary(tmp_path: Path) -> None:
    source = tmp_path / "generated-source.wav"
    write_generated_fixture(source)

    outputs = separate_to_pair(
        source,
        tmp_path / "preview-stage",
        tmp_path / "models",
        "htdemucs",
        expected_duration_ms=1000,
        runner=narrow_model_boundary,
        window_start_ms=500,
        window_duration_ms=1000,
    )

    for role in ("vocals", "instrumental"):
        asset = tmp_path / "preview-stage" / "pair" / f"{role}.wav"
        assert asset.read_bytes()[:4] == b"RIFF"
        metadata = inspect_wave(asset)
        assert 990 <= metadata.durationMs <= 1010
        assert metadata.sampleRateHz == 44_100
        assert metadata.channelCount == 2
        assert outputs[role]["metrics"]["usableNonSilentDurationMs"] > 0

    # The temporary extracted preview source and Demucs work tree must not leak.
    assert not (tmp_path / "preview-stage" / "preview-source.wav").exists()
    assert not (tmp_path / "preview-stage" / "demucs-work").exists()


def test_stage7_real_demucs_harness_runs_when_runtime_and_model_are_provisioned(tmp_path: Path) -> None:
    model_root = Path(
        os.environ.get(
            "DROPDEX_STEM_MODEL_ROOT",
            Path(__file__).resolve().parents[2] / "bridge" / "runtime" / "stem-models",
        )
    )
    health = check_runtime_health(model_root)
    if health.get("ok") is not True:
        pytest.skip(
            "Full Demucs integration unavailable in this environment: "
            f"{health.get('reason')}: {health.get('message')}"
        )

    source = tmp_path / "generated-demucs-source.wav"
    write_generated_fixture(source, seconds=1.0)
    outputs = separate_to_pair(
        source,
        tmp_path / "demucs-stage",
        model_root,
        "htdemucs",
        expected_duration_ms=1000,
    )

    for role in ("vocals", "instrumental"):
        asset = tmp_path / "demucs-stage" / "pair" / f"{role}.wav"
        metadata = inspect_wave(asset)
        assert asset.is_file()
        assert metadata.durationMs >= 900
        assert outputs[role]["metrics"] is not None
