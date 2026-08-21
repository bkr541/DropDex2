"""Narrow JSON-lines desktop protocol for Stage 7 cue apply.

This process owns the Stage 6 token store for its lifetime. It never accepts a
filesystem path, SQL, shell command, or arbitrary operation name from React.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from typing import Any, Mapping

from rekordbox_bridge.apply_service import apply_saved_cue_drafts, preflight_saved_cue_drafts

PROTOCOL_VERSION = 1
RESULT_PREFIX = "DROPDEX_BRIDGE_RESULT:"
MAX_REQUEST_BYTES = 2_000_000


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {key: _jsonable(item) for key, item in asdict(value).items()}
    if isinstance(value, tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return value


def _response(request_id: str, *, ok: bool, result: Any = None, error: str | None = None) -> None:
    payload = {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "ok": ok,
        "result": _jsonable(result) if ok else None,
        "error": error if not ok else None,
    }
    print(RESULT_PREFIX + json.dumps(payload, separators=(",", ":")), flush=True)


def _handle(request: Mapping[str, Any]) -> Any:
    operation = request.get("operation")
    if operation == "availability":
        # Importing the writer dependency here proves the packaged runtime has
        # the required Python modules without touching the Rekordbox database.
        import pyrekordbox  # noqa: F401

        return {"available": True, "protocolVersion": PROTOCOL_VERSION}
    if operation == "preflight":
        saved_rows = request.get("savedDrafts")
        if not isinstance(saved_rows, list):
            raise ValueError("savedDrafts must be an array")
        return preflight_saved_cue_drafts(saved_rows)
    if operation == "apply":
        token = request.get("token")
        saved_rows = request.get("savedDrafts")
        if not isinstance(token, str) or not token:
            raise ValueError("token is required")
        if not isinstance(saved_rows, list):
            raise ValueError("savedDrafts must be an array")
        return apply_saved_cue_drafts(token, saved_rows)
    raise ValueError("unsupported operation")


def main() -> int:
    for raw_line in sys.stdin.buffer:
        request: Mapping[str, Any] | None = None
        if len(raw_line) > MAX_REQUEST_BYTES:
            _response("unknown", ok=False, error="request-too-large")
            continue
        try:
            request = json.loads(raw_line.decode("utf-8"))
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
            request_id = request.get("requestId")
            if not isinstance(request_id, str) or not request_id:
                raise ValueError("requestId is required")
            if request.get("protocolVersion") != PROTOCOL_VERSION:
                raise ValueError("unsupported protocol version")
            result = _handle(request)
            _response(request_id, ok=True, result=result)
        except Exception as exc:  # noqa: BLE001 - protocol must fail closed
            request_id = request.get("requestId", "unknown") if isinstance(request, dict) else "unknown"
            _response(str(request_id), ok=False, error=str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
