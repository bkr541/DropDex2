from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest

from app.analysis_worker_lease import (
    DurableWorkerLease,
    WorkerLeaseConflict,
    WorkerLeaseLost,
    lease_row_is_active,
)
from app.import_worker_registry import WorkerStopRequested


class _RpcBuilder:
    def __init__(self, data):
        self._data = data

    def execute(self):
        return SimpleNamespace(data=self._data)


class _ImportQuery:
    def __init__(self, row):
        self._row = row

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self._row)


class _LeaseClient:
    def __init__(self, *, acquired=True, renewed=True, import_row=None):
        self.acquired = acquired
        self.renewed = renewed
        self.import_row = import_row or {
            "status": "processing",
            "analysis_status": "parsing",
            "analysis_worker_status": "running",
        }
        self.rpc_calls: list[tuple[str, dict]] = []

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        if name == "claim_rekordbox_import_worker_lease":
            return _RpcBuilder([{"acquired": self.acquired}])
        if name == "renew_rekordbox_import_worker_lease":
            return _RpcBuilder([{"renewed": self.renewed}])
        if name == "release_rekordbox_import_worker_lease":
            return _RpcBuilder([{"released": True}])
        raise AssertionError(name)

    def table(self, name):
        assert name == "rekordbox_imports"
        return _ImportQuery(self.import_row)


def test_lease_row_active_uses_expiry_not_stale_presence():
    now = datetime(2026, 7, 25, tzinfo=timezone.utc)

    assert lease_row_is_active(
        {"lease_expires_at": (now + timedelta(seconds=1)).isoformat()},
        now=now,
    )
    assert not lease_row_is_active(
        {"lease_expires_at": (now - timedelta(seconds=1)).isoformat()},
        now=now,
    )
    assert not lease_row_is_active({"lease_expires_at": "not-a-date"}, now=now)


def test_claim_rejects_existing_unexpired_owner():
    with pytest.raises(WorkerLeaseConflict):
        DurableWorkerLease.claim(
            _LeaseClient(acquired=False),
            "import-1",
            "user-1",
            "analysis",
        )


def test_checkpoint_observes_remote_pause_and_release_is_token_scoped():
    client = _LeaseClient(
        import_row={
            "status": "pause_requested",
            "analysis_status": "pause_requested",
            "analysis_worker_status": "pause_requested",
        }
    )
    lease = DurableWorkerLease.claim(
        client,
        "import-1",
        "user-1",
        "analysis",
    )

    with pytest.raises(WorkerStopRequested) as exc:
        lease.checkpoint("before_parsing", "track-1", force=True)

    assert exc.value.reason == "pause"
    assert exc.value.stage == "before_parsing"
    lease.release()
    release_name, release_payload = client.rpc_calls[-1]
    assert release_name == "release_rekordbox_import_worker_lease"
    assert release_payload["p_owner_token"] == lease.owner_token


def test_rejected_renewal_fails_closed():
    client = _LeaseClient(renewed=False)
    lease = DurableWorkerLease.claim(
        client,
        "import-1",
        "user-1",
        "analysis",
    )

    with pytest.raises(WorkerLeaseLost):
        lease.checkpoint("feature_batch_committed", force=True)

    # A lost lease never attempts an unsafe second checkpoint.
    with pytest.raises(WorkerLeaseLost):
        lease.checkpoint("finalizing_import", force=True)
