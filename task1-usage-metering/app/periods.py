"""Billing-period rules. All months are UTC calendar months."""

from datetime import UTC, date, datetime, time, timedelta


def month_of(moment: datetime) -> date:
    return moment.astimezone(UTC).date().replace(day=1)


def next_month(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def is_month_closed(month: date, now: datetime, grace_days: int) -> bool:
    """A month closes `grace_days` after it ends; billing treats it as final from then on."""
    closes_at = datetime.combine(next_month(month), time.min, UTC) + timedelta(days=grace_days)
    return now >= closes_at
