-- Applied at API startup. Every statement is idempotent.

-- Append-only record of every distinct event. The source of truth: `calls` and
-- `usage_monthly` can both be derived from it.
CREATE TABLE IF NOT EXISTS raw_events (
    event_id            text PRIMARY KEY,
    event_type          text NOT NULL
                        CHECK (event_type IN ('call.started', 'call.ended', 'call.failed')),
    account_id          text NOT NULL,
    call_id             text NOT NULL,
    occurred_at         timestamptz NOT NULL,
    duration_seconds    integer NOT NULL CHECK (duration_seconds >= 0),
    cost_cents          bigint NOT NULL CHECK (cost_cents >= 0),
    destination_country text NOT NULL,
    received_at         timestamptz NOT NULL,
    needs_review        boolean NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processed', 'dead')),
    attempts            integer NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz NOT NULL,
    last_error          text,
    processed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS raw_events_due_idx
    ON raw_events (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS raw_events_review_idx
    ON raw_events (received_at) WHERE needs_review;

-- Current state of each call, merged from however its events happened to arrive.
CREATE TABLE IF NOT EXISTS calls (
    call_id             text PRIMARY KEY,
    account_id          text NOT NULL,
    status              text NOT NULL CHECK (status IN ('started', 'ended', 'failed')),
    started_at          timestamptz,
    finished_at         timestamptz,
    duration_seconds    integer NOT NULL DEFAULT 0,
    cost_cents          bigint NOT NULL DEFAULT 0,
    blocked             boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS calls_blocked_idx
    ON calls (account_id, started_at) WHERE blocked;

-- Read model and cap counter: one row per account per UTC month. Its row lock
-- is what serialises concurrent events for the same account.
CREATE TABLE IF NOT EXISTS usage_monthly (
    account_id          text NOT NULL,
    month               date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    completed_calls     integer NOT NULL DEFAULT 0,
    duration_seconds    bigint NOT NULL DEFAULT 0,
    cost_cents          bigint NOT NULL DEFAULT 0,
    late_calls          integer NOT NULL DEFAULT 0,
    late_cost_cents     bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, month)
);
