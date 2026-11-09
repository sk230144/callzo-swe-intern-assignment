"""Runtime configuration, read from the environment.

Secrets have no default on purpose: the process refuses to start without them.
"""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: SecretStr
    webhook_secret: SecretStr
    api_key: SecretStr

    monthly_cap_cents: int = Field(default=500, ge=0)
    month_grace_days: int = Field(default=3, ge=0)

    retry_poll_seconds: float = Field(default=2, gt=0)
    retry_base_seconds: int = Field(default=5, gt=0)
    retry_max_seconds: int = Field(default=3600, gt=0)
    retry_max_attempts: int = Field(default=8, gt=0)
    retry_batch_size: int = Field(default=100, gt=0)
    reconcile_interval_seconds: int = Field(default=3600, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
