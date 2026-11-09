import { useEffect, useRef, useState } from 'react';
import { FILTER_DEFAULTS, PLANS, SORTABLE_COLUMNS, STATUSES } from '../lib/urlState.js';
import { Button } from './ui.jsx';

const SEARCH_DELAY_MS = 300;
const COUNTRIES = ['AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'NG', 'PK', 'US'];
const LABEL = 'block text-sm font-medium text-slate-700';
const INPUT = 'mt-1 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm';

const SORT_LABELS = {
  id: 'ID',
  name: 'Name',
  company: 'Company',
  country: 'Country',
  plan: 'Plan',
  status: 'Status',
  signup_date: 'Signup date',
  current_month_minutes: 'Minutes',
  current_month_sms: 'SMS',
  cost_cents: 'Cost',
  last_active: 'Last active',
};

function SelectFilter({ label, value, options, onChange }) {
  return (
    <label className={LABEL}>
      {label}
      <select className={INPUT} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchFilter({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef();

  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleChange = (event) => {
    const next = event.target.value;
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), SEARCH_DELAY_MS);
  };

  return (
    <label className={`${LABEL} col-span-2`}>
      Search
      <input
        type="search"
        className={INPUT}
        placeholder="Name, email or company"
        value={draft}
        onChange={handleChange}
      />
    </label>
  );
}

/** Only a valid range reaches the URL, so the table and chart never see a bad one. */
function DateRangeFilter({ from, to, onCommit }) {
  const [draft, setDraft] = useState({ from, to });

  useEffect(() => setDraft({ from, to }), [from, to]);

  const isReversed = (range) => Boolean(range.from && range.to && range.from > range.to);
  const isInvalid = isReversed(draft);
  const errorProps = isInvalid
    ? { 'aria-invalid': true, 'aria-describedby': 'date-range-error' }
    : {};

  const change = (field, value) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (!isReversed(next)) onCommit({ date_from: next.from, date_to: next.to });
  };

  return (
    <fieldset className="col-span-2">
      <legend className="sr-only">Signup date range</legend>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          Signed up from
          <input
            type="date"
            className={INPUT}
            value={draft.from}
            onChange={(event) => change('from', event.target.value)}
            {...errorProps}
          />
        </label>
        <label className={LABEL}>
          Signed up to
          <input
            type="date"
            className={INPUT}
            value={draft.to}
            onChange={(event) => change('to', event.target.value)}
            {...errorProps}
          />
        </label>
      </div>
      {isInvalid && (
        <p id="date-range-error" role="alert" className="mt-1 text-sm text-red-800">
          The start date must be on or before the end date. Showing the previous range.
        </p>
      )}
    </fieldset>
  );
}

/** The column headers that sort are hidden on narrow screens; these replace them. */
function SortControls({ sortBy, sortDir, onChange }) {
  return (
    <div className="col-span-2 grid grid-cols-2 gap-3 lg:hidden">
      <label className={LABEL}>
        Sort by
        <select
          className={INPUT}
          value={sortBy}
          onChange={(event) => onChange({ sort_by: event.target.value, page: 1 })}
        >
          {SORTABLE_COLUMNS.map((column) => (
            <option key={column} value={column}>
              {SORT_LABELS[column]}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Direction
        <select
          className={INPUT}
          value={sortDir}
          onChange={(event) => onChange({ sort_dir: event.target.value, page: 1 })}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
    </div>
  );
}

export function Filters({ state, onFilterChange, onSortChange, hasFilters }) {
  return (
    <section aria-label="Filters" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SearchFilter
          value={state.search}
          onCommit={(search) => onFilterChange({ search }, { replace: true })}
        />
        <SelectFilter
          label="Status"
          value={state.status}
          options={STATUSES}
          onChange={(status) => onFilterChange({ status })}
        />
        <SelectFilter
          label="Plan"
          value={state.plan}
          options={PLANS}
          onChange={(plan) => onFilterChange({ plan })}
        />
        <SelectFilter
          label="Country"
          value={state.country}
          options={COUNTRIES}
          onChange={(country) => onFilterChange({ country })}
        />
        <DateRangeFilter
          from={state.date_from}
          to={state.date_to}
          onCommit={(range) => onFilterChange(range)}
        />
        <SortControls sortBy={state.sort_by} sortDir={state.sort_dir} onChange={onSortChange} />
        <Button isDisabled={!hasFilters} onClick={() => onFilterChange(FILTER_DEFAULTS)}>
          Clear filters
        </Button>
      </div>
    </section>
  );
}
