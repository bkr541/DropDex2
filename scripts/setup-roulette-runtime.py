from __future__ import annotations

import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "bridge"
RUNTIME_VENV = BRIDGE / ".roulette-runtime-venv"
MODEL_ROOT = Path(os.environ.get("DROPDEX_STEM_MODEL_ROOT", BRIDGE / "runtime" / "stem-models")).resolve()


def runtime_python() -> Path:
    return RUNTIME_VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def main() -> int:
    if not runtime_python().exists():
        print(f"Creating Roulette runtime environment at {RUNTIME_VENV}")
        venv.EnvBuilder(with_pip=True, clear=False).create(RUNTIME_VENV)

    python = runtime_python()
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--upgrade",
            f"{BRIDGE}[stem]",
        ],
        cwd=ROOT,
        check=True,
    )

    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    model_env = dict(os.environ)
    model_env["TORCH_HOME"] = str(MODEL_ROOT)
    subprocess.run(
        [
            str(python),
            "-c",
            "from demucs.pretrained import get_model; get_model('htdemucs')",
        ],
        cwd=ROOT,
        env=model_env,
        check=True,
    )

    checkpoint_dir = MODEL_ROOT / "hub" / "checkpoints"
    if not checkpoint_dir.exists() or not any(checkpoint_dir.glob("*.th")):
        raise RuntimeError("Demucs htdemucs weights were not provisioned")

    subprocess.run(
        [
            str(python),
            "-m",
            "rekordbox_bridge.stem_separator",
            "--health-check",
            "--model-root",
            str(MODEL_ROOT),
        ],
        cwd=BRIDGE,
        env=model_env,
        check=True,
    )
    print("Roulette runtime is provisioned and passed its dependency/model/decoder health check.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
