"""Structured import timing and operation-count metrics."""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

logger = logging.getLogger(__name__)

# ── Stage 2 buffered metrics thresholds ───────────────────────────────────────
# Flush accumulated Stage 2 batch metrics after this many batches ...
_METRIC_CHECKPOINT_BATCHES = 10
# ... or after this many seconds since the previous flush, whichever comes first.
_METRIC_CHECKPOINT_SECONDS = 10.0


@dataclass
class ImportMetrics:
    import_id: str
    timings_ms: dict[str, float] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    bytes: dict[str, int] = field(default_factory=dict)
    _started: dict[str, float] = field(default_factory=dict, repr=False)

    def start(self, stage: str) -> None:
        self._started[stage] = time.perf_counter()

    def stop(self, stage: str) -> float:
        started = self._started.pop(stage, None)
        elapsed = 0.0 if started is None else (time.perf_counter() - started) * 1000.0
        self.timings_ms[stage] = round(self.timings_ms.get(stage, 0.0) + elapsed, 3)
        return elapsed

    @contextmanager
    def timed(self, stage: str) -> Iterator[None]:
        self.start(stage)
        try:
            yield
        finally:
            self.stop(stage)

    def increment(self, name: str, amount: int = 1) -> None:
        self.counts[name] = int(self.counts.get(name, 0)) + int(amount)

    def add_bytes(self, name: str, amount: int) -> None:
        self.bytes[name] = int(self.bytes.get(name, 0)) + max(0, int(amount))

    def payload(self) -> dict[str, Any]:
        return {
            "timings_ms": dict(self.timings_ms),
            "counts": dict(self.counts),
            "bytes": dict(self.bytes),
        }


def merge_import_metrics(sb: Any, import_id: str, metrics: ImportMetrics | dict[str, Any]) -> None:
    payload = metrics.payload() if isinstance(metrics, ImportMetrics) else metrics
    try:
        sb.rpc(
            "merge_rekordbox_import_performance_metrics",
            {"p_import_id": import_id, "p_metrics": payload},
        ).execute()
    except Exception as exc:
        logger.warning("Could not persist import performance metrics for %s: %s", import_id, exc)


# ── Process-local Stage 2 metrics buffer ─────────────────────────────────────

@dataclass
class _PendingMetrics:
    timings_ms: dict[str, float] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    bytes: dict[str, int] = field(default_factory=dict)
    batch_count: int = 0
    first_updated_at: float = field(default_factory=time.monotonic)
    last_flushed_at: float = field(default_factory=time.monotonic)

    def absorb(self, metrics: ImportMetrics) -> None:
        for k, v in metrics.timings_ms.items():
            self.timings_ms[k] = round(self.timings_ms.get(k, 0.0) + v, 3)
        for k, v in metrics.counts.items():
            self.counts[k] = int(self.counts.get(k, 0)) + int(v)
        for k, v in metrics.bytes.items():
            self.bytes[k] = int(self.bytes.get(k, 0)) + max(0, int(v))
        self.batch_count += 1

    def payload(self) -> dict[str, Any]:
        return {
            "timings_ms": dict(self.timings_ms),
            "counts": dict(self.counts),
            "bytes": dict(self.bytes),
        }

    def is_due(self) -> bool:
        return (
            self.batch_count >= _METRIC_CHECKPOINT_BATCHES
            or (time.monotonic() - self.last_flushed_at) >= _METRIC_CHECKPOINT_SECONDS
        )


_metrics_lock = threading.Lock()
_metrics_buffer: dict[str, _PendingMetrics] = {}


def checkpoint_import_metrics(
    sb: Any,
    import_id: str,
    metrics: ImportMetrics,
    *,
    force: bool = False,
) -> None:
    """Absorb one Stage 2 batch into the process-local buffer.

    Writes to Supabase only when a threshold is reached or force=True.
    Never raises — telemetry failures are logged and do not affect import
    correctness.
    """
    payload_to_flush: dict[str, Any] | None = None
    rebuffer: _PendingMetrics | None = None

    with _metrics_lock:
        pending = _metrics_buffer.get(import_id)
        if pending is None:
            pending = _PendingMetrics()
            _metrics_buffer[import_id] = pending
        pending.absorb(metrics)

        if force or pending.is_due():
            payload_to_flush = pending.payload()
            # Remove the entry; it will be re-inserted only if the flush fails.
            del _metrics_buffer[import_id]

    if payload_to_flush is None:
        return

    try:
        merge_import_metrics(sb, import_id, payload_to_flush)
    except Exception as exc:
        logger.warning(
            "Stage 2 metrics checkpoint failed for import %s; re-buffering: %s",
            import_id,
            exc,
        )
        # Best-effort re-buffer so a later checkpoint can retry.
        with _metrics_lock:
            existing = _metrics_buffer.get(import_id)
            if existing is None:
                recovered = _PendingMetrics()
                for k, v in payload_to_flush.get("timings_ms", {}).items():
                    recovered.timings_ms[k] = round(recovered.timings_ms.get(k, 0.0) + v, 3)
                for k, v in payload_to_flush.get("counts", {}).items():
                    recovered.counts[k] = int(recovered.counts.get(k, 0)) + int(v)
                for k, v in payload_to_flush.get("bytes", {}).items():
                    recovered.bytes[k] = int(recovered.bytes.get(k, 0)) + max(0, int(v))
                _metrics_buffer[import_id] = recovered
            else:
                # A concurrent batch already re-created the entry; merge into it.
                for k, v in payload_to_flush.get("timings_ms", {}).items():
                    existing.timings_ms[k] = round(existing.timings_ms.get(k, 0.0) + v, 3)
                for k, v in payload_to_flush.get("counts", {}).items():
                    existing.counts[k] = int(existing.counts.get(k, 0)) + int(v)
                for k, v in payload_to_flush.get("bytes", {}).items():
                    existing.bytes[k] = int(existing.bytes.get(k, 0)) + max(0, int(v))


def flush_import_metrics(sb: Any, import_id: str) -> None:
    """Force-flush any buffered Stage 2 metrics for import_id and remove the entry.

    Idempotent — safe to call even when no buffer entry exists.
    Never raises.
    """
    with _metrics_lock:
        pending = _metrics_buffer.pop(import_id, None)

    if pending is None:
        return

    try:
        merge_import_metrics(sb, import_id, pending.payload())
    except Exception as exc:
        logger.warning(
            "Final Stage 2 metrics flush failed for import %s: %s",
            import_id,
            exc,
        )


_CLIENT_METRIC_KEYS = {
    "timings_ms": {"usb_file_matching"},
    "counts": {"usb_files_matched", "affected_tracks"},
    "bytes": {"required_analysis_files"},
}


def sanitize_client_import_metrics(payload: Any) -> dict[str, dict[str, float | int]]:
    """Keep only bounded aggregate browser metrics, never paths or track metadata."""
    if not isinstance(payload, dict):
        return {}
    result: dict[str, dict[str, float | int]] = {}
    for section, allowed_keys in _CLIENT_METRIC_KEYS.items():
        raw_section = payload.get(section)
        if not isinstance(raw_section, dict):
            continue
        values: dict[str, float | int] = {}
        for key in allowed_keys:
            raw = raw_section.get(key)
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                continue
            if raw < 0:
                continue
            if section == "timings_ms":
                values[key] = round(min(float(raw), 24 * 60 * 60 * 1000), 3)
            else:
                values[key] = min(int(raw), 10**15)
        if values:
            result[section] = values
    return result
