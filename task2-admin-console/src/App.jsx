import { useCallback, useEffect, useMemo } from 'react';
import { AccountsTable } from './components/AccountsTable.jsx';
import { Filters } from './components/Filters.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';
import { Pagination, RefreshBar, SelectionBar } from './components/TableToolbar.jsx';
import { UsageChart } from './components/UsageChart.jsx';
import { usePolledResource } from './hooks/usePolledResource.js';
import { useSelection } from './hooks/useSelection.js';
import { useUrlState } from './hooks/useUrlState.js';
import { getSummary, listAccounts } from './lib/api.js';
import { mergeRefreshedPage } from './lib/rows.js';
import {
  FILTER_DEFAULTS,
  hasActiveFilters,
  toAccountsQuery,
  toDateRange,
} from './lib/urlState.js';

export default function App() {
  const [urlState, updateUrl] = useUrlState();
  const { selected, setRows, refreshValues, clear } = useSelection();

  const query = useMemo(() => toAccountsQuery(urlState), [urlState]);
  const dateRange = useMemo(() => toDateRange(urlState), [urlState]);

  const accounts = usePolledResource(
    (signal) => listAccounts(query, signal),
    JSON.stringify(query),
    mergeRefreshedPage,
  );
  const summary = usePolledResource(
    (signal) => getSummary(dateRange, signal),
    JSON.stringify(dateRange),
  );

  const rows = accounts.data?.data;
  useEffect(() => {
    if (rows) refreshValues(rows);
  }, [rows, refreshValues]);

  const applyFilters = useCallback(
    (patch, options) => updateUrl({ ...patch, page: 1 }, options),
    [updateUrl],
  );

  const toggleSort = (column) => {
    const flips = urlState.sort_by === column && urlState.sort_dir === 'asc';
    updateUrl({ sort_by: column, sort_dir: flips ? 'desc' : 'asc', page: 1 });
  };

  const closeDialog = useCallback(() => updateUrl({ account: null, step: 1 }), [updateUrl]);
  const changeStep = useCallback((step) => updateUrl({ step }, { replace: true }), [updateUrl]);
  const clearFilters = () => applyFilters(FILTER_DEFAULTS);
  const hasFilters = hasActiveFilters(urlState);

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <a
        href="#accounts"
        className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to accounts table
      </a>
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 id="page-title" tabIndex={-1} className="text-lg font-semibold">
          Usage Admin Console
        </h1>
      </header>

      <main className="mx-auto flex max-w-screen-2xl flex-col gap-4 p-3 sm:p-4">
        <Filters
          state={urlState}
          onFilterChange={applyFilters}
          onSortChange={updateUrl}
          hasFilters={hasFilters}
        />
        <UsageChart summary={summary} />

        <section
          id="accounts"
          aria-label="Accounts"
          aria-busy={accounts.isLoading}
          className="rounded-lg border border-slate-200 bg-white"
        >
          <SelectionBar selected={selected} onClear={clear} />
          <RefreshBar accounts={accounts} />
          <AccountsTable
            accounts={accounts}
            state={urlState}
            selected={selected}
            onToggle={setRows}
            onSort={toggleSort}
            onEdit={(account) => updateUrl({ account, step: 1 })}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
          />
          <Pagination
            page={urlState.page}
            pageSize={urlState.page_size}
            total={accounts.data?.total ?? 0}
            isReady={Boolean(accounts.data)}
            onChange={updateUrl}
          />
        </section>
      </main>

      {urlState.account && (
        <SettingsDialog
          key={urlState.account}
          accountId={urlState.account}
          stepNumber={urlState.step}
          onStepChange={changeStep}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
