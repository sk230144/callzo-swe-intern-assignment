"""Validated shapes for data entering and leaving the API."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, StrictInt, field_validator

# Tolerates clock drift at the provider without letting a bad timestamp
# create usage in a future month.
MAX_FUTURE_SKEW = timedelta(hours=1)

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
NonNegativeInt = Annotated[StrictInt, Field(ge=0, le=2_000_000_000)]


class WebhookEvent(BaseModel):
    event_id: Identifier
    event_type: Literal["call.started", "call.ended", "call.failed"]
    account_id: Identifier
    call_id: Identifier
    timestamp: AwareDatetime
    duration_seconds: NonNegativeInt
    cost_cents: NonNegativeInt
    destination_country: Annotated[str, Field(min_length=2, max_length=8)]

    @field_validator("timestamp")
    @classmethod
    def not_in_the_future(cls, value: datetime) -> datetime:
        if value > datetime.now(UTC) + MAX_FUTURE_SKEW:
            raise ValueError("timestamp is too far in the future")
        return value


class WebhookResponse(BaseModel):
    status: Literal["processed", "duplicate", "accepted"]
    event_id: str
    call_action: Literal["allow", "reject"] | None = None


class LateUsage(BaseModel):
    calls: int
    cost_cents: int


class UsageResponse(BaseModel):
    account_id: str
    month: str
    cap_cents: int
    cost_cents: int
    remaining_cents: int
    overage_cents: int
    blocking_new_calls: bool
    completed_calls: int
    duration_seconds: int
    blocked_calls: int
    late: LateUsage


class LateEvent(BaseModel):
    event_id: str
    account_id: str
    call_id: str
    occurred_at: datetime
    received_at: datetime
    duration_seconds: int
    cost_cents: int


class LateEventsResponse(BaseModel):
    data: list[LateEvent]
    limit: int
    offset: int


class DriftEntry(BaseModel):
    account_id: str
    month: str
    stored_cost_cents: int
    recomputed_cost_cents: int


class ReconcileResponse(BaseModel):
    rows_checked: int
    drift: list[DriftEntry]
    unprocessed_events: int
