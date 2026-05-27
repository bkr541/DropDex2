from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_secret_key: str
    supabase_jwt_secret: str | None = None  # HS256 legacy/test only; ES256 uses JWKS
    frontend_origin: str = "http://127.0.0.1:3000"
    max_upload_bytes: int = 52_428_800  # 50 MB


settings = Settings()
