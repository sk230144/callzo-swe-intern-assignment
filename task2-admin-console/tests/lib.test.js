import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bucketSeries } from '../src/lib/chartData.js';
import { mergeRefreshedPage } from '../src/lib/rows.js';
import { toFormValues, toPayload, validateStep } from '../src/lib/settingsSchema.js';
import { parseUrlState, serializeUrlState } from '../src/lib/urlState.js';

const row = (id, cost = 1) => ({ id, cost_cents: cost });
const page = (...rows) => ({ data: rows, total: rows.length, page: 1, page_size: 25 });
const point = (date) => ({ date, minutes: 1, sms: 2, cost_cents: 3, signups: 4 });
const dayAfter = (year, month, day, offset) =>
  new Date(Date.UTC(year, month, day + offset)).toISOString().slice(0, 10);

test('a refresh updates values without moving rows', () => {
  const merged = mergeRefreshedPage(page(row(1), row(2)), page(row(2, 9), row(1, 7)));

  assert.deepEqual(merged.data.map((r) => r.id), [1, 2]);
  assert.deepEqual(merged.data.map((r) => r.cost_cents), [7, 9]);
  assert.equal(merged.orderChanged, true);
});

test('a refresh in the same order is not reported as a change', () => {
  const merged = mergeRefreshedPage(page(row(1), row(2)), page(row(1, 5), row(2)));

  assert.equal(merged.orderChanged, false);
});

test('a row that left the page keeps its place until the user reloads', () => {
  const merged = mergeRefreshedPage(page(row(1), row(2)), page(row(1), row(3)));

  assert.deepEqual(merged.data.map((r) => r.id), [1, 2]);
  assert.equal(merged.orderChanged, true);
});

test('a refresh with no earlier data uses the fresh page', () => {
  const fresh = page(row(1));

  assert.equal(mergeRefreshedPage(null, fresh), fresh);
});

test('URL state round-trips', () => {
  const state = parseUrlState('?page=3&status=trial&sort_by=cost_cents&sort_dir=desc&account=42&step=2');

  assert.deepEqual(parseUrlState(`?${serializeUrlState(state)}`), state);
});

test('invalid URL values fall back to defaults', () => {
  const state = parseUrlState('?page=-1&page_size=999&status=nope&sort_by=x&step=9&date_from=soon');

  assert.equal(state.page, 1);
  assert.equal(state.page_size, 25);
  assert.equal(state.status, '');
  assert.equal(state.sort_by, 'id');
  assert.equal(state.step, 1);
  assert.equal(state.date_from, '');
});

test('default state produces an empty query string', () => {
  assert.equal(serializeUrlState(parseUrlState('')), '');
});

test('short ranges stay daily', () => {
  const { granularity, points } = bucketSeries([point('2026-01-01'), point('2026-01-02')]);

  assert.equal(granularity, 'day');
  assert.equal(points.length, 2);
});

test('medium ranges group by Monday-start weeks and add up', () => {
  const days = Array.from({ length: 70 }, (_, i) => point(dayAfter(2026, 0, 5, i)));

  const { granularity, points } = bucketSeries(days);

  assert.equal(granularity, 'week');
  assert.equal(points.length, 10);
  assert.equal(points[0].date, '2026-01-05');
  assert.equal(points[0].cost_cents, 21);
});

test('long ranges group by month', () => {
  const days = Array.from({ length: 400 }, (_, i) => point(dayAfter(2025, 0, 1, i)));

  assert.equal(bucketSeries(days).granularity, 'month');
});

test('an empty series is handled', () => {
  assert.deepEqual(bucketSeries([]).points, []);
});

test('step validation matches the server rules', () => {
  assert.deepEqual(Object.keys(validateStep(1, { name: ' ', email: 'nope' })), ['name', 'email']);
  assert.deepEqual(validateStep(1, { name: 'A', email: 'a@b.c' }), {});
  assert.deepEqual(validateStep(4, { webhook_url: '' }), {});
  assert.ok(validateStep(4, { webhook_url: 'ftp://x' }).webhook_url);
});

test('negative caps are rejected although the server would accept them', () => {
  assert.ok(validateStep(3, { minutes_cap: '-5', sms_cap: '' }).minutes_cap);
});

test('the payload omits empty optional fields and converts numbers', () => {
  assert.deepEqual(toPayload(3, { minutes_cap: '100', sms_cap: '' }), { minutes_cap: 100 });
});

test('saved numbers become strings for the form', () => {
  assert.deepEqual(toFormValues(3, { minutes_cap: 0 }), { minutes_cap: '0', sms_cap: '' });
});
