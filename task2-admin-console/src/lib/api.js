const API_BASE = '/api';

export class ApiError extends Error {
  constructor(status, detail) {
    super(`Request failed with status ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, payload?.detail);
  return payload;
}

function toQueryString(params) {
  const present = Object.entries(params).filter(([, value]) => value !== '' && value != null);
  return present.length ? `?${new URLSearchParams(present)}` : '';
}

export function listAccounts(query, signal) {
  return request(`/accounts${toQueryString(query)}`, { signal });
}

/** This endpoint fails about 1 call in 5, so one quiet retry hides most of it. */
export async function getSummary(dateRange, signal) {
  const load = () => request(`/accounts/summary${toQueryString(dateRange)}`, { signal });
  try {
    return await load();
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) return load();
    throw error;
  }
}

export function getAccount(accountId) {
  return request(`/accounts/${accountId}`);
}

export function getSettings(accountId) {
  return request(`/accounts/${accountId}/settings`);
}

export function saveSettingsStep(accountId, step, data) {
  return request(`/accounts/${accountId}/settings/step/${step}`, {
    method: 'PUT',
    body: { data },
  });
}

export function submitSettings(accountId) {
  return request(`/accounts/${accountId}/settings/submit`, { method: 'POST' });
}
