"""Postgres-backed ownership leases for long-running Rekordbox workers.

The in-process worker registry provides the fastest pause/delete signal when the
request and worker live in the same API process.  This module is the
cross-process referee: one unexpired lease may exist for each ``(import,
worker_kind)`` pair, heartbeat renewal prevents a second process from taking
ownership during long parser/archive calls, and checkpoints read durable stop
intent from ``rekordbox_imports``.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from .config import settings
from .import_worker_registry import WorkerStopRequested

logger = logging.getLogger(__name__)

WorkerKind = Literal["analysis", "raw_archival"]
_LEASE_TABLE = "rekordbox_import_worker_leases"


class WorkerLeaseConflict(RuntimeError):
    """Raised when another process owns an unexpired worker lease."""


class WorkerLeaseLost(RuntimeError):
    """Raised when this process can no longer prove it owns the lease."""


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        raw = value.strip()
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def lease_row_is_active(
    row: dict[str, Any] | None,
    *,
    now: datetime | None = None,
) -> bool:
    """Return whether a persisted lease row is currently unexpired."""
    if not row:
        return False
    expires_at = _parse_timestamp(row.get("lease_expires_at"))
    if expires_at is None:
        return False
    current = now or _now_utc()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return expires_at > current.astimezone(timezone.utc)


def _response_row(response: Any) -> dict[str, Any] | None:
    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return dict(data)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return dict(data[0])
    return None


def get_worker_lease(
    sb: Any,
    import_id: str,
    worker_kind: WorkerKind | str,
) -> dict[str, Any] | None:
    """Read the durable lease row for one worker kind."""
    response = (
        sb.table(_LEASE_TABLE)
        .select("*")
        .eq("import_id", import_id)
        .eq("worker_kind", worker_kind)
        .maybe_single()
        .execute()
    )
    data = getattr(response, "data", None)
    return dict(data) if isinstance(data, dict) else None


def _owner_label() -> str:
    host = socket.gethostname().strip() or "unknown-host"
    return f"{host}:{os.getpid()}"


def _stop_reason(row: dict[str, Any]) -> Literal["pause", "delete"] | None:
    job_status = str(row.get("status") or "")
    analysis_status = str(row.get("analysis_status") or "")
    worker_status = str(row.get("analysis_worker_status") or "")

    if (
        job_status in {"cancel_requested", "stopping", "deleting", "cancelled"}
        or analysis_status in {"stopping", "cancelled"}
        or worker_status in {"cancel_requested", "stopping", "deleting"}
    ):
        return "delete"
    if (
        job_status in {"pause_requested", "paused"}
        or analysis_status in {"pause_requested", "paused"}
        or worker_status in {"pause_requested", "paused"}
    ):
        return "pause"
    return None


class DurableWorkerLease:
    """Owned, renewable worker lease with a background heartbeat."""

    def __init__(
        self,
        sb: Any,
        import_id: str,
        user_id: str,
        worker_kind: WorkerKind,
        owner_token: str,
        *,
        owner_id: str | None = None,
    ) -> None:
        self.sb = sb
        self.import_id = import_id
        self.user_id = user_id
        self.worker_kind = worker_kind
        self.owner_token = owner_token
        self.owner_id = owner_id or _owner_label()
        self.lease_seconds = max(15, int(settings.analysis_worker_lease_seconds))
        self.refresh_seconds = max(
            0.25,
            float(settings.analysis_worker_lease_refresh_seconds),
        )

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._heartbeat_thread: threading.Thread | None = None
        self._released = False
        self._lost_error: Exception | None = None
        self._current_stage = "claimed"
        self._current_track_id: str | None = None
        self._last_checkpoint_io = 0.0

    @classmethod
    def claim(
        cls,
        sb: Any,
        import_id: str,
        user_id: str,
        worker_kind: WorkerKind,
    ) -> "DurableWorkerLease":
        owner_token = str(uuid.uuid4())
        owner_id = _owner_label()
        response = sb.rpc(
            "claim_rekordbox_import_worker_lease",
            {
                "p_import_id": import_id,
                "p_user_id": user_id,
                "p_worker_kind": worker_kind,
                "p_owner_id": owner_id,
                "p_owner_token": owner_token,
                "p_lease_seconds": max(
                    15, int(settings.analysis_worker_lease_seconds)
                ),
            },
        ).execute()
        row = _response_row(response)
        if not row or not bool(row.get("acquired")):
            raise WorkerLeaseConflict(
                f"{worker_kind} worker lease is already owned for import {import_id}"
            )
        return cls(
            sb,
            import_id,
            user_id,
            worker_kind,
            owner_token,
            owner_id=owner_id,
        )

    def _mark_lost(self, exc: Exception) -> None:
        with self._lock:
            if self._lost_error is None:
                self._lost_error = exc
        self._stop_event.set()

    def _raise_if_unusable(self) -> None:
        with self._lock:
            if self._released:
                raise WorkerLeaseLost(
                    f"{self.worker_kind} worker lease was already released"
                )
            lost = self._lost_error
        if lost is not None:
            raise WorkerLeaseLost(
                f"{self.worker_kind} worker lease was lost for import {self.import_id}"
            ) from lost

    def _renew(self) -> None:
        self._raise_if_unusable()
        with self._lock:
            stage = self._current_stage
            current_track_id = self._current_track_id
        try:
            response = self.sb.rpc(
                "renew_rekordbox_import_worker_lease",
                {
                    "p_import_id": self.import_id,
                    "p_worker_kind": self.worker_kind,
                    "p_owner_token": self.owner_token,
                    "p_lease_seconds": self.lease_seconds,
                    "p_stage": stage,
                    "p_current_track_id": current_track_id,
                },
            ).execute()
            row = _response_row(response)
            if not row or not bool(row.get("renewed")):
                raise WorkerLeaseLost(
                    f"Database rejected {self.worker_kind} lease renewal"
                )
        except Exception as exc:
            self._mark_lost(exc)
            if isinstance(exc, WorkerLeaseLost):
                raise
            raise WorkerLeaseLost(
                f"Could not renew {self.worker_kind} lease for import {self.import_id}"
            ) from exc

    def _read_stop_intent(self, stage: str) -> None:
        response = (
            self.sb.table("rekordbox_imports")
            .select("status, analysis_status, analysis_worker_status")
            .eq("id", self.import_id)
            .eq("user_id", self.user_id)
            .maybe_single()
            .execute()
        )
        row = getattr(response, "data", None)
        if not isinstance(row, dict):
            self._mark_lost(RuntimeError("Import row no longer exists"))
            raise WorkerLeaseLost(
                f"Import {self.import_id} disappeared while worker held a lease"
            )
        reason = _stop_reason(row)
        if reason is not None:
            raise WorkerStopRequested(self.import_id, reason, stage)

    def checkpoint(
        self,
        stage: str,
        current_track_id: str | None = None,
        *,
        force: bool = False,
    ) -> None:
        """Publish stage and observe remote pause/delete intent.

        Hot local checks occur at every parser checkpoint. Durable I/O is
        throttled to the configured heartbeat interval, while ``force=True`` is
        used at batch commits and finalization boundaries.
        """
        self._raise_if_unusable()
        with self._lock:
            self._current_stage = stage
            self._current_track_id = current_track_id
            due = force or (
                time.monotonic() - self._last_checkpoint_io >= self.refresh_seconds
            )
            if due:
                self._last_checkpoint_io = time.monotonic()
        if not due:
            return
        self._renew()
        try:
            self._read_stop_intent(stage)
        except WorkerStopRequested:
            raise
        except WorkerLeaseLost:
            raise
        except Exception as exc:
            # Failing open here could let a remote delete race a writer. Treat
            # an unreadable durable control row as lost ownership instead.
            self._mark_lost(exc)
            raise WorkerLeaseLost(
                f"Could not verify stop intent for import {self.import_id}"
            ) from exc

    def _heartbeat_loop(self) -> None:
        while not self._stop_event.wait(self.refresh_seconds):
            try:
                self._renew()
            except WorkerLeaseLost:
                logger.exception(
                    "Lost %s worker lease heartbeat for import %s",
                    self.worker_kind,
                    self.import_id,
                )
                return

    def start_heartbeat(self) -> None:
        self._raise_if_unusable()
        with self._lock:
            if self._heartbeat_thread and self._heartbeat_thread.is_alive():
                return
            thread = threading.Thread(
                target=self._heartbeat_loop,
                name=f"dropdex-{self.worker_kind}-lease-{self.import_id[:8]}",
                daemon=True,
            )
            self._heartbeat_thread = thread
            try:
                thread.start()
            except Exception:
                self._heartbeat_thread = None
                self.release()
                raise

    def release(self) -> None:
        with self._lock:
            if self._released:
                return
            self._released = True
            thread = self._heartbeat_thread
        self._stop_event.set()
        if thread and thread is not threading.current_thread():
            thread.join(timeout=max(1.0, self.refresh_seconds * 2.0))
        try:
            self.sb.rpc(
                "release_rekordbox_import_worker_lease",
                {
                    "p_import_id": self.import_id,
                    "p_worker_kind": self.worker_kind,
                    "p_owner_token": self.owner_token,
                },
            ).execute()
        except Exception:
            # The lease will expire even when a network failure prevents an
            # eager release. Cleanup still fails closed while it is unexpired.
            logger.exception(
                "Could not release %s worker lease for import %s",
                self.worker_kind,
                self.import_id,
            )

    def __enter__(self) -> "DurableWorkerLease":
        self.start_heartbeat()
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.release()
