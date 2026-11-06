"""A new import records which of the user's USBs it came from, and only accepts the user's own USBs."""

import pytest
from fastapi import HTTPException

from app import import_jobs


class _Table:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.payload = db, name, {}, None

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def limit(self, *_):
        return self

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            self.db.inserted.append((self.name, self.payload))
            return type("R", (), {"data": [{"id": "import-1", **self.payload}]})()
        rows = [
            r for r in self.db.devices
            if all(r.get(k) == v for k, v in self.filters.items())
        ]
        return type("R", (), {"data": rows})()


class _Db:
    def __init__(self, devices):
        self.devices, self.inserted = devices, []

    def table(self, name):
        return _Table(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = _Db([{"id": "usb-1", "user_id": "user-1"}])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: fake)
    return fake


def _create(**extra):
    return import_jobs.create_import_job(
        user_id="user-1", source_filename="export.db", source_bundle_type="usb_folder", device_name="LUMA", **extra
    )


def test_stores_the_usb_id_on_the_import(db):
    row = _create(usb_device_id="usb-1")
    assert row["usb_device_id"] == "usb-1"
    assert db.inserted[0][1]["usb_device_id"] == "usb-1"
    assert db.inserted[0][1]["device_name"] == "LUMA"


def test_an_import_without_a_usb_id_still_works(db):
    assert _create()["usb_device_id"] is None


def test_rejects_a_usb_that_belongs_to_someone_else(db):
    with pytest.raises(HTTPException) as caught:
        import_jobs.create_import_job(
            user_id="user-2", source_filename="export.db", source_bundle_type="usb_folder", usb_device_id="usb-1"
        )
    assert caught.value.status_code == 422
    assert caught.value.detail["error_code"] == "UNKNOWN_USB_DEVICE"
    assert db.inserted == []
