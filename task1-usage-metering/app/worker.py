"""Background worker: retries failed events and periodically reconciles usage.

Run with `python -m app.worker`. Safe to run several copies: `apply_event` skips
rows another process has locked.
"""

import signal
import threading
import time

import psycopg
import psycopg_pool
import structlog

from app.config import Settings, get_settings
from app.db import create_pool
from app.ingest import process_event
from app.logs import configure_logging
from app.reconcile import reconcile_usage

log = structlog.get_logger()


def retry_due_events(conn: psycopg.Connection, settings: Settings) -> int:
    """Attempt every pending event that is due. Returns the number attempted."""
    due = conn.execute(
        """
        SELECT event_id FROM raw_events
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT %s
        """,
        (settings.retry_batch_size,),
    ).fetchall()
    for row in due:
        process_event(conn, row["event_id"], settings)
    if due:
        log.info("retry.batch_finished", attempted=len(due))
    return len(due)


def run(settings: Settings, stop: threading.Event) -> None:
    pool = create_pool(settings, max_size=2)
    next_reconcile = time.monotonic() + settings.reconcile_interval_seconds
    log.info("worker.started")
    while not stop.is_set():
        try:
            with pool.connection() as conn:
                retry_due_events(conn, settings)
                if time.monotonic() >= next_reconcile:
                    reconcile_usage(conn)
                    next_reconcile = time.monotonic() + settings.reconcile_interval_seconds
        except (psycopg.Error, psycopg_pool.PoolTimeout):
            log.exception("worker.database_unavailable")
        stop.wait(settings.retry_poll_seconds)
    pool.close()
    log.info("worker.stopped")


def main() -> None:
    configure_logging()
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    run(get_settings(), stop)


if __name__ == "__main__":
    main()
