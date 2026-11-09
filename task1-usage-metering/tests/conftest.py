"""Tests run against real Postgres: the guarantees under test live in its transactions."""

import hashlib
import hmac
import json
import os
import uuid
from datetime import UTC, datetime

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

TEST_DATABASE_URL = os.environ["TEST_DATABASE_URL"]
WEBHOOK_SECRET = "test-webhook-secret"
API_KEY = "test-api-key"
TEST_CAP_CENTS = 500

os.environ.update(
    DATABASE_URL=TEST_DATABASE_URL,
    WEBHOOK_SECRET=WEBHOOK_SECRET,
    API_KEY=API_KEY,
    MONTHLY_CAP_CENTS=str(TEST_CAP_CENTS),
    MONTH_GRACE_DAYS="3",
)

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402


def _ensure_test_database() -> None:
    name = conninfo_to_dict(TEST_DATABASE_URL)["dbname"]
    admin = make_conninfo(TEST_DATABASE_URL, dbname="postgres")
    with psycopg.connect(admin, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))


@pytest.fixture(scope="session")
def client():
    _ensure_test_database()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def conn(client):
    with client.app.state.pool.connection() as connection:
        connection.execute("TRUNCATE raw_events, calls, usage_monthly")
        yield connection


def make_event(**overrides) -> dict:
    event = {
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "event_type": "call.ended",
        "account_id": "acct_001",
        "call_id": f"call_{uuid.uuid4().hex[:12]}",
        "timestamp": datetime.now(UTC).isoformat(),
        "duration_seconds": 600,
        "cost_cents": 20,
        "destination_country": "US",
    }
    return event | overrides


def sign(body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def post_raw(client, body: bytes, signature: str | None):
    headers = {"content-type": "application/json"}
    if signature is not None:
        headers["x-signature"] = signature
    return client.post("/webhooks/calls", content=body, headers=headers)


def post_event(client, event: dict):
    body = json.dumps(event).encode()
    return post_raw(client, body, sign(body))


def get_usage(client, account_id: str = "acct_001", month: str | None = None) -> dict:
    response = client.get(
        f"/v1/accounts/{account_id}/usage",
        params={"month": month} if month else None,
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    assert response.status_code == 200
    return response.json()
