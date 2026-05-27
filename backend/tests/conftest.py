"""
Set required environment variables before any app module is imported.

pydantic-settings reads from os.environ at Settings() instantiation time,
which happens when app.config is first imported. conftest.py is executed
by pytest before test modules, so these values are in place in time.
"""

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_SECRET_KEY", "placeholder-service-role-key")
# JWT secret must be at least 32 characters for HS256
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-at-least-32-chars-xxxxx")
os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:5173")
os.environ.setdefault("MAX_UPLOAD_BYTES", "52428800")
