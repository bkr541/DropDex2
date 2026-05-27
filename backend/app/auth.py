"""
Validate Supabase access tokens sent by the signed-in frontend user.

Token flow:
  1. Frontend attaches the Supabase session access_token as a Bearer header.
  2. Backend decodes and verifies the HS256 JWT using SUPABASE_JWT_SECRET.
  3. The `sub` claim (UUID string) is the authenticated user_id.
  4. user_id is NEVER accepted from form data or URL parameters.
"""

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from .config import settings


async def get_current_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")

    token = authorization[len("Bearer "):].strip()
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user identity")

    return user_id
