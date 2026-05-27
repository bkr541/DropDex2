from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_secret_key: str
    supabase_jwt_secret: str
    frontend_origin: str = "http://localhost:5173"
    max_upload_bytes: int = 52_428_800  # 50 MB


settings = Settings()
