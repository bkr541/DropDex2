"""Narrow JSON-lines desktop protocol for cue apply and metadata preflight.

This long-lived process owns preflight token stores for its lifetime. It never
accepts a filesystem path, SQL, shell command, or arbitrary operation name from
the renderer.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from typing import Any, Mapping

from rekordbox_bridge.apply_service import apply_saved_cue_drafts, preflight_saved_cue_drafts
from rekordbox_bridge.metadata_preflight import (
    metadata_preflight_availability,
    preflight_saved_metadata_drafts,
)

PROTOCOL_VERSION = 3
RESULT_PREFIX = "DROPDEX_BRIDGE_RESULT:"
MAX_REQUEST_BYTES = 2_000_000


def _validate_scope(scope: Any, saved_rows: list[Any]) -> None:
    if not isinstance(scope, Mapping):
        raise ValueError("scope is required")
    kind = scope.get("kind")
    import_id = scope.get("importId")
    if kind not in ("track", "all") or not isinstance(import_id, str) or not import_id:
        raise ValueError("scope is invalid")
    expected_keys = {"kind", "importId", "trackId"} if kind == "track" else {"kind", "importId"}
    if set(scope) != expected_keys:
        raise ValueError("scope contains unsupported fields")
    track_id = scope.get("trackId") if kind == "track" else None
    if kind == "track" and (not isinstance(track_id, str) or not track_id):
        raise ValueError("track scope requires trackId")

    for row in saved_rows:
        if not isinstance(row, Mapping):
            raise ValueError("savedDrafts entries must be objects")
        document = row.get("desiredDocument", row.get("desired_document"))
        if not isinstance(document, Mapping):
            raise ValueError("saved draft document is invalid")
        row_import_id = row.get("importId", row.get("import_id"))
        if row_import_id != import_id or document.get("importId") != import_id:
            raise ValueError("scope does not match saved draft import")

    if kind == "track":
        if len(saved_rows) != 1:
            raise ValueError("Apply Track requires exactly one saved cue draft")
        row = saved_rows[0]
        document = row.get("desiredDocument", row.get("desired_document"))
        row_track_id = row.get("trackId", row.get("track_id"))
        if row_track_id != track_id or document.get("trackId") != track_id:
            raise ValueError("track scope does not match saved cue draft")


def _validate_metadata_scope(scope: Any, saved_rows: list[Any]) -> None:
    if not isinstance(scope, Mapping):
        raise ValueError("metadata scope is required")
    kind = scope.get("kind")
    import_id = scope.get("importId")
    if (
        kind not in ("track", "all")
        or not isinstance(import_id, str)
        or not import_id
        or len(import_id) > 256
    ):
        raise ValueError("metadata scope is invalid")

    expected_keys = (
        {"kind", "importId", "trackId"}
        if kind == "track"
        else {"kind", "importId", "expectedDraftCount"}
    )
    if set(scope) != expected_keys:
        raise ValueError("metadata scope contains unsupported fields")

    if not saved_rows or len(saved_rows) > 5000:
        raise ValueError("metadata preflight requires between 1 and 5000 saved drafts")

    for row in saved_rows:
        if not isinstance(row, Mapping):
            raise ValueError("savedDrafts entries must be objects")
        if row.get("importId") != import_id:
            raise ValueError("metadata scope does not match saved draft import")
        if row.get("field") != "genre":
            raise ValueError("unsupported metadata field")

    if kind == "track":
        track_id = scope.get("trackId")
        if not isinstance(track_id, str) or not track_id or len(track_id) > 256:
            raise ValueError("metadata track scope requires trackId")
        if len(saved_rows) != 1 or saved_rows[0].get("trackId") != track_id:
            raise ValueError("metadata track scope does not match exactly one saved draft")
        return

    expected_count = scope.get("expectedDraftCount")
    if (
        isinstance(expected_count, bool)
        or not isinstance(expected_count, int)
        or expected_count <= 0
        or expected_count > 5000
    ):
        raise ValueError("metadata all scope expectedDraftCount is invalid")
    if expected_count != len(saved_rows):
        raise ValueError("metadata all scope is incomplete")


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
    if operation == "metadataAvailability":
        result = metadata_preflight_availability()
        return {**result, "protocolVersion": PROTOCOL_VERSION}
    if operation == "metadataPreflight":
        saved_rows = request.get("savedDrafts")
        if not isinstance(saved_rows, list):
            raise ValueError("savedDrafts must be an array")
        _validate_metadata_scope(request.get("scope"), saved_rows)
        return preflight_saved_metadata_drafts(saved_rows)
    if operation == "preflight":
        saved_rows = request.get("savedDrafts")
        if not isinstance(saved_rows, list):
            raise ValueError("savedDrafts must be an array")
        _validate_scope(request.get("scope"), saved_rows)
        return preflight_saved_cue_drafts(saved_rows)
    if operation == "apply":
        token = request.get("token")
        saved_rows = request.get("savedDrafts")
        if not isinstance(token, str) or not token:
            raise ValueError("token is required")
        if not isinstance(saved_rows, list):
            raise ValueError("savedDrafts must be an array")
        _validate_scope(request.get("scope"), saved_rows)
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
