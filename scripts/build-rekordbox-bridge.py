from __future__ import annotations

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
        f"{BRIDGE}[build]",
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
