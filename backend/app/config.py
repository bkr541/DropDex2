from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_secret_key: str
    supabase_jwt_secret: str | None = None  # HS256 legacy/test only; ES256 uses JWKS
    frontend_origin: str = "http://127.0.0.1:3000"
    max_upload_bytes: int = 52_428_800  # 50 MB

    # Set to "production" via ENVIRONMENT env var to suppress detailed errors.
    environment: str = "development"

    # ── 1001Tracklists discovery scraper ──────────────────────────────────────
    tracklists_scraper_headless: bool = True
    tracklists_scraper_navigation_timeout_ms: int = 30_000
    tracklists_scraper_delay_ms: int = 1_000
    tracklists_scraper_max_pages: int = 50

    # ── 1001Tracklists detail page scraper ────────────────────────────────────
    # Separate, shorter timeouts so a stalled ad resource does not cause a 30 s
    # failure; the detail scraper waits for specific DOM elements, not full load.
    tracklists_detail_nav_timeout_ms: int = 15_000
    tracklists_detail_selector_timeout_ms: int = 20_000
    tracklists_detail_network_idle_timeout_ms: int = 3_000


settings = Settings()
