"""
Validate Supabase access tokens sent by the signed-in frontend user.

Token flow:
  1. Frontend attaches the Supabase session access_token as a Bearer header.
  2. Backend reads the `alg` field from the token header.
     - ES256 (modern Supabase projects): verifies using the project's public
       JWKS endpoint — no shared secret needed.
     - HS256 (legacy projects / tests): verifies using SUPABASE_JWT_SECRET.
  3. The `sub` claim (UUID string) is the authenticated user_id.
  4. user_id is NEVER accepted from form data or URL parameters.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import Header, HTTPException
from jose import JWTError, jwt

from .config import settings

logger = logging.getLogger(__name__)

_jwks_cache: dict | None = None


def _get_jwks() -> dict:
    """Fetch the project JWKS once and cache it for the lifetime of the process."""
    global _jwks_cache
    if _jwks_cache is None:
        url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        try:
            resp = httpx.get(url, timeout=10.0)
            resp.raise_for_status()
            _jwks_cache = resp.json()
            logger.info(
                "Loaded JWKS (%d keys) from %s",
                len(_jwks_cache.get("keys", [])),
                url,
            )
        except Exception as exc:
            logger.error("Failed to fetch JWKS from %s: %s", url, exc)
            raise HTTPException(
                status_code=503,
                detail="Authentication service temporarily unavailable",
            )
    return _jwks_cache


def _find_jwk(kid: str | None) -> dict:
    """Return the JWK whose kid matches, or the first key if kid is absent."""
    for key in _get_jwks().get("keys", []):
        if kid is None or key.get("kid") == kid:
            return key
    raise HTTPException(status_code=401, detail="No matching signing key found")


async def get_current_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")

    token = authorization[len("Bearer "):].strip()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    alg = header.get("alg", "HS256")

    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise HTTPException(
                    status_code=401,
                    detail="Server not configured for HS256 tokens",
                )
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            # ES256 and other asymmetric algorithms: use JWKS
            jwk_key = _find_jwk(header.get("kid"))
            payload = jwt.decode(
                token,
                jwk_key,
                algorithms=[alg],
                audience="authenticated",
            )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user identity")

    return user_id
