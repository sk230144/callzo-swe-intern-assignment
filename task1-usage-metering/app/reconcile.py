"""Recompute `usage_monthly` from `raw_events` and repair any drift."""

from dataclasses import astuple, dataclass

import psycopg
import structlog

from app.models import DriftEntry, ReconcileResponse

log = structlog.get_logger()

# One row per call: the first call.ended received wins, as it does in apply_event.
RECOMPUTE_SQL = """
    SELECT
        account_id,
        date_trunc('month', occurred_at AT TIME ZONE 'UTC')::date AS month,
        count(*) FILTER (WHERE NOT needs_review)::int AS completed_calls,
        coalesce(sum(duration_seconds) FILTER (WHERE NOT needs_review), 0)::bigint
            AS duration_seconds,
        coalesce(sum(cost_cents) FILTER (WHERE NOT needs_review), 0)::bigint AS cost_cents,
        count(*) FILTER (WHERE needs_review)::int AS late_calls,
        coalesce(sum(cost_cents) FILTER (WHERE needs_review), 0)::bigint AS late_cost_cents
    FROM (
        SELECT DISTINCT ON (call_id) *
        FROM raw_events
        WHERE event_type = 'call.ended' AND status = 'processed'
        ORDER BY call_id, received_at, event_id
    ) AS first_end
    GROUP BY 1, 2
"""


@dataclass(frozen=True)
class Totals:
    completed_calls: int = 0
    duration_seconds: int = 0
    cost_cents: int = 0
    late_calls: int = 0
    late_cost_cents: int = 0


def reconcile_usage(conn: psycopg.Connection) -> ReconcileResponse:
    """Make `usage_monthly` match the raw events, reporting every difference.

    Only processed events count: a pending event's usage is added when it is
    applied, so counting it here as well would double it.
    """
    with conn.transaction():
        # Blocks usage writers but not readers. A writer that got here first
        # commits before this runs, so the recompute below sees its event.
        conn.execute("LOCK TABLE usage_monthly IN EXCLUSIVE MODE")
        recomputed = _totals_by_key(conn.execute(RECOMPUTE_SQL).fetchall())
        stored = _totals_by_key(conn.execute("SELECT * FROM usage_monthly").fetchall())

        drift = []
        for key in recomputed.keys() | stored.keys():
            expected = recomputed.get(key, Totals())
            if expected != stored.get(key, Totals()):
                _write_totals(conn, key, expected)
                drift.append(_drift_entry(key, stored.get(key, Totals()), expected))

        unprocessed = conn.execute(
            "SELECT count(*) AS total FROM raw_events WHERE status <> 'processed'"
        ).fetchone()["total"]

    report = ReconcileResponse(
        rows_checked=len(recomputed.keys() | stored.keys()),
        drift=drift,
        unprocessed_events=unprocessed,
    )
    log.info(
        "reconcile.finished",
        rows_checked=report.rows_checked,
        drift_rows=len(drift),
        unprocessed_events=unprocessed,
    )
    return report


def _totals_by_key(rows: list[dict]) -> dict[tuple, Totals]:
    return {
        (row["account_id"], row["month"]): Totals(
            completed_calls=row["completed_calls"],
            duration_seconds=row["duration_seconds"],
            cost_cents=row["cost_cents"],
            late_calls=row["late_calls"],
            late_cost_cents=row["late_cost_cents"],
        )
        for row in rows
    }


def _write_totals(conn: psycopg.Connection, key: tuple, totals: Totals) -> None:
    conn.execute(
        """
        INSERT INTO usage_monthly (
            account_id, month, completed_calls, duration_seconds,
            cost_cents, late_calls, late_cost_cents
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (account_id, month) DO UPDATE
        SET completed_calls = EXCLUDED.completed_calls,
            duration_seconds = EXCLUDED.duration_seconds,
            cost_cents = EXCLUDED.cost_cents,
            late_calls = EXCLUDED.late_calls,
            late_cost_cents = EXCLUDED.late_cost_cents
        """,
        (*key, *astuple(totals)),
    )


def _drift_entry(key: tuple, stored: Totals, expected: Totals) -> DriftEntry:
    account_id, month = key
    log.warning(
        "reconcile.drift_repaired",
        account_id=account_id,
        month=month.isoformat(),
        stored_cost_cents=stored.cost_cents,
        recomputed_cost_cents=expected.cost_cents,
    )
    return DriftEntry(
        account_id=account_id,
        month=month.strftime("%Y-%m"),
        stored_cost_cents=stored.cost_cents,
        recomputed_cost_cents=expected.cost_cents,
    )
