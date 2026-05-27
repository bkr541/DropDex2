from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_secret_key: str
    supabase_jwt_secret: str | None = None  # HS256 legacy/test only; ES256 uses JWKS
    frontend_origin: str = "http://127.0.0.1:3000"
    max_upload_bytes: int = 52_428_800  # 50 MB

    # ── 1001Tracklists discovery scraper ──────────────────────────────────────
    tracklists_scraper_headless: bool = True
    tracklists_scraper_navigation_timeout_ms: int = 30_000
    tracklists_scraper_delay_ms: int = 1_000
    tracklists_scraper_max_pages: int = 50


settings = Settings()
