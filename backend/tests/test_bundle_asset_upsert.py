from __future__ import annotations

from app.bundle_import_service import _upsert_bundle_asset


class _AssetQuery:
    def __init__(self) -> None:
        self.payload = None
        self.on_conflict = None
        self.executed = False

    def upsert(self, payload, *, on_conflict):
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def execute(self):
        self.executed = True
        return self


class _Supabase:
    def __init__(self) -> None:
        self.query = _AssetQuery()
        self.table_name = None

    def table(self, name: str):
        self.table_name = name
        return self.query


def test_bundle_asset_upsert_is_atomic_and_retry_safe():
    sb = _Supabase()
    asset = {
        "import_id": "import-1",
        "relative_path": "pioneer/usb/anlz0000.dat",
        "asset_type": "DAT",
    }

    _upsert_bundle_asset(sb, asset)

    assert sb.table_name == "rekordbox_analysis_assets"
    assert sb.query.payload == asset
    assert sb.query.on_conflict == "import_id,relative_path"
    assert sb.query.executed is True
