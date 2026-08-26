"""Stage 7 desktop protocol and packaging source-level locks."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from rekordbox_bridge import desktop_service
from rekordbox_bridge.desktop_service import _validate_scope

ROOT = Path(__file__).resolve().parents[2]


def test_desktop_service_keeps_stage6_operations_narrow():
    source = (ROOT / "bridge/rekordbox_bridge/desktop_service.py").read_text(encoding="utf-8")
    assert 'operation == "availability"' in source
    assert 'operation == "preflight"' in source
    assert 'operation == "apply"' in source
    assert "databasePath" not in source
    assert "db_path" not in source
    assert '_validate_scope(request.get("scope"), saved_rows)' in source
    assert "apply_saved_cue_drafts(token, saved_rows)" in source


def test_persistent_protocol_process_answers_availability():
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT / "bridge")
    process = subprocess.Popen(
        [sys.executable, "-m", "rekordbox_bridge.desktop_service"],
        cwd=ROOT / "bridge",
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdin is not None
        assert process.stdout is not None
        request = {
            "protocolVersion": 2,
            "requestId": "availability-1",
            "operation": "availability",
        }
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        line = process.stdout.readline().strip()
        assert line.startswith("DROPDEX_BRIDGE_RESULT:")
        payload = json.loads(line.split(":", 1)[1])
        assert payload["requestId"] == "availability-1"
        assert isinstance(payload["ok"], bool)
        if payload["ok"]:
            assert payload["result"]["available"] is True
        else:
            assert isinstance(payload["error"], str) and payload["error"]
    finally:
        process.terminate()
        process.wait(timeout=5)


def test_packaging_declares_bundled_runtime_and_no_packaged_python_fallback():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["dist"].count("build:bridge") == 1
    assert any(item["to"] == "rekordbox-bridge" for item in package["build"]["extraResources"])
    launcher = (ROOT / "electron/cueApplyBridge.cjs").read_text(encoding="utf-8")
    packaged_branch = launcher.split("if (isPackaged)", 1)[1].split("if (env.DROPDEX_REKORDBOX_BRIDGE_BINARY)", 1)[0]
    assert "python3" not in packaged_branch
    assert "DROPDEX_PYTHON" not in packaged_branch


def test_electron_main_exposes_only_three_cue_apply_channels():
    main = (ROOT / "electron/main.cjs").read_text(encoding="utf-8")
    preload = (ROOT / "electron/preload.cjs").read_text(encoding="utf-8")
    assert "dropdex:cue-apply-availability" in main
    assert "dropdex:cue-apply-preflight" in main
    assert "dropdex:cue-apply" in main
    assert "assertExactObject(payload, ['scope', 'savedDrafts']" in main
    assert "assertExactObject(payload, ['token', 'scope', 'savedDrafts']" in main
    assert "cueApplyPreflight" in preload
    assert "cueApply:" in preload


def test_desktop_protocol_enforces_track_vs_all_scope():
    row = {
        "importId": "import-1",
        "trackId": "track-1",
        "desiredDocument": {"importId": "import-1", "trackId": "track-1"},
    }
    _validate_scope({"kind": "track", "importId": "import-1", "trackId": "track-1"}, [row])
    _validate_scope({"kind": "all", "importId": "import-1"}, [row])
    with pytest.raises(ValueError, match="exactly one"):
        _validate_scope({"kind": "track", "importId": "import-1", "trackId": "track-1"}, [row, row])
    with pytest.raises(ValueError, match="track scope"):
        _validate_scope({"kind": "track", "importId": "import-1", "trackId": "other"}, [row])


def test_desktop_protocol_preflight_dispatch_preserves_explicit_track_scope(monkeypatch):
    row = {
        "importId": "import-1",
        "trackId": "track-1",
        "desiredDocument": {"importId": "import-1", "trackId": "track-1"},
    }
    captured = {}

    def fake_preflight(saved_rows):
        captured["rows"] = saved_rows
        return {"ok": True}

    monkeypatch.setattr(desktop_service, "preflight_saved_cue_drafts", fake_preflight)
    request = {
        "operation": "preflight",
        "scope": {"kind": "track", "importId": "import-1", "trackId": "track-1"},
        "savedDrafts": [row],
    }

    assert desktop_service._handle(request) == {"ok": True}
    assert captured["rows"] == [row]

    widened = dict(request)
    widened["savedDrafts"] = [row, row]
    with pytest.raises(ValueError, match="exactly one"):
        desktop_service._handle(widened)
