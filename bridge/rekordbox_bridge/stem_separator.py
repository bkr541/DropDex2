"""Offline, timeline-preserving Roulette two-stem separation worker.

The Electron main process resolves the source through DropDex's USB security
boundary and gives this worker only that already-authorized absolute path plus a
DropDex-managed staging directory. Runtime output is always WAV and is never
published directly from this process.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

RESULT_PREFIX = "DROPDEX_STEM_RESULT:"
TIMELINE_TOLERANCE_MS = 500


@dataclass(frozen=True)
class WaveMetadata:
    durationMs: int
    sampleRateHz: int
    channelCount: int
    frameCount: int


def inspect_wave(path: Path) -> WaveMetadata:
    with wave.open(str(path), "rb") as handle:
        sample_rate = handle.getframerate()
        channels = handle.getnchannels()
        frames = handle.getnframes()
    if sample_rate <= 0 or channels <= 0 or frames <= 0:
        raise RuntimeError("separator produced invalid WAV metadata")
    return WaveMetadata(
        durationMs=round(frames * 1000 / sample_rate),
        sampleRateHz=sample_rate,
        channelCount=channels,
        frameCount=frames,
    )


def validate_pair(
    vocals_path: Path,
    instrumental_path: Path,
    expected_duration_ms: int | None,
) -> dict[str, dict[str, int]]:
    vocals = inspect_wave(vocals_path)
    instrumental = inspect_wave(instrumental_path)
    if vocals.sampleRateHz != instrumental.sampleRateHz:
        raise RuntimeError("generated stem sample rates do not match")
    if vocals.channelCount != instrumental.channelCount:
        raise RuntimeError("generated stem channel counts do not match")
    if vocals.frameCount != instrumental.frameCount:
        raise RuntimeError("generated stem frame counts do not match")
    if expected_duration_ms is not None:
        if abs(vocals.durationMs - expected_duration_ms) > TIMELINE_TOLERANCE_MS:
            raise RuntimeError(
                "generated stems do not preserve the parent timeline duration "
                f"within {TIMELINE_TOLERANCE_MS} ms"
            )
    return {
        "vocals": asdict(vocals),
        "instrumental": asdict(instrumental),
    }


def _find_single(root: Path, filename: str) -> Path:
    matches = [item for item in root.rglob(filename) if item.is_file()]
    if len(matches) != 1:
        raise RuntimeError(f"separator produced {len(matches)} {filename} outputs; expected exactly one")
    return matches[0]


def _disable_model_downloads() -> Callable[[], None]:
    import torch.hub

    original = torch.hub.download_url_to_file

    def offline_download(*_args, **_kwargs):
        raise RuntimeError(
            "required Demucs model weights are not bundled in this DropDex install; "
            "rebuild or reinstall the desktop stem runtime"
        )

    torch.hub.download_url_to_file = offline_download

    def restore() -> None:
        torch.hub.download_url_to_file = original

    return restore


def run_demucs(source: Path, work_dir: Path, model_root: Path, model_name: str) -> None:
    checkpoint_dir = model_root / "hub" / "checkpoints"
    if not checkpoint_dir.is_dir() or not any(checkpoint_dir.glob("*.th")):
        raise RuntimeError("bundled Demucs model weights are unavailable")

    os.environ["TORCH_HOME"] = str(model_root)
    restore_download = _disable_model_downloads()
    try:
        from demucs.separate import main as demucs_main

        work_dir.mkdir(parents=True, exist_ok=True)
        demucs_main(
            [
                "--two-stems",
                "vocals",
                "--name",
                model_name,
                "--out",
                str(work_dir),
                "--float32",
                str(source),
            ]
        )
    finally:
        restore_download()


def separate_to_pair(
    source: Path,
    output_root: Path,
    model_root: Path,
    model_name: str,
    expected_duration_ms: int | None,
    runner: Callable[[Path, Path, Path, str], None] = run_demucs,
) -> dict[str, dict[str, int]]:
    source = source.resolve(strict=True)
    if not source.is_file():
        raise RuntimeError("source audio is not a file")
    output_root = output_root.resolve()
    model_root = model_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    work_dir = output_root / "demucs-work"
    pair_dir = output_root / "pair"
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(pair_dir, ignore_errors=True)

    try:
        runner(source, work_dir, model_root, model_name)
        vocals_generated = _find_single(work_dir, "vocals.wav")
        instrumental_generated = _find_single(work_dir, "no_vocals.wav")
        pair_dir.mkdir(parents=True, exist_ok=False)
        shutil.copy2(vocals_generated, pair_dir / "vocals.wav")
        shutil.copy2(instrumental_generated, pair_dir / "instrumental.wav")
        return validate_pair(
            pair_dir / "vocals.wav",
            pair_dir / "instrumental.wav",
            expected_duration_ms,
        )
    except Exception:
        shutil.rmtree(pair_dir, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dropdex-roulette-stem-separator")
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--expected-duration-ms", type=int, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        outputs = separate_to_pair(
            Path(args.source),
            Path(args.output),
            Path(args.model_root),
            args.model,
            args.expected_duration_ms,
        )
        payload = {"ok": True, "outputs": outputs}
        print(RESULT_PREFIX + json.dumps(payload, separators=(",", ":")), flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001 - one-shot worker must return a closed error contract
        payload = {"ok": False, "error": str(exc)}
        print(RESULT_PREFIX + json.dumps(payload, separators=(",", ":")), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
