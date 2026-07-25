"""Thread-safe in-process execution registry for Rekordbox analysis workers.

The API is intentionally queue-agnostic. A future durable worker can implement the
same request/checkpoint/acknowledgement contract without changing route semantics.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

StopReason = Literal["pause", "delete"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorkerStopRequested(RuntimeError):
    def __init__(self, import_id: str, reason: StopReason, stage: str | None = None):
        super().__init__(f"{reason} requested for {import_id} at {stage or 'checkpoint'}")
        self.import_id = import_id
        self.reason = reason
        self.stage = stage


@dataclass
class WorkerControl:
    import_id: str
    lock: threading.RLock = field(default_factory=threading.RLock)
    pause_requested: threading.Event = field(default_factory=threading.Event)
    delete_requested: threading.Event = field(default_factory=threading.Event)
    stopped: threading.Event = field(default_factory=threading.Event)
    active: bool = False
    status: str = "idle"
    current_track_id: str | None = None
    current_stage: str | None = None
    last_heartbeat: str | None = None
    stopped_at: str | None = None
    error: str | None = None

    def requested_reason(self) -> StopReason | None:
        if self.delete_requested.is_set():
            return "delete"
        if self.pause_requested.is_set():
            return "pause"
        return None


class ImportWorkerRegistry:
    def __init__(self) -> None:
        self._controls: dict[str, WorkerControl] = {}
        self._lock = threading.RLock()

    def _control(self, import_id: str) -> WorkerControl:
        with self._lock:
            return self._controls.setdefault(import_id, WorkerControl(import_id=import_id))

    def register(self, import_id: str) -> WorkerControl:
        control = self._control(import_id)
        with control.lock:
            if control.active:
                raise RuntimeError(f"Analysis worker already running for import {import_id}")
            control.active = True
            control.status = "running"
            control.current_track_id = None
            control.current_stage = "starting"
            control.last_heartbeat = _now()
            control.stopped_at = None
            control.error = None
            control.stopped.clear()
        return control

    def checkpoint(
        self,
        import_id: str,
        stage: str,
        *,
        current_track_id: str | None = None,
    ) -> None:
        control = self._control(import_id)
        with control.lock:
            control.current_stage = stage
            control.current_track_id = current_track_id
            control.last_heartbeat = _now()
            reason = control.requested_reason()
            if reason:
                control.status = "stopping"
                raise WorkerStopRequested(import_id, reason, stage)

    def request_stop(self, import_id: str, reason: StopReason) -> WorkerControl:
        control = self._control(import_id)
        with control.lock:
            if reason == "delete":
                control.delete_requested.set()
                control.pause_requested.set()
                control.status = "cancel_requested" if control.active else "stopped"
            else:
                control.pause_requested.set()
                if control.status != "cancel_requested":
                    control.status = "pause_requested" if control.active else "stopped"
            control.last_heartbeat = _now()
            if not control.active:
                control.stopped.set()
                control.stopped_at = control.stopped_at or _now()
        return control

    def acknowledge_stopped(
        self,
        import_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        control = self._control(import_id)
        with control.lock:
            control.active = False
            control.status = status
            control.current_track_id = None
            control.current_stage = "stopped"
            control.last_heartbeat = _now()
            control.stopped_at = _now()
            control.error = error
            control.stopped.set()

    def clear_stop_requests(self, import_id: str) -> None:
        control = self._control(import_id)
        with control.lock:
            if control.active:
                raise RuntimeError(f"Cannot clear stop requests for active import {import_id}")
            control.pause_requested.clear()
            control.delete_requested.clear()
            control.status = "idle"
            control.current_stage = None
            control.error = None

    def wait_for_stopped(self, import_id: str, timeout_seconds: float) -> bool:
        return self._control(import_id).stopped.wait(max(0.0, timeout_seconds))

    def snapshot(self, import_id: str) -> dict[str, Any]:
        control = self._control(import_id)
        with control.lock:
            return {
                "import_id": import_id,
                "worker_status": control.status,
                "active": control.active,
                "stop_reason": control.requested_reason(),
                "current_track_id": control.current_track_id,
                "current_stage": control.current_stage,
                "last_heartbeat": control.last_heartbeat,
                "stopped_acknowledged": control.stopped.is_set(),
                "stopped_at": control.stopped_at,
                "error": control.error,
            }


worker_registry = ImportWorkerRegistry()
