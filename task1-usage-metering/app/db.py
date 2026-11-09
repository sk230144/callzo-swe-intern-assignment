"""Postgres connection pool and schema setup."""

from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import Settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Arbitrary constant: stops two processes applying the schema at the same time.
SCHEMA_LOCK_ID = 7_140_001


def create_pool(settings: Settings, max_size: int = 10) -> ConnectionPool:
    """Open a pool of autocommit connections.

    Autocommit means multi-statement work must use an explicit
    `conn.transaction()` block, so transaction boundaries are visible in the code.
    """
    return ConnectionPool(
        settings.database_url.get_secret_value(),
        min_size=1,
        max_size=max_size,
        timeout=5,
        check=ConnectionPool.check_connection,
        kwargs={"autocommit": True, "row_factory": dict_row},
        open=True,
    )


def apply_schema(pool: ConnectionPool) -> None:
    with pool.connection() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (SCHEMA_LOCK_ID,))
        conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
