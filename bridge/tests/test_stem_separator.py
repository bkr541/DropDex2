from __future__ import annotations

import shutil
import struct
import wave
from pathlib import Path

import pytest

from rekordbox_bridge import stem_separator
from rekordbox_bridge.stem_separator import check_runtime_health, separate_to_pair, validate_pair


def write_test_wave(path: Path, *, frames: int = 4410, sample_rate: int = 44100, leading_silence: int = 441) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        payload = bytearray()
        for index in range(frames):
            sample = 0 if index < leading_silence else 1200
            payload.extend(struct.pack("<hh", sample, sample))
        handle.writeframes(bytes(payload))


def fake_separator(source: Path, work_dir: Path, _model_root: Path, _model_name: str) -> None:
    target = work_dir / "htdemucs" / source.stem
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target / "vocals.wav")
    shutil.copy2(source, target / "no_vocals.wav")


def first_stereo_sample(path: Path) -> tuple[int, int]:
    with wave.open(str(path), "rb") as handle:
        return struct.unpack("<hh", handle.readframes(1))


def test_separator_contract_preserves_timeline_zero_duration_and_leading_silence(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    write_test_wave(source)

    outputs = separate_to_pair(
        source,
        tmp_path / "stage",
        tmp_path / "models",
        "htdemucs",
        expected_duration_ms=100,
        runner=fake_separator,
    )

    vocals = tmp_path / "stage" / "pair" / "vocals.wav"
    instrumental = tmp_path / "stage" / "pair" / "instrumental.wav"
    assert outputs["vocals"]["durationMs"] == 100
    assert outputs["instrumental"]["durationMs"] == 100
    assert outputs["vocals"]["frameCount"] == outputs["instrumental"]["frameCount"] == 4410
    assert first_stereo_sample(vocals) == (0, 0)
    assert first_stereo_sample(instrumental) == (0, 0)


def test_pair_validation_rejects_mismatched_frame_counts(tmp_path: Path) -> None:
    vocals = tmp_path / "vocals.wav"
    instrumental = tmp_path / "instrumental.wav"
    write_test_wave(vocals, frames=4410)
    write_test_wave(instrumental, frames=4400)

    with pytest.raises(RuntimeError, match="frame counts do not match"):
        validate_pair(vocals, instrumental, expected_duration_ms=None)


def test_failed_separator_never_leaves_publishable_pair_directory(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    write_test_wave(source)

    def failing_separator(_source: Path, work_dir: Path, _model_root: Path, _model_name: str) -> None:
        work_dir.mkdir(parents=True, exist_ok=True)
        raise RuntimeError("model failure")

    with pytest.raises(RuntimeError, match="model failure"):
        separate_to_pair(
            source,
            tmp_path / "stage",
            tmp_path / "models",
            "htdemucs",
            expected_duration_ms=100,
            runner=failing_separator,
        )

    assert not (tmp_path / "stage" / "pair").exists()


def test_runtime_health_reports_missing_model_without_starting_heavy_separation(tmp_path: Path) -> None:
    result = check_runtime_health(tmp_path / "missing-model-root")
    assert result["ok"] is False
    assert result["reason"] == "model_missing"


def test_runtime_health_rejects_unrelated_checkpoint_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint_dir = tmp_path / "models" / "hub" / "checkpoints"
    checkpoint_dir.mkdir(parents=True)
    (checkpoint_dir / "unrelated-model.th").write_bytes(b"not-htdemucs")
    monkeypatch.setattr(stem_separator.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(stem_separator.subprocess, "run", lambda *_args, **_kwargs: type("Result", (), {"returncode": 0})())

    result = check_runtime_health(tmp_path / "models")
    assert result["ok"] is False
    assert result["reason"] == "model_missing"


def test_runtime_health_accepts_exact_htdemucs_checkpoint_contract(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint_dir = tmp_path / "models" / "hub" / "checkpoints"
    checkpoint_dir.mkdir(parents=True)
    expected = stem_separator._expected_model_checkpoints("htdemucs")
    assert expected
    for filename in expected:
        (checkpoint_dir / filename).write_bytes(b"present")
    monkeypatch.setattr(stem_separator.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(stem_separator.subprocess, "run", lambda *_args, **_kwargs: type("Result", (), {"returncode": 0})())

    result = check_runtime_health(tmp_path / "models")
    assert result["ok"] is True
    assert result["model"] == "htdemucs"
