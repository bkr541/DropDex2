from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_secret_key: str
    supabase_jwt_secret: str | None = None  # HS256 legacy/test only; ES256 uses JWKS
    frontend_origin: str = "http://127.0.0.1:3000"
    max_upload_bytes: int = 52_428_800  # 50 MB (legacy alias — prefer max_rekordbox_db_upload_bytes)

    # ── Analysis file upload limits ───────────────────────────────────────────
    max_rekordbox_db_upload_bytes: int = 52_428_800    # 50 MB  — exportLibrary.db
    max_analysis_file_bytes: int = 10_485_760          # 10 MB  — single DAT/EXT/2EX file
    max_analysis_batch_bytes: int = 104_857_600        # 100 MB — total per analysis-batch request
    max_analysis_files_per_batch: int = 100            # max ANLZ files in one batch request
    max_bundle_upload_bytes: int = 209_715_200         # 200 MB — ZIP bundle upload
    max_bundle_uncompressed_bytes: int = 524_288_000   # 500 MB — ZIP decompressed total
    max_bundle_entries: int = 10_000                   # max entries inside ZIP

    # Set to "production" via ENVIRONMENT env var to suppress detailed errors.
    environment: str = "development"

    # ── 1001Tracklists discovery scraper ──────────────────────────────────────
    tracklists_scraper_headless: bool = True
    tracklists_scraper_navigation_timeout_ms: int = 30_000
    tracklists_scraper_delay_ms: int = 1_000
    tracklists_scraper_max_pages: int = 50
    discovery_job_heartbeat_seconds: int = 15
    discovery_job_reaper_seconds: int = 30
    discovery_job_stale_minutes: int = 3

    # ── 1001Tracklists detail page scraper ────────────────────────────────────
    # Separate, shorter timeouts so a stalled ad resource does not cause a 30 s
    # failure; the detail scraper waits for specific DOM elements, not full load.
    tracklists_detail_nav_timeout_ms: int = 15_000
    tracklists_detail_selector_timeout_ms: int = 20_000
    tracklists_detail_network_idle_timeout_ms: int = 3_000


settings = Settings()
