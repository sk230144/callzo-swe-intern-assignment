const numberFormat = new Intl.NumberFormat('en-US');
const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact' });
const compactMoneyFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
});
const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'medium' });

export const formatNumber = (value) => numberFormat.format(value);
export const formatCompact = (value) => compactFormat.format(value);
export const formatCents = (cents) => moneyFormat.format(cents / 100);
export const formatCompactCents = (cents) => compactMoneyFormat.format(cents / 100);
export const formatDate = (isoDate) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
export const formatTime = (timestamp) => timeFormat.format(timestamp);
