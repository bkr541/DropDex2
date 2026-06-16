"""HTTP upload of BridgePayload to the DropDex backend."""
from __future__ import annotations

import json
import os
from typing import Any, Dict

import httpx

from .models import BridgePayload


def upload_payload(
    payload: BridgePayload,
    api_url: str,
    import_id: str,
    token: str,
) -> Dict[str, Any]:
    """
    POST payload.to_dict() to
    {api_url}/api/rekordbox/import/{import_id}/related-tracks

    Bearer token is passed in the Authorization header.
    Never logs the token.
    Returns the response JSON on success.
    Raises RuntimeError with a sanitized message on failure (no token in message).
    """
    url = f"{api_url.rstrip('/')}/api/rekordbox/import/{import_id}/related-tracks"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(payload.to_dict())

    try:
        resp = httpx.post(url, content=data, headers=headers, timeout=60.0)
    except httpx.TimeoutException:
        raise RuntimeError(
            "Upload failed: request timed out after 60 seconds."
        )
    except httpx.RequestError as exc:
        # Never expose the token; exc may contain the URL but not the token
        raise RuntimeError(
            f"Upload failed: network error — {type(exc).__name__}"
        ) from exc

    if not resp.is_success:
        raise RuntimeError(
            f"Upload failed: HTTP {resp.status_code} from server"
            # Token is NOT included here
        )

    return resp.json()


def get_token_from_env() -> str:
    """
    Read DROPDEX_ACCESS_TOKEN from environment.
    Raises RuntimeError if the variable is absent or empty.
    """
    token = os.environ.get("DROPDEX_ACCESS_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "DROPDEX_ACCESS_TOKEN environment variable is not set. "
            "Set it to your DropDex access token before running the bridge."
        )
    return token
