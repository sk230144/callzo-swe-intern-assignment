import { useMemo } from 'react';
import { formatCents, formatNumber, formatTime } from '../lib/format.js';
import { PAGE_SIZES } from '../lib/urlState.js';
import { Button } from './ui.jsx';

export function SelectionBar({ selected, onClear }) {
  const totals = useMemo(() => {
    const rows = [...selected.values()];
    return {
      minutes: rows.reduce((sum, row) => sum + row.current_month_minutes, 0),
      cost: rows.reduce((sum, row) => sum + row.cost_cents, 0),
    };
  }, [selected]);

  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-sm">
      <p className="text-slate-700">
        {selected.size === 0 ? (
          'No accounts selected'
        ) : (
          <>
            <strong>{formatNumber(selected.size)} selected</strong> across all pages ·{' '}
            {formatNumber(totals.minutes)} min · {formatCents(totals.cost)}
          </>
        )}
      </p>
      {selected.size > 0 && <Button onClick={onClear}>Clear selection</Button>}
    </div>
  );
}

export function RefreshBar({ accounts }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-1 text-xs text-slate-600">
      <span>
        {accounts.updatedAt ? `Updated ${formatTime(accounts.updatedAt)}` : ''}
        {accounts.refreshFailed && (
          <span className="text-amber-800"> · Refresh failed. Showing the last data received.</span>
        )}
      </span>
      {accounts.data?.orderChanged && (
        <Button onClick={accounts.reload}>Values changed. Re-sort</Button>
      )}
    </div>
  );
}

export function Pagination({ page, pageSize, total, isReady, onChange }) {
  const lastPage = Math.max(Math.ceil(total / pageSize), 1);
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-3 text-sm"
    >
      <p aria-live="polite" className="text-slate-700">
        {isReady
          ? `${formatNumber(firstRow)}–${formatNumber(lastRow)} of ${formatNumber(total)} · Page ${formatNumber(page)} of ${formatNumber(lastPage)}`
          : 'Loading accounts…'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-slate-700">
          Rows
          <select
            className="min-h-10 rounded-md border border-slate-300 bg-white px-2"
            value={pageSize}
            onChange={(event) => onChange({ page_size: Number(event.target.value), page: 1 })}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <Button isDisabled={page <= 1} onClick={() => onChange({ page: page - 1 })}>
          Previous
        </Button>
        <Button isDisabled={page >= lastPage} onClick={() => onChange({ page: page + 1 })}>
          Next
        </Button>
      </div>
    </nav>
  );
}
