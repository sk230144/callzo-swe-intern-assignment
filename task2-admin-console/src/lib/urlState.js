export const SORTABLE_COLUMNS = [
  'id',
  'name',
  'company',
  'country',
  'plan',
  'status',
  'signup_date',
  'current_month_minutes',
  'current_month_sms',
  'cost_cents',
  'last_active',
];
export const PAGE_SIZES = [25, 50, 100, 200];
export const STATUSES = ['active', 'trial', 'suspended'];
export const PLANS = ['basic', 'pro', 'enterprise'];
const STEP_COUNT = 4;

export const FILTER_DEFAULTS = {
  search: '',
  status: '',
  country: '',
  plan: '',
  date_from: '',
  date_to: '',
};

const DEFAULTS = {
  ...FILTER_DEFAULTS,
  page: 1,
  page_size: 25,
  sort_by: 'id',
  sort_dir: 'asc',
  account: null,
  step: 1,
};

const positiveInt = (raw) => (/^[1-9]\d*$/.test(raw ?? '') ? Number(raw) : null);
const oneOf = (raw, allowed) => (allowed.includes(raw) ? raw : null);
const isoDate = (raw) => (/^\d{4}-\d{2}-\d{2}$/.test(raw ?? '') ? raw : null);

/** Reads the address bar, ignoring anything invalid so a bad link still opens. */
export function parseUrlState(search) {
  const params = new URLSearchParams(search);
  const pageSize = Number(params.get('page_size'));
  const step = positiveInt(params.get('step'));
  return {
    page: positiveInt(params.get('page')) ?? DEFAULTS.page,
    page_size: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULTS.page_size,
    search: params.get('search') ?? DEFAULTS.search,
    status: oneOf(params.get('status'), STATUSES) ?? DEFAULTS.status,
    country: params.get('country')?.slice(0, 2).toUpperCase() ?? DEFAULTS.country,
    plan: oneOf(params.get('plan'), PLANS) ?? DEFAULTS.plan,
    date_from: isoDate(params.get('date_from')) ?? DEFAULTS.date_from,
    date_to: isoDate(params.get('date_to')) ?? DEFAULTS.date_to,
    sort_by: oneOf(params.get('sort_by'), SORTABLE_COLUMNS) ?? DEFAULTS.sort_by,
    sort_dir: oneOf(params.get('sort_dir'), ['asc', 'desc']) ?? DEFAULTS.sort_dir,
    account: positiveInt(params.get('account')) ?? DEFAULTS.account,
    step: step && step <= STEP_COUNT ? step : DEFAULTS.step,
  };
}

/** Writes only non-default values, so shared links stay short. */
export function serializeUrlState(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value !== DEFAULTS[key]) params.set(key, value);
  }
  return params.toString();
}

export function toAccountsQuery(state) {
  const { account: _account, step: _step, ...query } = state;
  return query;
}

export function toDateRange(state) {
  return { date_from: state.date_from, date_to: state.date_to };
}

export function hasActiveFilters(state) {
  return Object.entries(FILTER_DEFAULTS).some(([key, value]) => state[key] !== value);
}
