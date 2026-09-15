from __future__ import annotations

import math
import shutil
import struct
import subprocess
import wave
from pathlib import Path

import pytest

from rekordbox_bridge.stem_separator import analyze_wave, inspect_wave


pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required by the Roulette runtime")


def write_fixture(path: Path, *, seconds: float, active_ranges: list[tuple[float, float]]) -> None:
    sample_rate = 8_000
    frames = int(seconds * sample_rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        payload = bytearray()
        for index in range(frames):
            time_seconds = index / sample_rate
            active = any(start <= time_seconds < end for start, end in active_ranges)
            value = int(0.25 * 32767 * math.sin(2 * math.pi * 220 * time_seconds)) if active else 0
            payload.extend(struct.pack("<h", value))
        handle.writeframes(bytes(payload))


def test_metrics_distinguish_silence_from_real_decoded_signal(tmp_path: Path) -> None:
    silent = tmp_path / "silent.wav"
    active = tmp_path / "active.wav"
    write_fixture(silent, seconds=2.0, active_ranges=[])
    write_fixture(active, seconds=2.0, active_ranges=[(0.0, 2.0)])

    silent_metrics = analyze_wave(silent, "vocal")
    active_metrics = analyze_wave(active, "vocal")

    assert silent_metrics["signalRatio"] == 0
    assert silent_metrics["usableNonSilentDurationMs"] == 0
    assert active_metrics["signalRatio"] > 0.8
    assert active_metrics["usableNonSilentDurationMs"] >= 1900
    assert active_metrics["suitabilityScore"] > silent_metrics["suitabilityScore"]
    assert len(active_metrics["bins"]) == 2


def test_metrics_capture_partial_activity_without_rejecting_it(tmp_path: Path) -> None:
    fixture = tmp_path / "partial.wav"
    write_fixture(fixture, seconds=4.0, active_ranges=[(1.0, 3.0)])

    metrics = analyze_wave(fixture, "vocal")

    assert 0 < metrics["signalRatio"] < 1
    assert 1800 <= metrics["usableNonSilentDurationMs"] <= 2200
    assert 0 < metrics["suitabilityScore"] < 1


def test_float_wave_metadata_uses_runtime_probe_when_python_wave_cannot_parse_header(tmp_path: Path) -> None:
    fixture = tmp_path / "float.wav"
    completed = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:a", "pcm_f32le", str(fixture),
    ], check=False)
    assert completed.returncode == 0

    metadata = inspect_wave(fixture)

    assert metadata.sampleRateHz == 48000
    assert metadata.channelCount == 1
    assert 990 <= metadata.durationMs <= 1010
