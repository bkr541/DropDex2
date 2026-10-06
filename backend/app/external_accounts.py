from __future__ import annotations

import base64
import hashlib
import html
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import quote, urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from jose import JWTError, jwt
from pydantic import BaseModel

from .auth import get_current_user_id
from .config import settings

router = APIRouter(prefix="/api/external-accounts", tags=["external accounts"])

_PROVIDER = "spotify"
_SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
_SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
_SPOTIFY_PROFILE_URL = "https://api.spotify.com/v1/me"
_SPOTIFY_API_URL = "https://api.spotify.com/v1"
_SPOTIFY_PLAYLIST_SCOPES = {
    "playlist-read-private",
    "playlist-read-collaborative",
}


class ExternalAccountStatus(BaseModel):
    provider: Literal["spotify"] = "spotify"
    status: Literal["pending", "linked", "failed"]
    display_name: str | None = None
    profile_url: str | None = None
    linked_at: str | None = None
    playlist_access: bool = False


class SpotifyConnectResponse(BaseModel):
    authorization_url: str
    status: Literal["pending"] = "pending"


class SpotifyPlaylist(BaseModel):
    id: str
    name: str
    description: str | None = None
    image_url: str | None = None
    external_url: str | None = None
    owner_name: str | None = None
    item_count: int = 0
    collaborative: bool = False
    public: bool | None = None


class SpotifyPlaylistPage(BaseModel):
    items: list[SpotifyPlaylist]
    total: int
    limit: int
    offset: int


class SpotifyTrack(BaseModel):
    id: str
    name: str
    artists: list[str]
    album_name: str | None = None
    image_url: str | None = None
    duration_ms: int = 0
    explicit: bool = False
    external_url: str | None = None
    added_at: str | None = None


class SpotifyTrackPage(BaseModel):
    playlist_id: str
    items: list[SpotifyTrack]
    total: int
    limit: int
    offset: int


def _spotify_credentials() -> tuple[str, str]:
    client_id = (settings.spotify_client_id or "").strip()
    client_secret = (settings.spotify_client_secret or "").strip()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail="Spotify account linking is not configured.",
        )
    return client_id, client_secret


def _token_cipher() -> Fernet:
    _, client_secret = _spotify_credentials()
    configured = (settings.spotify_token_encryption_key or "").strip()
    key = configured.encode("utf-8") if configured else base64.urlsafe_b64encode(
        hashlib.sha256(client_secret.encode("utf-8")).digest()
    )
    try:
        return Fernet(key)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Spotify token encryption is not configured correctly.",
        ) from exc


def _encrypt_token(token: str) -> str:
    return _token_cipher().encrypt(token.encode("utf-8")).decode("ascii")


def _decrypt_token(ciphertext: object) -> str:
    if not isinstance(ciphertext, str) or not ciphertext:
        raise HTTPException(status_code=409, detail="Relink Spotify to enable playlist access.")
    try:
        return _token_cipher().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(status_code=409, detail="Relink Spotify to enable playlist access.") from exc


def _supabase_headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": "application/json",
    }


async def _get_account(user_id: str) -> dict | None:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/user_external_accounts"
    params = {
        "user_id": f"eq.{user_id}",
        "provider": f"eq.{_PROVIDER}",
        "select": (
            "status,display_name,profile_url,linked_at,access_token_ciphertext,"
            "refresh_token_ciphertext,token_expires_at,granted_scopes"
        ),
        "limit": "1",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, params=params, headers=_supabase_headers())
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not load external account status.")
    rows = response.json()
    return rows[0] if isinstance(rows, list) and rows else None


async def _upsert_account(user_id: str, **updates: object) -> None:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/user_external_accounts"
    payload = {"user_id": user_id, "provider": _PROVIDER, **updates}
    headers = {
        **_supabase_headers(),
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            url,
            params={"on_conflict": "user_id,provider"},
            headers=headers,
            json=payload,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not save external account status.")


async def _delete_account(user_id: str) -> None:
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/user_external_accounts"
    params = {"user_id": f"eq.{user_id}", "provider": f"eq.{_PROVIDER}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.delete(url, params=params, headers=_supabase_headers())
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not unlink Spotify.")


def _status_from_row(row: dict | None) -> ExternalAccountStatus:
    if row is None:
        return ExternalAccountStatus(status="failed")
    status = row.get("status")
    if status not in {"pending", "linked", "failed"}:
        status = "failed"
    return ExternalAccountStatus(
        status=status,
        display_name=row.get("display_name"),
        profile_url=row.get("profile_url"),
        linked_at=row.get("linked_at"),
        playlist_access=(
            status == "linked"
            and isinstance(row.get("refresh_token_ciphertext"), str)
            and _SPOTIFY_PLAYLIST_SCOPES.issubset(set(row.get("granted_scopes") or []))
        ),
    )


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _refresh_spotify_access_token(user_id: str, row: dict) -> str:
    client_id, client_secret = _spotify_credentials()
    refresh_token = _decrypt_token(row.get("refresh_token_ciphertext"))
    basic_credentials = base64.b64encode(
        f"{client_id}:{client_secret}".encode("utf-8")
    ).decode("ascii")
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            _SPOTIFY_TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            headers={
                "Authorization": f"Basic {basic_credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=409, detail="Relink Spotify to refresh playlist access.")
    payload = response.json()
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail="Spotify did not return an access token.")
    expires_in = payload.get("expires_in")
    expires_seconds = expires_in if isinstance(expires_in, int) else 3600
    next_refresh_token = payload.get("refresh_token")
    scopes = payload.get("scope")
    updates: dict[str, object] = {
        "access_token_ciphertext": _encrypt_token(access_token),
        "token_expires_at": (
            datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        ).isoformat(),
    }
    if isinstance(next_refresh_token, str) and next_refresh_token:
        updates["refresh_token_ciphertext"] = _encrypt_token(next_refresh_token)
    if isinstance(scopes, str) and scopes:
        updates["granted_scopes"] = scopes.split()
    await _upsert_account(user_id, **updates)
    return access_token


async def _spotify_access_token(user_id: str, *, force_refresh: bool = False) -> str:
    row = await _get_account(user_id)
    if not row or row.get("status") != "linked":
        raise HTTPException(status_code=409, detail="Link Spotify before opening playlists.")
    scopes = set(row.get("granted_scopes") or [])
    if not _SPOTIFY_PLAYLIST_SCOPES.issubset(scopes):
        raise HTTPException(status_code=409, detail="Relink Spotify to grant playlist access.")
    expires_at = _parse_datetime(row.get("token_expires_at"))
    if (
        not force_refresh
        and expires_at is not None
        and expires_at > datetime.now(timezone.utc) + timedelta(seconds=60)
    ):
        return _decrypt_token(row.get("access_token_ciphertext"))
    return await _refresh_spotify_access_token(user_id, row)


async def _spotify_get(user_id: str, path: str, params: dict[str, object]) -> dict:
    access_token = await _spotify_access_token(user_id)
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{_SPOTIFY_API_URL}{path}",
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if response.status_code == 401:
            access_token = await _spotify_access_token(user_id, force_refresh=True)
            response = await client.get(
                f"{_SPOTIFY_API_URL}{path}",
                params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    if response.status_code == 403:
        raise HTTPException(
            status_code=403,
            detail="Spotify only exposes tracks for playlists you own or collaborate on.",
        )
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="Spotify rate limit reached. Try again shortly.")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Spotify could not load this library data.")
    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Spotify returned an unexpected response.")
    return payload


def _callback_page(success: bool, message: str) -> HTMLResponse:
    title = "Spotify linked" if success else "Spotify connection failed"
    color = "#1ed760" if success else "#ff5c6c"
    safe_title = html.escape(title)
    safe_message = html.escape(message)
    status_code = 200 if success else 400
    return HTMLResponse(
        status_code=status_code,
        content=f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{safe_title}</title>
  </head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090d12;color:#f5f7fa;font-family:Inter,system-ui,sans-serif">
    <main style="width:min(420px,calc(100% - 40px));padding:32px;border:1px solid #27313d;border-radius:16px;background:#111821;text-align:center">
      <div style="width:48px;height:48px;margin:0 auto 18px;border-radius:50%;background:{color};display:grid;place-items:center;color:#08100b;font-size:24px;font-weight:900">{'✓' if success else '!'}</div>
      <h1 style="margin:0 0 8px;font-size:22px">{safe_title}</h1>
      <p style="margin:0;color:#9ca7b5;font-size:14px;line-height:1.5">{safe_message}</p>
      <p style="margin:22px 0 0;color:#66717f;font-size:12px">You can close this window and return to DropDex.</p>
    </main>
  </body>
</html>""",
    )


@router.get("/spotify", response_model=ExternalAccountStatus)
async def get_spotify_status(
    user_id: str = Depends(get_current_user_id),
) -> ExternalAccountStatus:
    return _status_from_row(await _get_account(user_id))


@router.delete("/spotify", status_code=204)
async def unlink_spotify(
    user_id: str = Depends(get_current_user_id),
) -> None:
    await _delete_account(user_id)


@router.post("/spotify/connect", response_model=SpotifyConnectResponse)
async def connect_spotify(
    user_id: str = Depends(get_current_user_id),
) -> SpotifyConnectResponse:
    client_id, client_secret = _spotify_credentials()
    now = datetime.now(timezone.utc)
    state = jwt.encode(
        {
            "sub": user_id,
            "iat": now,
            "exp": now + timedelta(minutes=10),
            "jti": secrets.token_urlsafe(18),
        },
        client_secret,
        algorithm="HS256",
    )
    await _upsert_account(
        user_id,
        status="pending",
        failure_reason=None,
    )
    authorization_url = f"{_SPOTIFY_AUTHORIZE_URL}?{urlencode({
        'response_type': 'code',
        'client_id': client_id,
        'redirect_uri': settings.spotify_redirect_uri,
        'scope': 'user-read-private playlist-read-private playlist-read-collaborative',
        'state': state,
        'show_dialog': 'true',
    })}"
    return SpotifyConnectResponse(authorization_url=authorization_url)


@router.get("/spotify/callback", response_class=HTMLResponse)
async def spotify_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> HTMLResponse:
    try:
        client_id, client_secret = _spotify_credentials()
        if not state:
            return _callback_page(False, "The authorization state was missing.")
        claims = jwt.decode(state, client_secret, algorithms=["HS256"])
        user_id = claims.get("sub")
        if not isinstance(user_id, str) or not user_id:
            return _callback_page(False, "The authorization state was invalid.")
    except (JWTError, HTTPException):
        return _callback_page(False, "The authorization request expired or was invalid.")

    if error or not code:
        await _upsert_account(
            user_id,
            status="failed",
            failure_reason="authorization_denied",
        )
        return _callback_page(False, "Spotify did not authorize the connection.")

    basic_credentials = base64.b64encode(
        f"{client_id}:{client_secret}".encode("utf-8")
    ).decode("ascii")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_response = await client.post(
                _SPOTIFY_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.spotify_redirect_uri,
                },
                headers={
                    "Authorization": f"Basic {basic_credentials}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            token_response.raise_for_status()
            token_payload = token_response.json()
            access_token = token_payload.get("access_token")
            refresh_token = token_payload.get("refresh_token")
            if not isinstance(access_token, str) or not access_token:
                raise ValueError("Spotify did not return an access token")
            if not isinstance(refresh_token, str) or not refresh_token:
                raise ValueError("Spotify did not return a refresh token")

            profile_response = await client.get(
                _SPOTIFY_PROFILE_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            profile_response.raise_for_status()
            profile = profile_response.json()

        provider_account_id = profile.get("account_id") or profile.get("id")
        if not isinstance(provider_account_id, str) or not provider_account_id:
            raise ValueError("Spotify did not return an account identifier")
        display_name = profile.get("display_name")
        external_urls = profile.get("external_urls")
        profile_url = (
            external_urls.get("spotify")
            if isinstance(external_urls, dict)
            else None
        )
        expires_in = token_payload.get("expires_in")
        expires_seconds = expires_in if isinstance(expires_in, int) else 3600
        granted_scope = token_payload.get("scope")
        granted_scopes = granted_scope.split() if isinstance(granted_scope, str) else []
        await _upsert_account(
            user_id,
            provider_account_id=provider_account_id,
            display_name=display_name if isinstance(display_name, str) else None,
            profile_url=profile_url if isinstance(profile_url, str) else None,
            status="linked",
            failure_reason=None,
            linked_at=datetime.now(timezone.utc).isoformat(),
            access_token_ciphertext=_encrypt_token(access_token),
            refresh_token_ciphertext=_encrypt_token(refresh_token),
            token_expires_at=(
                datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
            ).isoformat(),
            granted_scopes=granted_scopes,
        )
    except (httpx.HTTPError, ValueError, HTTPException):
        await _upsert_account(
            user_id,
            status="failed",
            failure_reason="spotify_exchange_failed",
        )
        return _callback_page(False, "Spotify could not complete the connection.")

    return _callback_page(True, "Your Spotify account is now linked to DropDex.")


@router.get("/spotify/playlists", response_model=SpotifyPlaylistPage)
async def get_spotify_playlists(
    limit: int = Query(default=50, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=100_000),
    user_id: str = Depends(get_current_user_id),
) -> SpotifyPlaylistPage:
    payload = await _spotify_get(
        user_id,
        "/me/playlists",
        {"limit": limit, "offset": offset},
    )
    playlists: list[SpotifyPlaylist] = []
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        playlist_id = item.get("id")
        name = item.get("name")
        if not isinstance(playlist_id, str) or not isinstance(name, str):
            continue
        images = item.get("images") or []
        first_image = images[0] if isinstance(images, list) and images else None
        image_url = first_image.get("url") if isinstance(first_image, dict) else None
        external_urls = item.get("external_urls")
        owner = item.get("owner")
        item_page = item.get("items") if isinstance(item.get("items"), dict) else item.get("tracks")
        item_count = item_page.get("total") if isinstance(item_page, dict) else 0
        playlists.append(SpotifyPlaylist(
            id=playlist_id,
            name=name,
            description=item.get("description") if isinstance(item.get("description"), str) else None,
            image_url=image_url if isinstance(image_url, str) else None,
            external_url=(
                external_urls.get("spotify")
                if isinstance(external_urls, dict)
                and isinstance(external_urls.get("spotify"), str)
                else None
            ),
            owner_name=(
                owner.get("display_name") or owner.get("id")
                if isinstance(owner, dict)
                else None
            ),
            item_count=item_count if isinstance(item_count, int) else 0,
            collaborative=bool(item.get("collaborative")),
            public=item.get("public") if isinstance(item.get("public"), bool) else None,
        ))
    return SpotifyPlaylistPage(
        items=playlists,
        total=payload.get("total") if isinstance(payload.get("total"), int) else len(playlists),
        limit=payload.get("limit") if isinstance(payload.get("limit"), int) else limit,
        offset=payload.get("offset") if isinstance(payload.get("offset"), int) else offset,
    )


@router.get("/spotify/playlists/{playlist_id}/tracks", response_model=SpotifyTrackPage)
async def get_spotify_playlist_tracks(
    playlist_id: str,
    limit: int = Query(default=50, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=100_000),
    user_id: str = Depends(get_current_user_id),
) -> SpotifyTrackPage:
    payload = await _spotify_get(
        user_id,
        f"/playlists/{quote(playlist_id, safe='')}/items",
        {"limit": limit, "offset": offset, "additional_types": "track"},
    )
    tracks: list[SpotifyTrack] = []
    for entry in payload.get("items") or []:
        if not isinstance(entry, dict):
            continue
        item = entry.get("item") if isinstance(entry.get("item"), dict) else entry.get("track")
        if not isinstance(item, dict) or item.get("type") != "track":
            continue
        track_id = item.get("id")
        name = item.get("name")
        if not isinstance(track_id, str) or not isinstance(name, str):
            continue
        artists = [
            artist.get("name")
            for artist in item.get("artists") or []
            if isinstance(artist, dict) and isinstance(artist.get("name"), str)
        ]
        album = item.get("album")
        images = album.get("images") if isinstance(album, dict) else None
        first_image = images[0] if isinstance(images, list) and images else None
        image_url = first_image.get("url") if isinstance(first_image, dict) else None
        external_urls = item.get("external_urls")
        duration_ms = item.get("duration_ms")
        tracks.append(SpotifyTrack(
            id=track_id,
            name=name,
            artists=artists,
            album_name=(
                album.get("name")
                if isinstance(album, dict) and isinstance(album.get("name"), str)
                else None
            ),
            image_url=image_url if isinstance(image_url, str) else None,
            duration_ms=duration_ms if isinstance(duration_ms, int) else 0,
            explicit=bool(item.get("explicit")),
            external_url=(
                external_urls.get("spotify")
                if isinstance(external_urls, dict)
                and isinstance(external_urls.get("spotify"), str)
                else None
            ),
            added_at=entry.get("added_at") if isinstance(entry.get("added_at"), str) else None,
        ))
    return SpotifyTrackPage(
        playlist_id=playlist_id,
        items=tracks,
        total=payload.get("total") if isinstance(payload.get("total"), int) else len(tracks),
        limit=payload.get("limit") if isinstance(payload.get("limit"), int) else limit,
        offset=payload.get("offset") if isinstance(payload.get("offset"), int) else offset,
    )
