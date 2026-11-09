"""Turning stored events into call state and monthly usage.

Ingestion is two steps, each its own transaction:

1. `store_event` durably records the event. Once this commits, the event cannot be lost.
2. `apply_event` updates `calls` and `usage_monthly` and marks the event processed,
   atomically. A failure rolls all of that back and the worker retries it later.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

import psycopg
import structlog

from app.config import Settings
from app.metrics import CAP_CROSSINGS
from app.models import WebhookEvent
from app.periods import is_month_closed, month_of

log = structlog.get_logger()

# The API applies events inline, so the worker must not race it on the happy path.
FIRST_RETRY_DELAY = timedelta(seconds=30)

CallAction = Literal["allow", "reject"]


@dataclass(frozen=True)
class Applied:
    call_action: CallAction | None = None


def store_event(
    conn: psycopg.Connection,
    event: WebhookEvent,
    received_at: datetime,
    settings: Settings,
) -> bool:
    """Record an event. Returns False if this event_id was already stored."""
    needs_review = is_month_closed(
        month_of(event.timestamp), received_at, settings.month_grace_days
    )
    row = conn.execute(
        """
        INSERT INTO raw_events (
            event_id, event_type, account_id, call_id, occurred_at, duration_seconds,
            cost_cents, destination_country, received_at, needs_review, next_attempt_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
        """,
        (
            event.event_id,
            event.event_type,
            event.account_id,
            event.call_id,
            event.timestamp,
            event.duration_seconds,
            event.cost_cents,
            event.destination_country,
            received_at,
            needs_review,
            received_at + FIRST_RETRY_DELAY,
        ),
    ).fetchone()
    return row is not None


def apply_event(conn: psycopg.Connection, event_id: str, settings: Settings) -> Applied | None:
    """Apply a pending event exactly once.

    Returns None if there is nothing to do: already applied, or another
    process holds the row right now.
    """
    with conn.transaction():
        event = conn.execute(
            """
            SELECT * FROM raw_events
            WHERE event_id = %s AND status = 'pending'
            FOR UPDATE SKIP LOCKED
            """,
            (event_id,),
        ).fetchone()
        if event is None:
            return None

        applied = _apply_by_type(conn, event, settings.monthly_cap_cents)

        conn.execute(
            """
            UPDATE raw_events
            SET status = 'processed', processed_at = now(), last_error = NULL
            WHERE event_id = %s
            """,
            (event_id,),
        )
    log.info("event.applied", event_id=event_id, event_type=event["event_type"])
    return applied


def process_event(
    conn: psycopg.Connection, event_id: str, settings: Settings
) -> tuple[bool, Applied | None]:
    """Apply an event, scheduling a retry on failure. Returns (succeeded, result)."""
    try:
        return True, apply_event(conn, event_id, settings)
    except Exception as exc:
        log.exception("event.apply_failed", event_id=event_id)
        _record_failure(conn, event_id, exc, settings)
        return False, None


def _record_failure(
    conn: psycopg.Connection, event_id: str, exc: Exception, settings: Settings
) -> None:
    try:
        row = conn.execute(
            """
            UPDATE raw_events
            SET attempts = attempts + 1,
                last_error = %(error)s,
                next_attempt_at = now() + make_interval(
                    secs => LEAST(%(base)s * power(2, attempts), %(max)s)
                ),
                status = CASE WHEN attempts + 1 >= %(limit)s THEN 'dead' ELSE status END
            WHERE event_id = %(event_id)s AND status = 'pending'
            RETURNING status, attempts
            """,
            {
                "error": repr(exc)[:500],
                "base": settings.retry_base_seconds,
                "max": settings.retry_max_seconds,
                "limit": settings.retry_max_attempts,
                "event_id": event_id,
            },
        ).fetchone()
    except psycopg.Error:
        # The event stays pending with its existing next_attempt_at, so it is still retried.
        log.exception("event.record_failure_failed", event_id=event_id)
        return
    if row and row["status"] == "dead":
        log.error("event.dead", event_id=event_id, attempts=row["attempts"])


def _apply_by_type(conn: psycopg.Connection, event: dict, cap_cents: int) -> Applied:
    month = month_of(event["occurred_at"])
    # Taken first, for every event type, so that the cap check and the usage
    # increment for one account never interleave.
    used_cents = _lock_usage_row(conn, event["account_id"], month)

    if event["event_type"] == "call.started":
        return _apply_started(conn, event, used_cents, cap_cents)
    if event["event_type"] == "call.ended":
        _apply_ended(conn, event, month, used_cents, cap_cents)
    else:
        _apply_failed(conn, event)
    return Applied()


def _lock_usage_row(conn: psycopg.Connection, account_id: str, month: date) -> int:
    row = conn.execute(
        """
        INSERT INTO usage_monthly (account_id, month) VALUES (%s, %s)
        ON CONFLICT (account_id, month) DO UPDATE SET account_id = EXCLUDED.account_id
        RETURNING cost_cents
        """,
        (account_id, month),
    ).fetchone()
    return row["cost_cents"]


def _apply_started(
    conn: psycopg.Connection, event: dict, used_cents: int, cap_cents: int
) -> Applied:
    wants_block = used_cents >= cap_cents and not event["needs_review"]
    # On conflict the call is already known (call.ended overtook this event), so
    # it has already happened: only fill in started_at and keep its status.
    row = conn.execute(
        """
        INSERT INTO calls (call_id, account_id, status, started_at, blocked)
        VALUES (%s, %s, 'started', %s, %s)
        ON CONFLICT (call_id) DO UPDATE SET started_at = EXCLUDED.started_at
        RETURNING blocked
        """,
        (event["call_id"], event["account_id"], event["occurred_at"], wants_block),
    ).fetchone()
    if row["blocked"]:
        log.warning(
            "call.blocked",
            account_id=event["account_id"],
            call_id=event["call_id"],
            used_cents=used_cents,
            cap_cents=cap_cents,
        )
    return Applied(call_action="reject" if row["blocked"] else "allow")


def _apply_ended(
    conn: psycopg.Connection, event: dict, month: date, used_cents: int, cap_cents: int
) -> None:
    # The WHERE clause makes the first call.ended the only one that counts, even
    # if the provider re-sends it under a new event_id.
    first_end = conn.execute(
        """
        INSERT INTO calls (call_id, account_id, status, finished_at, duration_seconds, cost_cents)
        VALUES (%s, %s, 'ended', %s, %s, %s)
        ON CONFLICT (call_id) DO UPDATE
        SET status = 'ended',
            finished_at = EXCLUDED.finished_at,
            duration_seconds = EXCLUDED.duration_seconds,
            cost_cents = EXCLUDED.cost_cents
        WHERE calls.status <> 'ended'
        RETURNING call_id
        """,
        (
            event["call_id"],
            event["account_id"],
            event["occurred_at"],
            event["duration_seconds"],
            event["cost_cents"],
        ),
    ).fetchone()
    if first_end is None:
        log.warning("call.repeat_end_ignored", call_id=event["call_id"], event_id=event["event_id"])
        return

    if event["needs_review"]:
        _add_late_usage(conn, event, month)
    else:
        _add_usage(conn, event, month)
        _detect_cap_crossing(event, used_cents, cap_cents)


def _add_usage(conn: psycopg.Connection, event: dict, month: date) -> None:
    conn.execute(
        """
        UPDATE usage_monthly
        SET completed_calls = completed_calls + 1,
            duration_seconds = duration_seconds + %s,
            cost_cents = cost_cents + %s
        WHERE account_id = %s AND month = %s
        """,
        (event["duration_seconds"], event["cost_cents"], event["account_id"], month),
    )


def _add_late_usage(conn: psycopg.Connection, event: dict, month: date) -> None:
    conn.execute(
        """
        UPDATE usage_monthly
        SET late_calls = late_calls + 1, late_cost_cents = late_cost_cents + %s
        WHERE account_id = %s AND month = %s
        """,
        (event["cost_cents"], event["account_id"], month),
    )
    log.warning(
        "event.flagged_for_review",
        event_id=event["event_id"],
        account_id=event["account_id"],
        month=month.isoformat(),
        cost_cents=event["cost_cents"],
    )


def _detect_cap_crossing(event: dict, used_cents: int, cap_cents: int) -> None:
    total_cents = used_cents + event["cost_cents"]
    if used_cents < cap_cents <= total_cents:
        CAP_CROSSINGS.inc()
        log.warning(
            "cap.crossed",
            account_id=event["account_id"],
            total_cents=total_cents,
            cap_cents=cap_cents,
        )


def _apply_failed(conn: psycopg.Connection, event: dict) -> None:
    # A call.ended carries a cost, so it outranks a failure regardless of arrival order.
    conn.execute(
        """
        INSERT INTO calls (call_id, account_id, status, finished_at)
        VALUES (%s, %s, 'failed', %s)
        ON CONFLICT (call_id) DO UPDATE
        SET status = 'failed', finished_at = EXCLUDED.finished_at
        WHERE calls.status <> 'ended'
        """,
        (event["call_id"], event["account_id"], event["occurred_at"]),
    )
