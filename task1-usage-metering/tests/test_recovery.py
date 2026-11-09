"""Failure handling: retries, dead events, reconciliation and API authentication."""

import pytest

from tests.conftest import API_KEY, get_usage, make_event, post_event

from app import ingest
from app.reconcile import reconcile_usage
from app.worker import retry_due_events

AUTH = {"Authorization": f"Bearer {API_KEY}"}


def status_of(conn, event_id: str) -> dict:
    return conn.execute(
        "SELECT status, attempts, last_error FROM raw_events WHERE event_id = %s", (event_id,)
    ).fetchone()


def make_due(conn) -> None:
    conn.execute("UPDATE raw_events SET next_attempt_at = now()")


@pytest.fixture
def failing_apply(monkeypatch):
    def explode(*_):
        raise RuntimeError("boom")

    monkeypatch.setattr(ingest, "_apply_by_type", explode)
    return monkeypatch


def test_failed_apply_is_accepted_and_retried_by_the_worker(client, conn, settings, monkeypatch):
    original = ingest._apply_by_type
    monkeypatch.setattr(ingest, "_apply_by_type", lambda *_: 1 / 0)
    event = make_event(cost_cents=20)

    response = post_event(client, event)

    assert response.status_code == 202
    assert status_of(conn, event["event_id"])["attempts"] == 1
    assert get_usage(client)["cost_cents"] == 0

    monkeypatch.setattr(ingest, "_apply_by_type", original)
    make_due(conn)
    assert retry_due_events(conn, settings) == 1

    assert status_of(conn, event["event_id"])["status"] == "processed"
    assert get_usage(client)["cost_cents"] == 20


def test_failure_rolls_back_partial_work(client, conn, monkeypatch):
    monkeypatch.setattr(ingest, "_detect_cap_crossing", lambda *_: 1 / 0)

    event = make_event(cost_cents=20)
    post_event(client, event)

    calls = conn.execute("SELECT count(*) AS total FROM calls").fetchone()["total"]
    assert calls == 0
    assert get_usage(client)["cost_cents"] == 0


def test_duplicate_of_a_failed_event_does_not_apply_it_twice(client, conn, settings, monkeypatch):
    original = ingest._apply_by_type
    monkeypatch.setattr(ingest, "_apply_by_type", lambda *_: 1 / 0)
    event = make_event(cost_cents=20)
    post_event(client, event)

    assert post_event(client, event).json()["status"] == "duplicate"

    monkeypatch.setattr(ingest, "_apply_by_type", original)
    make_due(conn)
    retry_due_events(conn, settings)
    assert get_usage(client)["cost_cents"] == 20


def test_event_is_dead_after_max_attempts(client, conn, settings, failing_apply):
    event = make_event()
    post_event(client, event)

    for _ in range(settings.retry_max_attempts - 1):
        make_due(conn)
        retry_due_events(conn, settings)

    assert status_of(conn, event["event_id"])["status"] == "dead"
    make_due(conn)
    assert retry_due_events(conn, settings) == 0


def test_worker_ignores_events_not_yet_due(client, conn, settings, failing_apply):
    post_event(client, make_event())

    assert retry_due_events(conn, settings) == 0


def test_applying_twice_has_no_extra_effect(client, conn, settings):
    event = make_event(cost_cents=20)
    post_event(client, event)

    assert ingest.apply_event(conn, event["event_id"], settings) is None
    assert get_usage(client)["cost_cents"] == 20


def test_reconcile_finds_nothing_on_correct_data(client, conn):
    post_event(client, make_event(cost_cents=20))

    report = reconcile_usage(conn)

    assert report.rows_checked == 1
    assert report.drift == []


def test_reconcile_repairs_drift(client, conn):
    post_event(client, make_event(cost_cents=20))
    conn.execute("UPDATE usage_monthly SET cost_cents = 9999, completed_calls = 7")

    report = reconcile_usage(conn)

    assert report.drift[0].stored_cost_cents == 9999
    assert report.drift[0].recomputed_cost_cents == 20
    usage = get_usage(client)
    assert usage["cost_cents"] == 20
    assert usage["completed_calls"] == 1
    assert reconcile_usage(conn).drift == []


def test_reconcile_rebuilds_a_deleted_row(client, conn):
    post_event(client, make_event(cost_cents=20))
    conn.execute("DELETE FROM usage_monthly")

    reconcile_usage(conn)

    assert get_usage(client)["cost_cents"] == 20


def test_reconcile_leaves_pending_events_for_the_worker(client, conn, settings, monkeypatch):
    original = ingest._apply_by_type
    monkeypatch.setattr(ingest, "_apply_by_type", lambda *_: 1 / 0)
    post_event(client, make_event(cost_cents=20))
    monkeypatch.setattr(ingest, "_apply_by_type", original)

    report = reconcile_usage(conn)
    assert report.unprocessed_events == 1

    make_due(conn)
    retry_due_events(conn, settings)
    assert get_usage(client)["cost_cents"] == 20


def test_reconcile_endpoint(client, conn):
    response = client.post("/v1/admin/reconcile", headers=AUTH)

    assert response.status_code == 200
    assert response.json()["drift"] == []


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/accounts/acct_001/usage"),
        ("GET", "/v1/review/late-events"),
        ("POST", "/v1/admin/reconcile"),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_api_requires_a_valid_key(client, method, path, headers):
    assert client.request(method, path, headers=headers).status_code == 401


@pytest.mark.parametrize(
    "path",
    [
        "/v1/accounts/acct_001/usage?month=2026-13",
        "/v1/accounts/acct_001/usage?month=nope",
        "/v1/accounts/bad%20id/usage",
        "/v1/review/late-events?limit=0",
        "/v1/review/late-events?offset=-1",
    ],
)
def test_api_validates_input(client, path):
    assert client.get(path, headers=AUTH).status_code == 422


def test_health_reports_ok(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_metrics_expose_counters_and_event_status(client, conn):
    post_event(client, make_event())

    text = client.get("/metrics").text

    assert 'webhook_requests_total{outcome="processed"}' in text
    assert 'raw_events{status="processed"} 1.0' in text
