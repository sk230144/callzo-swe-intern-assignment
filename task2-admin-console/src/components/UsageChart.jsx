import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { bucketSeries } from '../lib/chartData.js';
import {
  formatCents,
  formatCompact,
  formatCompactCents,
  formatNumber,
  formatTime,
} from '../lib/format.js';
import { Button, Notice } from './ui.jsx';

const SERIES_COLOR = '#2a78d6';
const GRID_COLOR = '#e2e8f0';
const AXIS_TEXT = { fill: '#475569', fontSize: 12 };
const CHART_HEIGHT = 'h-60';

const METRICS = {
  minutes: { label: 'Minutes', format: formatNumber, axis: formatCompact },
  sms: { label: 'SMS', format: formatNumber, axis: formatCompact },
  cost_cents: { label: 'Cost', format: formatCents, axis: formatCompactCents },
  signups: { label: 'Signups', format: formatNumber, axis: formatCompact },
};

const GRANULARITY_LABELS = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

function MetricPicker({ value, onChange }) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
      <legend className="sr-only">Chart metric</legend>
      {Object.entries(METRICS).map(([key, metric]) => (
        <label key={key} className="flex min-h-6 items-center gap-1.5 text-sm text-slate-700">
          <input
            type="radio"
            name="chart-metric"
            checked={value === key}
            onChange={() => onChange(key)}
          />
          {metric.label}
        </label>
      ))}
    </fieldset>
  );
}

function Plot({ points, metricKey }) {
  const metric = METRICS[metricKey];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis
          dataKey="label"
          tick={AXIS_TEXT}
          tickLine={false}
          axisLine={{ stroke: GRID_COLOR }}
          minTickGap={32}
        />
        <YAxis
          width={52}
          tick={AXIS_TEXT}
          tickLine={false}
          axisLine={false}
          tickFormatter={metric.axis}
        />
        <Tooltip formatter={(value) => [metric.format(value), metric.label]} />
        <Line
          dataKey={metricKey}
          stroke={SERIES_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DataTable({ points }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-blue-800">View as table</summary>
      <div className="mt-2 max-h-60 overflow-auto" tabIndex={0} role="region" aria-label="Chart data">
        <table className="w-full text-left tabular-nums">
          <thead className="sticky top-0 bg-white">
            <tr>
              <th className="py-1 pr-2">Period</th>
              {Object.values(METRICS).map((metric) => (
                <th key={metric.label} className="py-1 pr-2 text-right">
                  {metric.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date} className="border-t border-slate-100">
                <td className="py-1 pr-2 whitespace-nowrap">{point.label}</td>
                {Object.entries(METRICS).map(([key, metric]) => (
                  <td key={key} className="py-1 pr-2 text-right">
                    {metric.format(point[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ChartBody({ summary, buckets, metricKey }) {
  if (summary.error) {
    return (
      <div className={`flex ${CHART_HEIGHT} items-center`}>
        <div className="w-full">
          <Notice
            title="The usage chart didn't load"
            actions={<Button onClick={summary.reload}>Retry chart</Button>}
          >
            The accounts table below is unaffected.
          </Notice>
        </div>
      </div>
    );
  }
  if (!summary.data) {
    return <div className={`${CHART_HEIGHT} animate-pulse rounded-md bg-slate-100`} />;
  }
  if (buckets.points.length === 0) {
    return (
      <p className={`flex ${CHART_HEIGHT} items-center justify-center text-sm text-slate-600`}>
        No usage in this date range.
      </p>
    );
  }
  const metric = METRICS[metricKey];
  const total = buckets.points.reduce((sum, point) => sum + point[metricKey], 0);
  const description = `${metric.label}, ${GRANULARITY_LABELS[buckets.granularity].toLowerCase()} totals. Overall total ${metric.format(total)}.`;
  return (
    <>
      <figure
        className={`${CHART_HEIGHT} ${summary.isLoading ? 'opacity-60' : ''}`}
        aria-label={description}
      >
        <Plot points={buckets.points} metricKey={metricKey} />
      </figure>
      <DataTable points={buckets.points} />
    </>
  );
}

export function UsageChart({ summary }) {
  const [metricKey, setMetricKey] = useState('minutes');
  const series = summary.data?.series;
  const buckets = useMemo(() => bucketSeries(series ?? []), [series]);

  return (
    <section
      aria-labelledby="chart-title"
      aria-busy={summary.isLoading}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="chart-title" className="font-semibold text-slate-900">
            {METRICS[metricKey].label} over time
          </h2>
          <p className="min-h-5 text-sm text-slate-600">
            {summary.data && buckets.points.length > 0 && (
              <>
                {GRANULARITY_LABELS[buckets.granularity]} totals,{' '}
                {formatNumber(summary.data.total_accounts)} accounts
                {buckets.granularity !== 'day' && '. First and last periods may be partial.'}
              </>
            )}
            {summary.refreshFailed && (
              <span className="text-amber-800">
                {' '}
                · Showing data from {formatTime(summary.updatedAt)}
              </span>
            )}
          </p>
        </div>
        <MetricPicker value={metricKey} onChange={setMetricKey} />
      </div>
      <ChartBody summary={summary} buckets={buckets} metricKey={metricKey} />
    </section>
  );
}
