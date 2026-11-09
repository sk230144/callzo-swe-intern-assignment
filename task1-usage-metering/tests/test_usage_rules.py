"""Business rules: event ordering, late events and the monthly cap."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from tests.conftest import TEST_CAP_CENTS, get_usage, make_event, post_event

from app.periods import is_month_closed, month_of


def get_call(conn, call_id: str) -> dict:
    return conn.execute("SELECT * FROM calls WHERE call_id = %s", (call_id,)).fetchone()


def started(call_id: str, **overrides) -> dict:
    fields = {"event_type": "call.started", "call_id": call_id, "cost_cents": 0}
    return make_event(**fields, duration_seconds=0, **overrides)


def spend(client, cents: int, account_id: str = "acct_001") -> None:
    post_event(client, make_event(cost_cents=cents, account_id=account_id))


def two_months_ago() -> datetime:
    first_of_month = datetime.now(UTC).replace(day=1)
    return (first_of_month - timedelta(days=40)).replace(day=15)


def test_ended_before_started_reaches_the_same_state(client, conn):
    ended_at = datetime.now(UTC)
    started_at = ended_at - timedelta(minutes=10)
    ended = make_event(call_id="call_ooo", cost_cents=20, timestamp=ended_at.isoformat())

    post_event(client, ended)
    post_event(client, started("call_ooo", timestamp=started_at.isoformat()))

    call = get_call(conn, "call_ooo")
    assert call["status"] == "ended"
    assert call["started_at"] == started_at
    assert call["cost_cents"] == 20
    assert get_usage(client)["cost_cents"] == 20


def test_failed_call_adds_no_usage(client, conn):
    post_event(client, started("call_f"))
    post_event(client, make_event(event_type="call.failed", call_id="call_f", cost_cents=0))

    assert get_call(conn, "call_f")["status"] == "failed"
    assert get_usage(client)["completed_calls"] == 0


def test_failed_event_does_not_overwrite_ended_call(client, conn):
    post_event(client, make_event(call_id="call_x"))
    post_event(client, make_event(event_type="call.failed", call_id="call_x", cost_cents=0))

    assert get_call(conn, "call_x")["status"] == "ended"


def test_event_after_grace_is_flagged_and_excluded_from_billed_usage(client, conn):
    occurred = two_months_ago()
    month = occurred.strftime("%Y-%m")

    post_event(client, make_event(cost_cents=40, timestamp=occurred.isoformat()))

    usage = get_usage(client, month=month)
    assert usage["cost_cents"] == 0
    assert usage["late"] == {"calls": 1, "cost_cents": 40}
    assert get_usage(client)["cost_cents"] == 0


def test_late_events_are_listed_for_review(client, conn):
    event = make_event(cost_cents=40, timestamp=two_months_ago().isoformat())
    post_event(client, event)

    response = client.get(
        "/v1/review/late-events", headers={"Authorization": "Bearer test-api-key"}
    )

    assert [row["event_id"] for row in response.json()["data"]] == [event["event_id"]]


def test_month_closes_exactly_when_grace_ends():
    month = month_of(datetime(2026, 10, 15, tzinfo=UTC))
    closes_at = datetime(2026, 11, 4, tzinfo=UTC)

    assert not is_month_closed(month, closes_at - timedelta(microseconds=1), grace_days=3)
    assert is_month_closed(month, closes_at, grace_days=3)


def test_december_rolls_over_to_january():
    december = month_of(datetime(2026, 12, 31, tzinfo=UTC))

    assert not is_month_closed(december, datetime(2027, 1, 3, tzinfo=UTC), grace_days=3)
    assert is_month_closed(december, datetime(2027, 1, 4, tzinfo=UTC), grace_days=3)


def test_month_uses_utc_not_the_timestamps_own_offset():
    just_after_midnight_ist = datetime.fromisoformat("2026-11-01T00:30:00+05:30")

    assert month_of(just_after_midnight_ist).month == 10


def test_call_below_the_cap_is_allowed(client, conn):
    spend(client, TEST_CAP_CENTS - 1)

    response = post_event(client, started("call_ok"))

    assert response.json()["call_action"] == "allow"
    assert get_usage(client)["blocking_new_calls"] is False


def test_call_exactly_at_the_cap_is_rejected(client, conn):
    spend(client, TEST_CAP_CENTS)

    response = post_event(client, started("call_at_cap"))

    usage = get_usage(client)
    assert response.status_code == 200
    assert response.json()["call_action"] == "reject"
    assert usage["remaining_cents"] == 0
    assert usage["overage_cents"] == 0
    assert usage["blocked_calls"] == 1


def test_call_in_progress_when_cap_is_crossed_is_billed_in_full(client, conn):
    spend(client, TEST_CAP_CENTS - 1)

    spend(client, 50)

    usage = get_usage(client)
    assert usage["cost_cents"] == TEST_CAP_CENTS + 49
    assert usage["overage_cents"] == 49


def test_cap_engages_partway_through_a_burst(client, conn):
    actions = []
    for index in range(40):
        call_id = f"call_burst_{index}"
        actions.append(post_event(client, started(call_id)).json()["call_action"])
        post_event(client, make_event(call_id=call_id, cost_cents=20))

    assert actions[:25] == ["allow"] * 25
    assert actions[25:] == ["reject"] * 15
    assert get_usage(client)["blocked_calls"] == 15


def test_cap_applies_per_account(client, conn):
    spend(client, TEST_CAP_CENTS, account_id="acct_001")

    response = post_event(client, started("call_other", account_id="acct_002"))

    assert response.json()["call_action"] == "allow"


def test_late_usage_does_not_consume_the_current_cap(client, conn):
    occurred = two_months_ago()
    post_event(client, make_event(cost_cents=9999, timestamp=occurred.isoformat()))

    response = post_event(client, started("call_now"))

    assert response.json()["call_action"] == "allow"


def test_concurrent_deliveries_of_one_event_count_once(client, conn):
    event = make_event(cost_cents=30)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: post_event(client, event), range(16)))

    assert get_usage(client)["cost_cents"] == 30


def test_concurrent_events_lose_no_updates(client, conn):
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: spend(client, 7), range(40)))

    usage = get_usage(client)
    assert usage["cost_cents"] == 280
    assert usage["completed_calls"] == 40
