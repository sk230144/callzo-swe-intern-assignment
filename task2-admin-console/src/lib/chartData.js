const DAY_LIMIT = 62;
const WEEK_LIMIT = 366;
const METRICS = ['minutes', 'sms', 'cost_cents', 'signups'];

const weekFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function startOfWeek(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function granularityFor(pointCount) {
  if (pointCount <= DAY_LIMIT) return 'day';
  return pointCount <= WEEK_LIMIT ? 'week' : 'month';
}

function bucketStart(isoDate, granularity) {
  if (granularity === 'day') return isoDate;
  return granularity === 'week' ? startOfWeek(isoDate) : `${isoDate.slice(0, 7)}-01`;
}

function bucketLabel(isoDate, granularity) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return (granularity === 'month' ? monthFormat : weekFormat).format(date);
}

/** Groups daily points so that long ranges stay readable. */
export function bucketSeries(series) {
  const granularity = granularityFor(series.length);
  const buckets = new Map();
  for (const point of series) {
    const start = bucketStart(point.date, granularity);
    const bucket = buckets.get(start) ?? {
      date: start,
      label: bucketLabel(start, granularity),
      minutes: 0,
      sms: 0,
      cost_cents: 0,
      signups: 0,
    };
    for (const metric of METRICS) bucket[metric] += point[metric];
    buckets.set(start, bucket);
  }
  const points = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { granularity, points };
}
