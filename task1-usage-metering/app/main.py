"""HTTP surface of the usage metering service."""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Annotated

import psycopg
import psycopg_pool
import structlog
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import ValidationError

from app.config import get_settings
from app.db import apply_schema, create_pool
from app.ingest import process_event, store_event
from app.logs import configure_logging
from app.metrics import EVENTS_BY_STATUS, WEBHOOK_REQUESTS
from app.models import (
    LateEventsResponse,
    LateUsage,
    ReconcileResponse,
    UsageResponse,
    WebhookEvent,
    WebhookResponse,
)
from app.periods import month_of, next_month
from app.reconcile import reconcile_usage
from app.security import SettingsDep, require_api_key, verified_body

log = structlog.get_logger()

AccountId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
MonthParam = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    app.state.pool = create_pool(get_settings())
    apply_schema(app.state.pool)
    log.info("api.started")
    yield
    app.state.pool.close()


app = FastAPI(title="Callzo usage metering", lifespan=lifespan)


def get_conn(request: Request) -> Iterator[psycopg.Connection]:
    with request.app.state.pool.connection() as conn:
        yield conn


Conn = Annotated[psycopg.Connection, Depends(get_conn)]
Authenticated = Depends(require_api_key)


@app.exception_handler(psycopg.OperationalError)
@app.exception_handler(psycopg_pool.PoolTimeout)
def database_unavailable(_: Request, exc: Exception) -> JSONResponse:
    log.error("database.unavailable", error=repr(exc))
    return JSONResponse({"detail": "Database unavailable"}, status.HTTP_503_SERVICE_UNAVAILABLE)


@app.post("/webhooks/calls", response_model=WebhookResponse, response_model_exclude_none=True)
def receive_call_event(
    body: Annotated[bytes, Depends(verified_body)],
    conn: Conn,
    settings: SettingsDep,
    response: Response,
) -> WebhookResponse:
    event = _parse_event(body)

    if not store_event(conn, event, datetime.now(UTC), settings):
        WEBHOOK_REQUESTS.labels(outcome="duplicate").inc()
        log.info("event.duplicate", event_id=event.event_id)
        return WebhookResponse(status="duplicate", event_id=event.event_id)

    succeeded, applied = process_event(conn, event.event_id, settings)
    if not succeeded or applied is None:
        # Stored durably, so the provider must not resend: the worker finishes it.
        WEBHOOK_REQUESTS.labels(outcome="accepted").inc()
        response.status_code = status.HTTP_202_ACCEPTED
        return WebhookResponse(status="accepted", event_id=event.event_id)

    WEBHOOK_REQUESTS.labels(outcome="processed").inc()
    return WebhookResponse(
        status="processed", event_id=event.event_id, call_action=applied.call_action
    )


def _parse_event(body: bytes) -> WebhookEvent:
    try:
        return WebhookEvent.model_validate_json(body)
    except ValidationError as exc:
        WEBHOOK_REQUESTS.labels(outcome="invalid").inc()
        errors = exc.errors(include_url=False, include_input=False, include_context=False)
        log.warning("webhook.invalid_payload", errors=errors)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, errors) from exc


@app.get(
    "/v1/accounts/{account_id}/usage",
    response_model=UsageResponse,
    dependencies=[Authenticated],
)
def get_account_usage(
    account_id: AccountId, conn: Conn, settings: SettingsDep, month: MonthParam = None
) -> UsageResponse:
    period = date.fromisoformat(f"{month}-01") if month else month_of(datetime.now(UTC))
    usage = conn.execute(
        "SELECT * FROM usage_monthly WHERE account_id = %s AND month = %s",
        (account_id, period),
    ).fetchone() or {}
    blocked_calls = conn.execute(
        """
        SELECT count(*) AS total FROM calls
        WHERE account_id = %s AND blocked AND started_at >= %s AND started_at < %s
        """,
        (account_id, period, next_month(period)),
    ).fetchone()["total"]

    cap = settings.monthly_cap_cents
    cost = usage.get("cost_cents", 0)
    return UsageResponse(
        account_id=account_id,
        month=period.strftime("%Y-%m"),
        cap_cents=cap,
        cost_cents=cost,
        remaining_cents=max(cap - cost, 0),
        overage_cents=max(cost - cap, 0),
        blocking_new_calls=cost >= cap,
        completed_calls=usage.get("completed_calls", 0),
        duration_seconds=usage.get("duration_seconds", 0),
        blocked_calls=blocked_calls,
        late=LateUsage(
            calls=usage.get("late_calls", 0),
            cost_cents=usage.get("late_cost_cents", 0),
        ),
    )


@app.get("/v1/review/late-events", response_model=LateEventsResponse, dependencies=[Authenticated])
def list_late_events(
    conn: Conn,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> LateEventsResponse:
    rows = conn.execute(
        """
        SELECT event_id, account_id, call_id, occurred_at, received_at,
               duration_seconds, cost_cents
        FROM raw_events
        WHERE needs_review AND event_type = 'call.ended'
        ORDER BY received_at DESC, event_id
        LIMIT %s OFFSET %s
        """,
        (limit, offset),
    ).fetchall()
    return LateEventsResponse(data=rows, limit=limit, offset=offset)


@app.post("/v1/admin/reconcile", response_model=ReconcileResponse, dependencies=[Authenticated])
def run_reconciliation(conn: Conn) -> ReconcileResponse:
    return reconcile_usage(conn)


@app.get("/health")
def health(conn: Conn) -> dict[str, str]:
    conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/metrics")
def metrics(conn: Conn) -> Response:
    counts = conn.execute("SELECT status, count(*) AS total FROM raw_events GROUP BY status")
    totals = {row["status"]: row["total"] for row in counts}
    for event_status in ("pending", "processed", "dead"):
        EVENTS_BY_STATUS.labels(status=event_status).set(totals.get(event_status, 0))
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
