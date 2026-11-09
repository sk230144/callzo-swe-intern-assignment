import { useEffect, useRef } from 'react';
import { formatCents, formatDate, formatNumber } from '../lib/format.js';
import { Button, Notice } from './ui.jsx';

const WIDE_ONLY = 'hidden lg:table-cell';
const SKELETON_ROWS = 8;

const STATUS_STYLES = {
  active: 'bg-green-100 text-green-900',
  trial: 'bg-blue-100 text-blue-900',
  suspended: 'bg-red-100 text-red-900',
};

const COLUMNS = [
  { key: 'name', label: 'Account' },
  { key: 'company', label: 'Company', wideOnly: true },
  { key: 'country', label: 'Country', wideOnly: true },
  { key: 'plan', label: 'Plan', wideOnly: true },
  { key: 'status', label: 'Status', wideOnly: true },
  { key: 'signup_date', label: 'Signed up', wideOnly: true },
  { key: 'current_month_minutes', label: 'Minutes', wideOnly: true, numeric: true },
  { key: 'current_month_sms', label: 'SMS', wideOnly: true, numeric: true },
  { key: 'cost_cents', label: 'Cost', numeric: true },
  { key: 'last_active', label: 'Last active', wideOnly: true },
];
const COLUMN_COUNT = COLUMNS.length + 2;

function ariaSort(column, state) {
  if (state.sort_by !== column.key) return 'none';
  return state.sort_dir === 'asc' ? 'ascending' : 'descending';
}

function SortHeader({ column, state, onSort }) {
  const isActive = state.sort_by === column.key;
  const arrow = state.sort_dir === 'asc' ? '↑' : '↓';
  return (
    <th
      scope="col"
      aria-sort={ariaSort(column, state)}
      className={`px-3 py-2 ${column.numeric ? 'text-right' : 'text-left'} ${column.wideOnly ? WIDE_ONLY : ''}`}
    >
      <button
        type="button"
        className="min-h-6 rounded font-semibold whitespace-nowrap text-slate-700 hover:text-blue-800"
        onClick={() => onSort(column.key)}
      >
        {column.label} <span aria-hidden="true">{isActive ? arrow : ''}</span>
      </button>
    </th>
  );
}

function PageCheckbox({ rows, selected, onToggle }) {
  const ref = useRef(null);
  const selectedCount = rows.filter((row) => selected.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  useEffect(() => {
    ref.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [selectedCount, allSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-5"
      aria-label="Select all accounts on this page"
      checked={allSelected}
      onChange={(event) => onToggle(rows, event.target.checked)}
    />
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function AccountRow({ row, isSelected, onToggle, onEdit }) {
  return (
    <tr className={`border-t border-slate-100 ${isSelected ? 'bg-blue-50' : ''}`}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="size-5"
          aria-label={`Select ${row.name}, ${row.email}`}
          checked={isSelected}
          onChange={(event) => onToggle([row], event.target.checked)}
        />
      </td>
      <td className="max-w-36 px-3 py-2 lg:max-w-56">
        <div className="truncate font-medium text-slate-900">{row.name}</div>
        <div className="truncate text-xs text-slate-600">{row.email}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-600 lg:hidden">
          <StatusBadge status={row.status} />
          <span>
            {row.plan} · {row.country}
          </span>
        </div>
      </td>
      <td className={`px-3 py-2 ${WIDE_ONLY}`}>{row.company}</td>
      <td className={`px-3 py-2 ${WIDE_ONLY}`}>{row.country}</td>
      <td className={`px-3 py-2 ${WIDE_ONLY}`}>{row.plan}</td>
      <td className={`px-3 py-2 ${WIDE_ONLY}`}>
        <StatusBadge status={row.status} />
      </td>
      <td className={`px-3 py-2 whitespace-nowrap ${WIDE_ONLY}`}>{formatDate(row.signup_date)}</td>
      <td className={`px-3 py-2 text-right ${WIDE_ONLY}`}>{formatNumber(row.current_month_minutes)}</td>
      <td className={`px-3 py-2 text-right ${WIDE_ONLY}`}>{formatNumber(row.current_month_sms)}</td>
      <td className="px-3 py-2 text-right">{formatCents(row.cost_cents)}</td>
      <td className={`px-3 py-2 whitespace-nowrap ${WIDE_ONLY}`}>{formatDate(row.last_active)}</td>
      <td className="px-3 py-2 text-right">
        <Button aria-label={`Edit settings for ${row.name}, ${row.email}`} onClick={() => onEdit(row.id)}>
          Edit
        </Button>
      </td>
    </tr>
  );
}

function SkeletonRows() {
  return Array.from({ length: SKELETON_ROWS }, (_, index) => (
    <tr key={index} className="border-t border-slate-100">
      <td colSpan={COLUMN_COUNT} className="px-3 py-3">
        <div className="h-8 animate-pulse rounded bg-slate-100" />
      </td>
    </tr>
  ));
}

function MessageRow({ children }) {
  return (
    <tr>
      <td colSpan={COLUMN_COUNT} className="p-6">
        {children}
      </td>
    </tr>
  );
}

function TableBody({ accounts, selected, onToggle, onEdit, hasFilters, onClearFilters }) {
  if (accounts.error) {
    return (
      <MessageRow>
        <Notice
          title="Accounts didn't load"
          actions={<Button onClick={accounts.reload}>Retry</Button>}
        >
          Check that the API is running, then try again.
        </Notice>
      </MessageRow>
    );
  }
  if (!accounts.data) return <SkeletonRows />;
  if (accounts.data.data.length === 0) {
    return (
      <MessageRow>
        <div className="text-center text-sm text-slate-600">
          <p>{hasFilters ? 'No accounts match these filters.' : 'There are no accounts yet.'}</p>
          {hasFilters && (
            <Button className="mt-2" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </MessageRow>
    );
  }
  return accounts.data.data.map((row) => (
    <AccountRow
      key={row.id}
      row={row}
      isSelected={selected.has(row.id)}
      onToggle={onToggle}
      onEdit={onEdit}
    />
  ));
}

export function AccountsTable({
  accounts,
  state,
  selected,
  onToggle,
  onSort,
  onEdit,
  hasFilters,
  onClearFilters,
}) {
  const rows = accounts.data?.data ?? [];
  return (
    <div className={`overflow-x-auto ${accounts.isLoading && accounts.data ? 'opacity-60' : ''}`}>
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">Accounts and their usage this month</caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">
              <PageCheckbox rows={rows} selected={selected} onToggle={onToggle} />
            </th>
            {COLUMNS.map((column) => (
              <SortHeader key={column.key} column={column} state={state} onSort={onSort} />
            ))}
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <TableBody
            accounts={accounts}
            selected={selected}
            onToggle={onToggle}
            onEdit={onEdit}
            hasFilters={hasFilters}
            onClearFilters={onClearFilters}
          />
        </tbody>
      </table>
    </div>
  );
}
