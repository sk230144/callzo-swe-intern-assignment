# Task 1: Usage Metering Service

Receives signed call events from a telephony provider, stores them, computes
usage per account per month, enforces a monthly cap, and exposes usage through
an authenticated API. Built with FastAPI and Postgres.

## Run it

Needs Docker and nothing else. No `.env` file or other setup is required.

```bash
docker compose up --build
```

This starts Postgres, the API on <http://localhost:8000>, the background worker,
and the provided simulator. The simulator takes about 15 seconds, then exits; the
other services keep running. On x86 machines the first start is slower because
the simulator is only published for `linux/arm64` and runs under emulation.

Run the tests (62, against a real Postgres, in a separate `usage_test` database):

```bash
docker compose run --rm --build tests
```

Usage accumulates between runs, so re-running the simulator pushes every account
towards the cap. To start clean: `docker compose down -v`.

## Try it

```bash
KEY="Authorization: Bearer local-dev-api-key"

# The account the simulator bursts on. Expect blocking_new_calls: true.
curl -H "$KEY" localhost:8000/v1/accounts/acct_001/usage

# A specific month, and the events waiting for human review.
curl -H "$KEY" "localhost:8000/v1/accounts/acct_002/usage?month=2026-10"
curl -H "$KEY" localhost:8000/v1/review/late-events

# Recompute usage from raw events and report any drift.
curl -X POST -H "$KEY" localhost:8000/v1/admin/reconcile

curl localhost:8000/health
curl localhost:8000/metrics
```

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /webhooks/calls` | `X-Signature` HMAC | Receive a call event |
| `GET /v1/accounts/{id}/usage?month=YYYY-MM` | Bearer key | Usage and cap state; defaults to this month |
| `GET /v1/review/late-events?limit&offset` | Bearer key | Late `call.ended` events awaiting review |
| `POST /v1/admin/reconcile` | Bearer key | Recompute usage now and repair drift |
| `GET /health` | None | 200 if Postgres is reachable, otherwise 503 |
| `GET /metrics` | None | Prometheus metrics |

To inspect the database: `docker compose exec db psql -U callzo -d usage`.

## What each simulator scenario does here

| Scenario | Response | What ends up in the database |
|---|---|---|
| normal | 200 | One `calls` row per call, `status = ended`; usage added once |
| duplicates | 200 `processed`, then 200 `duplicate` | One `raw_events` row; usage counted once |
| out_of_order | 200 | `call.ended` creates the row and adds usage; `call.started` later only fills in `started_at` |
| late | 200 | `needs_review = true`; cost goes to `late_cost_cents` for the event's own month, not billed usage |
| malformed | 422 | Nothing stored; logged as `webhook.invalid_payload` |
| bad_signature | 401 | Nothing stored; body is never parsed |
| cap_burst | 200, with `call_action: reject` once capped | `calls.blocked = true` on later calls; all costs recorded, excess reported as overage |

## Assumptions I had to make

The brief leaves these open. Each is a decision I would confirm with the team first.

1. **We can't stop a call from here.** Webhooks report what already happened, so the
   service can only signal a decision back and record the outcome.
2. **A billing month is a UTC calendar month**, not a per-account cycle or local time.
3. **A call belongs to the month its `call.ended` timestamp falls in**, so a call
   spanning midnight on the 1st counts entirely in the later month.
4. **The cap is on cost in cents**, the same for every account, and set by
   `MONTHLY_CAP_CENTS`. The spec gives no cap value, so the default of 500 ($5) is
   chosen from the simulator's traffic: burst calls cost about 20 cents each, for
   about 800 cents in total, and other accounts stay near 100.
5. **Accounts are not pre-registered.** The provider is the source of truth, so an
   unknown account returns zero usage rather than a 404.
6. **One service-wide API key is enough**, since this API is for internal callers.
7. **`/metrics` is scraped from inside the network** and exposes only counts, so it
   has no auth.

## Design decisions and what they cost

### Store first, then apply, in two transactions

The webhook commits the event to `raw_events`, then applies it to `calls` and
`usage_monthly` in a second transaction. If applying fails, the event is already
safe, the provider gets a 202, and the worker retries it.

*Given up:* one extra write per event, and a short window where an event is stored
but not yet counted. The single-transaction alternative is simpler, but any failure
applying an event would need the provider to resend it, and we don't control that.

### Three tables, each with one job

- `raw_events` is the append-only truth, and its primary key on `event_id` is the
  idempotency guard. It holds typed columns rather than a JSON blob, so the database
  enforces constraints. *Given up:* a field the provider adds later isn't retained
  until we add a column.
- `calls` merges a call's events into one row. Upserts make the order of arrival
  irrelevant.
- `usage_monthly` is the fast read model and the cap counter. It is derived data,
  and reconciliation can rebuild it entirely.

Money is `bigint` cents throughout. There are no floats anywhere in the path.

### Correctness under concurrency comes from one row lock

Every event begins by locking its account-month row in `usage_monthly`, using an
upsert so that the row always exists. Two events for one account therefore can't
interleave, so a cap check can never read a total that another event is halfway
through changing. Each event takes a single usage lock, which rules out deadlocks
between them.

*Given up:* events for the same account are serialised. At a few events per second
per account that costs nothing. A very high-volume account would contend on that row.

### Raw SQL with psycopg, no ORM

The upserts carry the logic, and their conditions are clearer read directly.
*Given up:* typed query results and generated migrations. The schema is a single
idempotent file applied at startup, which won't last beyond a first production change.

## Cap behaviour: hard for new calls, accurate for money

| Situation | Result |
|---|---|
| Usage below the cap | `call.started` returns `call_action: allow` |
| Usage **exactly at** the cap | **Blocked**: `used >= cap`, and `remaining_cents` is 0 |
| A call in progress crosses the cap | Billed in full; the excess appears as `overage_cents` |
| `call.started` arrives once capped | 200 with `call_action: reject`; `calls.blocked = true` |
| `call.ended` arrives for a blocked call | Still recorded: the provider says it happened and cost money |
| `call.ended` overtook its `call.started` | Never blocked, because the call has already happened |
| Late event for a closed month | Never blocked, and doesn't use up the current cap |

It responds 200 rather than a 4xx because the delivery itself succeeded, and a
provider would treat an error as a reason to retry. The decision is in the body.

I chose this over dropping usage after the cap because a cost that really happened
has to stay visible. Finance can choose to waive it, but can't recover what was never
recorded. *Given up:* the provider must act on `call_action`, or calls continue. A
call that starts before the cap and runs long can also go over by its full length.

## Late events: stated policy

A month closes `MONTH_GRACE_DAYS` (default 3) after it ends.

- **Before the close**, a late event counts towards the month it occurred in.
- **After the close**, it's stored and flagged for review: `needs_review = true`,
  added to `late_cost_cents`, and listed by `/v1/review/late-events`. It doesn't change
  that month's billed `cost_cents`, and it never affects the current month's cap.

An invoice that may already be issued shouldn't change silently, and charging old
usage to the current month would misstate both. The simulator's events, about 35 days
old, are nearly always flagged. An event from the 1st of a 31-day month would land
inside the grace window, and count normally.

The flag is decided once, on arrival, and stored. Reconciliation therefore gives the
same answer later, even if the grace period is changed.

*Given up:* someone has to review the queue. There is no resolve action yet.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Invalid or missing signature | 401, before the body is parsed |
| Malformed or invalid payload | 422 with field errors; process keeps running |
| Postgres down when an event arrives | 503, so the provider resends; `/health` also returns 503 |
| Applying an event fails | Transaction rolls back fully; 202; worker retries |
| Process crashes between the two transactions | Event stays `pending`; worker picks it up after 30 seconds |
| Retries keep failing | Exponential backoff from 5 seconds, capped at 1 hour; `dead` after 8 attempts |
| A duplicate arrives while the first is still pending | 200 `duplicate`; the event is applied once, by the worker |
| Same `call_id` ends twice under different `event_id`s | First wins; later ones are logged and ignored |
| Usage table drifts from raw events | Hourly reconciliation (or the endpoint) repairs and reports it |
| Worker is down | Webhooks still work, and retries resume when it returns |

Dead events stay in `raw_events` with `last_error`, and appear in the
`raw_events{status="dead"}` metric. To requeue one after a fix:
`UPDATE raw_events SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE event_id = '...'`.

## Background worker and reconciliation

`app/worker.py` runs as its own service. Every 2 seconds it retries pending events
that are due. Every hour it reconciles usage. Running several copies is safe.

Reconciliation recomputes monthly totals from processed `raw_events`, compares them
with `usage_monthly`, and repairs any difference inside one transaction. It takes a
brief table lock that blocks usage writes but not reads, so no event can land midway
through. Pending events are skipped, or they would be counted twice once applied.

*Given up:* it scans every processed `call.ended` event while webhooks wait on the
lock. That's fine at this size. At volume it should work one closed month at a time.

## Security and secrets

- Webhooks: HMAC-SHA256 over the raw bytes, compared in constant time.
- API: Bearer key, compared in constant time.
- All input is validated by Pydantic. Identifiers are pattern-checked, integers are
  strict (`"5"`, `1.5` and `true` are all rejected), timestamps must carry a timezone
  and can't be more than an hour in the future.
- The code has no secret defaults; the process won't start without them. For a
  one-command start, `docker-compose.yml` supplies clearly marked local-only values,
  which `.env` or real environment variables override. The trade-off is that throwaway
  development values are visible in the compose file.

## Observability

Logs are JSON, one event per line: `event.applied`, `event.duplicate`, `cap.crossed`,
`call.blocked`, `event.flagged_for_review`, `event.apply_failed`, `event.dead`,
`reconcile.finished`, `reconcile.drift_repaired`.

Metrics: `webhook_requests_total{outcome}`, `cap_crossings_total` and
`raw_events{status}`. The last is read from Postgres at scrape time, so it reflects
the worker's progress too. The first two are per API process.

## What I'd do next with more time

1. Per-account caps, by adding an `accounts` table to hold them.
2. A resolve action for the review queue, to bill or waive a late event with an audit trail.
3. Alembic migrations instead of a single startup schema file.
4. Cap warnings at 80% and 100%, sent to the customer.
5. Reconciling one closed month at a time, and partitioning `raw_events` by month.
6. A request-size limit before the body is read, plus rate limiting.
7. Per-customer API keys, with each key scoped to its account.
8. Rotating the webhook secret by accepting two values during a changeover.
