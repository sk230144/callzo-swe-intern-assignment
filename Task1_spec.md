# Task 1 — Webhook Contract Spec

This describes the webhook events your service must accept from the
simulator, a pre-built tool we provide as a Docker image. You don't have
its source — you only need this spec and the `docker-compose.yml` provided
alongside it. You do not need to build the sender. You need to build the
receiver (your API) so it behaves correctly against it.

## Endpoint

Your API should expose one endpoint, e.g.:

```
POST /webhooks/calls
```

The simulator POSTs JSON events to whatever URL you point it at (configured
via the `simulator` service's `command` in `docker-compose.yml`).

## Signature verification

Every request includes a header:

```
X-Signature: <hex HMAC-SHA256 of the raw request body>
```

The signature is computed as:

```
HMAC-SHA256(secret, raw_request_body_bytes)
```

You must:
- Compute the same HMAC over the **raw bytes** of the body you received (not
  the parsed/re-serialized JSON — re-serializing can change byte order and
  break the signature check).
- Compare using a constant-time comparison (e.g. `hmac.compare_digest` in
  Python), not `==`.
- Reject with `401` or `403` if the signature is missing or invalid. Do not
  process the payload in that case.

The shared secret is: `callzo_test_secret_change_me`. The simulator signs
with this value by default. Your API must verify against the same value —
either hardcode it for this assessment or read it from an environment
variable, your choice.

## Event schema

```json
{
  "event_id": "evt_a1b2c3d4e5f6",
  "event_type": "call.started",
  "account_id": "acct_001",
  "call_id": "call_9f8e7d6c5b4a",
  "timestamp": "2026-11-01T10:15:30.123456+00:00",
  "duration_seconds": 0,
  "cost_cents": 0,
  "destination_country": "US"
}
```

| Field | Type | Notes |
|---|---|---|
| `event_id` | string | Unique per *delivery attempt* conceptually, but the simulator will deliberately resend the same `event_id` 2-3 times for some events to test idempotency. |
| `event_type` | string | One of `call.started`, `call.ended`, `call.failed`. Treat unknown values as a client error, not a crash. |
| `account_id` | string | `acct_001` through `acct_010`. |
| `call_id` | string | Shared between the `call.started` and `call.ended` events for the same call. |
| `timestamp` | ISO 8601 string | When the event occurred. Not guaranteed to match when you receive it — events can arrive late or out of order. |
| `duration_seconds` | int | `0` on `call.started`/`call.failed`. Populated on `call.ended`. |
| `cost_cents` | int | `0` on `call.started`/`call.failed`. Populated on `call.ended`, roughly 2 cents/minute. Always an integer — never use floats for money in your own code either. |
| `destination_country` | string | ISO-ish country code, informational only. |

## What the simulator will throw at you

The simulator image accepts a `--scenario` flag (set in the `command` of the
`simulator` service in `docker-compose.yml`). `all` sends everything in one
run; you can also target one scenario at a time while you build by editing
that `command` line. Available scenarios:

- **normal** — ordinary `call.started` → `call.ended` pairs.
- **duplicates** — the exact same event (same `event_id`) sent 2-3 times.
  Usage must not be double-counted.
- **out_of_order** — `call.ended` arrives before its matching `call.started`.
  Your system should still end up in a correct state.
- **late** — events timestamped ~35 days in the past arriving "now." Decide
  and document whether these affect last month's usage, this month's, or
  are flagged for review — there's no single right answer, but you must
  have a stated one.
- **malformed** — missing fields, wrong types, truncated JSON, an unknown
  `event_type`, and an empty body. Your API should reject these cleanly
  (4xx) without crashing the process.
- **bad_signature** — invalid or missing `X-Signature` headers. Must be
  rejected before the payload is processed.
- **cap_burst** — ~40 back-to-back long calls on a single account, meant to
  blow past any reasonable monthly cap. Use this to verify your cap logic
  actually engages partway through, however you've chosen to implement it.

## Running it

The simulator is a pre-built Docker image (`meetrj/callzo-webhook-simulator`),
already wired up in the `docker-compose.yml` provided alongside this spec.
You don't need its source and you don't need to build it — Docker will pull
it automatically the first time you run `docker compose up`. It includes:

- A placeholder `api` service (a simple request-echo/logger) so you can
  confirm the simulator is sending what you expect — headers, signature,
  payload shape — before you've written a single line of your own API.
- A `simulator` service that pulls the published image and points at `api`.

**Step 1 — sanity-check the simulator against the placeholder:**

```bash
docker compose up
```

Watch the `api` service's logs. You should see every request the simulator
sends, including the `X-Signature` header and the JSON body described above.

**Step 2 — replace the placeholder with your real API:**

Edit `docker-compose.yml`. Find the `api` service (it's commented) and swap
it for your own service — either `build: context: ./your-api-folder` or your
own pushed image — then update the simulator's `command` to point at your
real webhook route if it differs from `/webhooks/calls`.

```bash
docker compose up
```

Or target one scenario at a time while debugging, by editing the
`simulator` service's `command` in the compose file:

```yaml
command: ["--url", "http://api:8000/webhooks/calls", "--scenario", "duplicates"]
```

The simulator logs what it sent and the HTTP status your API returned for
each event. It does not grade you — that happens in the live walkthrough,
where we'll ask you to explain what actually happened in your database for
each scenario above.

```yaml
# docker-compose.yaml
services:
  # This is a placeholder so you can sanity-check the simulator before your
  # real API exists. It just echoes and logs whatever it receives.
  #
  # REPLACE THIS IMAGE once your own API is built. Swap in your own service
  # here (build: context, or your own pushed image), update the internal
  # port if it's not 8000, and point the simulator's --url below at your
  # real webhook route, e.g. http://api:8000/webhooks/calls.
  api:
    image: mendhak/http-https-echo:31
    container_name: api
    ports:
      - "8000:8080"   # http-https-echo listens on 8080 internally
    environment:
      - LOG_IGNORE_PATH=/favicon.ico

  simulator:
    image: meetrj/callzo-webhook-simulator
    container_name: simulator
    depends_on:
      - api
    command: ["--url", "http://api:8080/webhooks/calls", "--scenario", "all"]
```