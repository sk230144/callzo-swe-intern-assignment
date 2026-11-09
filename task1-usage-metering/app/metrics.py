"""Prometheus metrics exposed by the API at /metrics."""

from prometheus_client import Counter, Gauge

WEBHOOK_REQUESTS = Counter(
    "webhook_requests_total",
    "Webhook deliveries by outcome.",
    ["outcome"],
)
CAP_CROSSINGS = Counter(
    "cap_crossings_total",
    "Times an account's monthly usage crossed its cap.",
)
# Read from the database at scrape time so it also reflects the worker's progress.
EVENTS_BY_STATUS = Gauge(
    "raw_events",
    "Stored events by processing status.",
    ["status"],
)
