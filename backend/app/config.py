from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "DraftDeck API"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./data/draftdeck.db"
    frontend_origin: str = "http://localhost:3000"
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    lm_studio_base_url: str = "http://127.0.0.1:1234"
    llm_fast_model: str = "qwen2.5-7b-instruct"
    llm_deep_model: str = "mistral-small-3.1"
    lm_studio_timeout_seconds: float = 60.0
    jwt_secret_key: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    jwt_access_token_minutes: int = 20
    jwt_refresh_token_days: int = 14
    llm_mock: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
