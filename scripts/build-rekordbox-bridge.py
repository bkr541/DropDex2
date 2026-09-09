from __future__ import annotations

import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "bridge"
RUNTIME = BRIDGE / "runtime"
BUILD_VENV = BRIDGE / ".desktop-build-venv"
PYINSTALLER_WORK = BRIDGE / ".pyinstaller"

MODEL_CACHE = BRIDGE / ".desktop-stem-model-cache"
MODEL_RUNTIME = RUNTIME / "stem-models"


RUNTIME.mkdir(parents=True, exist_ok=True)
PYINSTALLER_WORK.mkdir(parents=True, exist_ok=True)
for item in RUNTIME.iterdir():
    if item.is_dir():
        shutil.rmtree(item)
    else:
        item.unlink()

if not BUILD_VENV.exists():
    venv.EnvBuilder(with_pip=True, clear=False).create(BUILD_VENV)

venv_python = BUILD_VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
subprocess.run(
    [
        str(venv_python),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--upgrade",
        f"{BRIDGE}[build,stem]",
    ],
    cwd=ROOT,
    check=True,
)

cmd = [
    str(venv_python),
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name",
    "dropdex-rekordbox-bridge",
    "--collect-all",
    "pyrekordbox",
    "--collect-all",
    "demucs",
    "--paths",
    str(BRIDGE),
    "--distpath",
    str(RUNTIME),
    "--workpath",
    str(PYINSTALLER_WORK),
    "--specpath",
    str(PYINSTALLER_WORK),
    str(BRIDGE / "rekordbox_bridge" / "desktop_service.py"),
]
subprocess.run(cmd, cwd=ROOT, check=True)

# Download the exact separator model at build time so packaged DropDex remains
# local/offline at runtime. The worker refuses network fallback when weights are
# absent, so a packaging failure here cannot silently become a user-audio upload.
model_env = dict(os.environ)
model_env["TORCH_HOME"] = str(MODEL_CACHE)
subprocess.run(
    [
        str(venv_python),
        "-c",
        "from demucs.pretrained import get_model; get_model('htdemucs')",
    ],
    cwd=ROOT,
    env=model_env,
    check=True,
)
checkpoint_source = MODEL_CACHE / "hub" / "checkpoints"
if not checkpoint_source.exists() or not any(checkpoint_source.glob("*.th")):
    raise RuntimeError("Demucs htdemucs weights were not cached during desktop bridge build")
MODEL_RUNTIME.mkdir(parents=True, exist_ok=True)
shutil.copytree(MODEL_CACHE / "hub", MODEL_RUNTIME / "hub", dirs_exist_ok=True)
