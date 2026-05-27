"""
Upserts the active import for a user in rekordbox_user_settings.
Uses the Supabase REST API directly with the service-role key so no
frontend credentials are needed.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)


def upsert_active_import(
    supabase_url: str,
    service_key: str,
    user_id: str,
    import_id: str,
) -> None:
    url = f"{supabase_url.rstrip('/')}/rest/v1/rekordbox_user_settings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    payload = {
        "user_id": user_id,
        "active_import_id": import_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    response = httpx.post(url, json=payload, headers=headers, timeout=10.0)
    response.raise_for_status()
    logger.debug("Set active import %s for user %s", import_id, user_id)
