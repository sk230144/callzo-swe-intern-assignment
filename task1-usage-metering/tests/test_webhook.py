"""The webhook contract: signatures, input validation and idempotency."""

import json

import pytest

from tests.conftest import get_usage, make_event, post_event, post_raw, sign


def count_events(conn) -> int:
    return conn.execute("SELECT count(*) AS total FROM raw_events").fetchone()["total"]


def test_valid_event_is_processed(client, conn):
    response = post_event(client, make_event())

    assert response.status_code == 200
    assert response.json()["status"] == "processed"
    assert get_usage(client)["cost_cents"] == 20


@pytest.mark.parametrize("signature", [None, "", "0" * 64, "not-hex"])
def test_bad_signature_is_rejected_before_storage(client, conn, signature):
    body = json.dumps(make_event()).encode()

    assert post_raw(client, body, signature).status_code == 401
    assert count_events(conn) == 0


def test_signature_covers_raw_bytes_not_parsed_json(client, conn):
    body = b'{ "event_id":"evt_spaced"  }'
    tampered = json.dumps(json.loads(body)).encode()

    assert post_raw(client, tampered, sign(body)).status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b'{"event_id": "evt_1", "event_ty',
        b"[]",
        b'{"event_id": "evt_only"}',
    ],
)
def test_malformed_body_with_valid_signature_is_rejected(client, conn, body):
    assert post_raw(client, body, sign(body)).status_code == 422
    assert count_events(conn) == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"event_type": "call.exploded"},
        {"duration_seconds": "not_a_number"},
        {"cost_cents": None},
        {"cost_cents": 1.5},
        {"cost_cents": -1},
        {"cost_cents": True},
        {"timestamp": "yesterday"},
        {"timestamp": "2026-11-01T10:15:30"},
        {"timestamp": "2099-01-01T00:00:00+00:00"},
        {"account_id": "acct'; DROP TABLE calls;--"},
    ],
)
def test_invalid_fields_are_rejected(client, conn, overrides):
    assert post_event(client, make_event(**overrides)).status_code == 422
    assert count_events(conn) == 0


def test_duplicate_event_is_counted_once(client, conn):
    event = make_event(cost_cents=30)

    responses = [post_event(client, event) for _ in range(3)]

    assert [r.json()["status"] for r in responses] == ["processed", "duplicate", "duplicate"]
    usage = get_usage(client)
    assert usage["cost_cents"] == 30
    assert usage["completed_calls"] == 1
    assert count_events(conn) == 1


def test_same_call_ended_under_new_event_id_is_counted_once(client, conn):
    call = make_event(cost_cents=30)

    post_event(client, call)
    post_event(client, call | {"event_id": "evt_resent", "cost_cents": 999})

    assert get_usage(client)["cost_cents"] == 30
