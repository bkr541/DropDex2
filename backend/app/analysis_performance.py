"""Structured import timing and operation-count metrics."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

logger = logging.getLogger(__name__)


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
