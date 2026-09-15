"""Offline, timeline-preserving Roulette two-stem separation worker.

The Electron main process resolves the source through DropDex's USB security
boundary and gives this worker only that already-authorized absolute path plus a
DropDex-managed staging directory. Runtime output is always WAV and is never
published directly from this process.
"""
from __future__ import annotations

import argparse
from array import array
import json
import math
import os
import shutil
import subprocess
import sys
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

RESULT_PREFIX = "DROPDEX_STEM_RESULT:"
HEALTH_RESULT_PREFIX = "DROPDEX_STEM_HEALTH:"
TIMELINE_TOLERANCE_MS = 500
METRICS_VERSION = "roulette-stem-metrics-v1"
METRICS_SAMPLE_RATE_HZ = 8_000
METRICS_BIN_MS = 1_000
METRICS_ACTIVITY_BLOCK_MS = 100
SIGNAL_AMPLITUDE_THRESHOLD = 0.01
NON_SILENT_RMS_THRESHOLD = 0.006


@dataclass(frozen=True)
class WaveMetadata:
    durationMs: int
    sampleRateHz: int
    channelCount: int
    frameCount: int


def _ffprobe_wave_metadata(path: Path) -> WaveMetadata:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels,duration,duration_ts,time_base:format=duration",
        "-of",
        "json",
        str(path),
    ]
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()[-400:]
        raise RuntimeError(f"separator WAV metadata probe failed: {detail or 'ffprobe exited unexpectedly'}")
    try:
        payload = json.loads(completed.stdout.decode("utf-8"))
        stream = payload["streams"][0]
        sample_rate = int(stream["sample_rate"])
        channels = int(stream["channels"])
        duration_seconds: float | None = None
        duration_ts = stream.get("duration_ts")
        time_base = stream.get("time_base")
        if duration_ts is not None and isinstance(time_base, str) and "/" in time_base:
            numerator, denominator = time_base.split("/", 1)
            if float(denominator) != 0:
                duration_seconds = float(duration_ts) * float(numerator) / float(denominator)
        if duration_seconds is None and stream.get("duration") not in (None, "N/A"):
            duration_seconds = float(stream["duration"])
        if duration_seconds is None and payload.get("format", {}).get("duration") not in (None, "N/A"):
            duration_seconds = float(payload["format"]["duration"])
        if duration_seconds is None:
            raise ValueError("duration is unavailable")
        frames = round(duration_seconds * sample_rate)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise RuntimeError(f"separator WAV metadata probe returned invalid data: {exc}") from exc
    if sample_rate <= 0 or channels <= 0 or frames <= 0:
        raise RuntimeError("separator produced invalid WAV metadata")
    return WaveMetadata(
        durationMs=round(frames * 1000 / sample_rate),
        sampleRateHz=sample_rate,
        channelCount=channels,
        frameCount=frames,
    )


def inspect_wave(path: Path) -> WaveMetadata:
    try:
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
    except (wave.Error, EOFError):
        # Demucs is intentionally invoked with --float32. Some Python runtimes
        # cannot parse every IEEE-float/extensible WAV header, while ffprobe is
        # already a required Roulette runtime dependency and handles them safely.
        return _ffprobe_wave_metadata(path)


def _unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _decode_mono_pcm16(path: Path) -> tuple[array, int]:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        str(METRICS_SAMPLE_RATE_HZ),
        "-f",
        "s16le",
        "pipe:1",
    ]
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()[-400:]
        raise RuntimeError(f"stem metric decode failed: {detail or 'ffmpeg exited unexpectedly'}")
    samples = array("h")
    samples.frombytes(completed.stdout)
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        raise RuntimeError("stem metric decode returned no audio samples")
    return samples, METRICS_SAMPLE_RATE_HZ


def _rms(samples: array, start: int, end: int) -> float:
    if end <= start:
        return 0.0
    scale = 32768.0
    total = 0.0
    for value in samples[start:end]:
        normalized = value / scale
        total += normalized * normalized
    return math.sqrt(total / (end - start))


def _signal_ratio(samples: array, start: int, end: int) -> float:
    if end <= start:
        return 0.0
    threshold = int(round(SIGNAL_AMPLITUDE_THRESHOLD * 32767))
    active = sum(1 for value in samples[start:end] if abs(value) >= threshold)
    return active / (end - start)


def _energy_stability(values: list[float]) -> float:
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    if mean <= 0.00001:
        return 0.0
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return _unit(1.0 - (math.sqrt(variance) / mean))


def calculate_audio_metrics(samples: array, sample_rate_hz: int, role: str) -> dict[str, object]:
    if sample_rate_hz <= 0 or not samples:
        raise RuntimeError("stem metric input is empty")
    duration_ms = round(len(samples) * 1000 / sample_rate_hz)
    overall_rms = _rms(samples, 0, len(samples))
    overall_signal_ratio = _signal_ratio(samples, 0, len(samples))

    block_frames = max(1, round(sample_rate_hz * METRICS_ACTIVITY_BLOCK_MS / 1000))
    usable_ms = 0.0
    for start in range(0, len(samples), block_frames):
        end = min(len(samples), start + block_frames)
        if _rms(samples, start, end) >= NON_SILENT_RMS_THRESHOLD:
            usable_ms += (end - start) * 1000 / sample_rate_hz

    bin_frames = max(1, round(sample_rate_hz * METRICS_BIN_MS / 1000))
    bins: list[dict[str, object]] = []
    bin_rms_values: list[float] = []
    for start in range(0, len(samples), bin_frames):
        end = min(len(samples), start + bin_frames)
        rms = _rms(samples, start, end)
        signal_ratio = _signal_ratio(samples, start, end)
        block_start_ms = round(start * 1000 / sample_rate_hz)
        block_end_ms = round(end * 1000 / sample_rate_hz)
        non_silent_ratio = _unit(rms / max(NON_SILENT_RMS_THRESHOLD * 3.0, 0.00001))
        bins.append({
            "startMs": block_start_ms,
            "endMs": block_end_ms,
            "rms": round(_unit(rms), 6),
            "signalRatio": round(_unit(signal_ratio), 6),
            "nonSilentRatio": round(non_silent_ratio, 6),
        })
        bin_rms_values.append(rms)

    usable_ratio = _unit(usable_ms / max(duration_ms, 1))
    energy_evidence = _unit(overall_rms / 0.08)
    activity_evidence = _unit((overall_signal_ratio * 0.55) + (energy_evidence * 0.45))
    energy_stability = _energy_stability(bin_rms_values)
    if role == "vocal":
        suitability = _unit((0.40 * usable_ratio) + (0.35 * overall_signal_ratio) + (0.25 * activity_evidence))
    else:
        suitability = _unit((0.35 * usable_ratio) + (0.25 * overall_signal_ratio) + (0.20 * energy_evidence) + (0.20 * energy_stability))

    return {
        "version": METRICS_VERSION,
        "durationMs": duration_ms,
        "rms": round(_unit(overall_rms), 6),
        "signalRatio": round(_unit(overall_signal_ratio), 6),
        "usableNonSilentDurationMs": round(usable_ms),
        "activityEvidence": round(activity_evidence, 6),
        "energyStability": round(energy_stability, 6),
        "suitabilityScore": round(suitability, 6),
        "bins": bins,
    }


def analyze_wave(path: Path, role: str) -> dict[str, object]:
    samples, sample_rate_hz = _decode_mono_pcm16(path)
    return calculate_audio_metrics(samples, sample_rate_hz, role)


def validate_pair(
    vocals_path: Path,
    instrumental_path: Path,
    expected_duration_ms: int | None,
) -> dict[str, dict[str, object]]:
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
        "vocals": {**asdict(vocals), "metrics": analyze_wave(vocals_path, "vocal")},
        "instrumental": {**asdict(instrumental), "metrics": analyze_wave(instrumental_path, "instrumental")},
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


def _expected_model_checkpoints(model_name: str) -> list[str]:
    import yaml
    from demucs.pretrained import REMOTE_ROOT

    model_manifest = REMOTE_ROOT / f"{model_name}.yaml"
    if not model_manifest.is_file():
        raise RuntimeError(f"Demucs model manifest is unavailable for {model_name}.")
    manifest = yaml.safe_load(model_manifest.read_text(encoding="utf-8")) or {}
    signatures = manifest.get("models")
    if not isinstance(signatures, list) or not signatures or not all(isinstance(value, str) for value in signatures):
        raise RuntimeError(f"Demucs model manifest is invalid for {model_name}.")

    filename_by_signature: dict[str, str] = {}
    for raw_line in (REMOTE_ROOT / "files.txt").read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("root:"):
            continue
        filename_by_signature[line.split("-", 1)[0]] = line

    expected = [filename_by_signature.get(signature) for signature in signatures]
    if any(filename is None for filename in expected):
        raise RuntimeError(f"Demucs checkpoint manifest is incomplete for {model_name}.")
    return [filename for filename in expected if filename is not None]


def check_runtime_health(model_root: Path) -> dict[str, object]:
    try:
        from demucs.separate import main as _demucs_main  # noqa: F401
        expected_checkpoints = _expected_model_checkpoints("htdemucs")
    except (ImportError, ModuleNotFoundError) as exc:
        return {
            "ok": False,
            "reason": "dependency_unavailable",
            "message": f"Demucs runtime could not be imported: {exc}",
        }
    except Exception as exc:  # noqa: BLE001 - malformed packaged dependency is unexpected
        return {
            "ok": False,
            "reason": "unexpected_failure",
            "message": f"Demucs runtime metadata could not be inspected: {exc}",
        }

    checkpoint_dir = model_root.resolve() / "hub" / "checkpoints"
    missing_checkpoints = [
        filename
        for filename in expected_checkpoints
        if not (checkpoint_dir / filename).is_file() or (checkpoint_dir / filename).stat().st_size <= 0
    ]
    if missing_checkpoints:
        return {
            "ok": False,
            "reason": "model_missing",
            "message": "Demucs htdemucs model weights are not provisioned.",
        }

    missing_decoder = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    if missing_decoder:
        return {
            "ok": False,
            "reason": "decoder_unavailable",
            "message": f"Required audio decoder tool is unavailable: {', '.join(missing_decoder)}",
        }

    for command in (
        ["ffmpeg", "-version"],
        ["ffprobe", "-version"],
    ):
        try:
            completed = subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=5,
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "reason": "decoder_unavailable",
                "message": f"Audio decoder probe failed: {exc}",
            }
        if completed.returncode != 0:
            return {
                "ok": False,
                "reason": "decoder_unavailable",
                "message": f"Audio decoder probe failed for {command[0]}.",
            }

    return {
        "ok": True,
        "reason": None,
        "message": None,
        "model": "htdemucs",
    }


def _health_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dropdex-roulette-stem-health")
    parser.add_argument("--model-root", required=True)
    return parser


def health_main(argv: list[str] | None = None) -> int:
    args = _health_parser().parse_args(argv)
    try:
        payload = check_runtime_health(Path(args.model_root))
    except Exception as exc:  # noqa: BLE001 - health contract must be deterministic
        payload = {"ok": False, "reason": "unexpected_failure", "message": str(exc)}
    print(HEALTH_RESULT_PREFIX + json.dumps(payload, separators=(",", ":")), flush=True)
    return 0 if payload.get("ok") is True else 1


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


def extract_audio_window(
    source: Path,
    target: Path,
    start_ms: int,
    duration_ms: int,
) -> None:
    if start_ms < 0 or duration_ms <= 0:
        raise RuntimeError("preview window is invalid")
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_ms / 1000:.6f}",
        "-i",
        str(source),
        "-t",
        f"{duration_ms / 1000:.6f}",
        "-vn",
        "-map",
        "0:a:0",
        "-c:a",
        "pcm_s16le",
        str(target),
    ]
    completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=False)
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()[-400:]
        raise RuntimeError(f"preview window extraction failed: {detail or 'ffmpeg exited unexpectedly'}")
    metadata = inspect_wave(target)
    if abs(metadata.durationMs - duration_ms) > TIMELINE_TOLERANCE_MS:
        raise RuntimeError("preview window extraction did not preserve the requested duration")


def separate_to_pair(
    source: Path,
    output_root: Path,
    model_root: Path,
    model_name: str,
    expected_duration_ms: int | None,
    runner: Callable[[Path, Path, Path, str], None] = run_demucs,
    window_start_ms: int | None = None,
    window_duration_ms: int | None = None,
    extractor: Callable[[Path, Path, int, int], None] = extract_audio_window,
) -> dict[str, dict[str, object]]:
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

    clip_path = output_root / "preview-source.wav"
    separation_source = source
    try:
        if window_start_ms is not None or window_duration_ms is not None:
            if window_start_ms is None or window_duration_ms is None:
                raise RuntimeError("preview window start and duration must be provided together")
            extractor(source, clip_path, window_start_ms, window_duration_ms)
            separation_source = clip_path
        runner(separation_source, work_dir, model_root, model_name)
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
        try:
            clip_path.unlink(missing_ok=True)
        except OSError:
            pass


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dropdex-roulette-stem-separator")
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--expected-duration-ms", type=int, default=None)
    parser.add_argument("--window-start-ms", type=int, default=None)
    parser.add_argument("--window-duration-ms", type=int, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--health-check":
        return health_main(argv[1:])
    args = _parser().parse_args(argv)
    try:
        outputs = separate_to_pair(
            Path(args.source),
            Path(args.output),
            Path(args.model_root),
            args.model,
            args.expected_duration_ms,
            window_start_ms=args.window_start_ms,
            window_duration_ms=args.window_duration_ms,
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
