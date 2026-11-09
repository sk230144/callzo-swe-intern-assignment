# Task 2 — Mock API Spec

This describes a pre-built mock API, provided as a Docker image, that your
admin console should read from and write to. You don't have its source —
you only need this spec and the `docker-compose.yml` provided alongside it.
Docker will pull the image automatically the first time you run
`docker compose up`.

The API serves ~10,500 fake "account usage" records, plus a 4-step settings
form per account. Some of its behavior is deliberately imperfect — that's
intentional, and part of what we're evaluating. Read the whole spec before
you start.

## Base URL

Inside Docker (your frontend container talking to it): `http://mock-api:8001`
From your host machine directly (e.g. curling it to explore): `http://localhost:8001`

## Endpoints

### `GET /health`
Returns `{"status": "ok", "accounts": 10500}`. Useful to confirm the
container is up.

### `GET /accounts`
The main list endpoint. Query parameters:

| Param | Type | Notes |
|---|---|---|
| `page` | int | 1-indexed, default 1 |
| `page_size` | int | default 50, max 200 |
| `search` | string | matches against name, email, or company, case-insensitive substring |
| `status` | string | one of `active`, `trial`, `suspended` |
| `country` | string | e.g. `US`, `IN`, `GB` |
| `plan` | string | one of `basic`, `pro`, `enterprise` |
| `date_from` | date `YYYY-MM-DD` | filters on `signup_date` |
| `date_to` | date `YYYY-MM-DD` | filters on `signup_date` |
| `sort_by` | string | one of `id`, `name`, `company`, `country`, `plan`, `status`, `signup_date`, `current_month_minutes`, `current_month_sms`, `cost_cents`, `last_active` |
| `sort_dir` | string | `asc` or `desc`, default `asc` |

Response shape:
```json
{
  "data": [ { "id": 1, "name": "...", "email": "...", "company": "...",
              "country": "US", "plan": "pro", "status": "active",
              "signup_date": "2025-03-14", "current_month_minutes": 412,
              "current_month_sms": 88, "cost_cents": 149900,
              "last_active": "2025-04-02" }, ... ],
  "total": 10500,
  "page": 1,
  "page_size": 50
}
```

**This endpoint's data drifts slightly on every call.** A small percentage
of returned rows will have slightly different `current_month_minutes`,
`current_month_sms`, and `cost_cents` values than the last time you fetched
them — this simulates a live dataset that updates in the background. If you
poll this endpoint periodically (as the task requires), you should expect
small, real changes between polls, and your UI should handle that without
jumping or losing the user's row selection.

### `GET /accounts/{id}`
Returns a single account. `404` if it doesn't exist.

### `GET /accounts/summary`
Returns aggregated usage for the chart. Optional `date_from` / `date_to`
query params, same format as above.

```json
{
  "series": [
    { "date": "2026-01-01", "minutes": 8433, "sms": 3026, "cost_cents": 1969962, "signups": 16 },
    ...
  ],
  "total_accounts": 3097
}
```

**This endpoint fails randomly, about 1 in 5 calls, with a `500` status.**
This is intentional — it exists to test how your UI handles a failed chart
load without breaking the rest of the page. There is nothing wrong with
your request when this happens; just retry, or handle it gracefully
(e.g. an inline error state on the chart with a retry action).

## Settings form (4 steps)

### `GET /accounts/{id}/settings`
Returns whatever has been saved so far for that account, keyed by step
number, e.g. `{"1": {...}, "2": {...}}`. Use this to restore a draft on
page load or after a refresh.

### `PUT /accounts/{id}/settings/step/{step}`
Saves one step's data. Body:
```json
{ "data": { "...step-specific fields..." } }
```

Step fields:
- **Step 1** — `name` (required), `email` (required, must contain `@`)
- **Step 2** — `plan` (required, one of `basic`/`pro`/`enterprise`), `billing_country` (required, one of `US`/`IN`/`GB`/`CA`/`AU`)
- **Step 3** — `minutes_cap` (number, optional), `sms_cap` (number, optional)
- **Step 4** — `webhook_url` (optional, must start with `http://` or `https://` if provided)

On success: `200` with `{"step": N, "saved": true, "data": {...}}`.
On validation failure: `422` with `{"detail": {"step": N, "errors": {"field": "message"}}}`.

**Important, deliberate behavior:** once step 4's draft exists for an
account, step 2 will start rejecting `billing_country` with
`"billing_country is required"` — even if you send the exact same valid
value that worked before. This is not something to "fix" on the API side;
you don't have access to it, and it isn't a bug in the usual sense. It
exists to test whether your form correctly displays a server-side
validation error on the step it belongs to, without crashing, without
losing data already entered on other steps, and without letting the user
get stuck. How you handle it (messaging, whether you let them re-save step
4 without re-triggering it, how you explain it in the UI) is your decision
to make and defend in the walkthrough.

### `POST /accounts/{id}/settings/submit`
Finalizes the form. Requires all 4 steps to have been saved at least once.
Returns `400` with the list of missing steps if any are incomplete.

## Running it

A `docker-compose.yml` is provided alongside this spec, with the mock API
already wired up as the `mock-api` service. Add your own frontend service
to the same file (the compose file includes a commented example). Your
service must reference a final image you've already built and pushed to
Docker Hub (or another public registry) — use `image:`, not `build:`. We
will run `docker compose up` exactly as submitted; it will not build your
code from source, so make sure your pushed image is the one you intend us
to run.

From inside your frontend container, reach the mock API at
`http://mock-api:8001` — not `http://localhost:8001`, which only works
from your host machine, not from inside another container on the same
Docker network.

```yaml
# docker-compose.yaml
services:
  mock-api:
    image: meetrj/callzo-mock-usage-api
    container_name: mock-api
    ports:
      - "8001:8001"

  # ADD YOUR FRONTEND SERVICE HERE, as a pre-built image you've pushed to
  # Docker Hub (or another registry). Do NOT use "build:" — we will not
  # build your code from source. Push your own image and reference it here
  # by name, the same way mock-api is referenced above.
  #
  # Example:
  #
  # frontend:
  #   image: yourdockerhubusername/callzo-task2-frontend
  #   container_name: frontend
  #   ports:
  #     - "3000:3000"
  #   depends_on:
  #     - mock-api
  #   environment:
  #     - API_URL=http://mock-api:8001
  #
  # The whole point of "docker compose up" starting everything is that we
  # can run your submission with one command, using only the image you've
  # already built and pushed. Make sure your frontend reaches mock-api at
  # http://mock-api:8001 from inside the Docker network (not
  # http://localhost:8001 — that only works from your host machine, not
  # from inside another container).
```