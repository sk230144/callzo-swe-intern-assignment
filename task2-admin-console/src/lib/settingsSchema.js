export const STEP_NUMBERS = [1, 2, 3, 4];

const BILLING_COUNTRIES = ['US', 'IN', 'GB', 'CA', 'AU'];

export const STEPS = {
  1: {
    title: 'Contact',
    fields: [
      { name: 'name', label: 'Account name', type: 'text', required: true, autoComplete: 'name' },
      { name: 'email', label: 'Email', type: 'email', required: true, autoComplete: 'email' },
    ],
  },
  2: {
    title: 'Plan and billing',
    fields: [
      {
        name: 'plan',
        label: 'Plan',
        type: 'select',
        required: true,
        options: ['basic', 'pro', 'enterprise'],
      },
      {
        name: 'billing_country',
        label: 'Billing country',
        type: 'select',
        required: true,
        options: BILLING_COUNTRIES,
      },
    ],
  },
  3: {
    title: 'Usage caps',
    fields: [
      { name: 'minutes_cap', label: 'Monthly minutes cap', type: 'number', hint: 'Optional.' },
      { name: 'sms_cap', label: 'Monthly SMS cap', type: 'number', hint: 'Optional.' },
    ],
  },
  4: {
    title: 'Webhook',
    fields: [
      {
        name: 'webhook_url',
        label: 'Webhook URL',
        type: 'url',
        hint: 'Optional. Must start with http:// or https://.',
      },
    ],
  },
};

/** Mirrors the server's rules, and also rejects negative caps, which it would accept. */
export function validateStep(stepNumber, values) {
  const errors = {};
  for (const field of STEPS[stepNumber].fields) {
    const value = values[field.name].trim();
    if (field.required && !value) {
      errors[field.name] = `${field.label} is required`;
    } else if (value && field.type === 'email' && !value.includes('@')) {
      errors[field.name] = 'Enter an email address containing @';
    } else if (value && field.type === 'number' && !(Number(value) >= 0)) {
      errors[field.name] = 'Enter 0 or a higher number';
    } else if (value && field.type === 'url' && !/^https?:\/\//.test(value)) {
      errors[field.name] = 'Must start with http:// or https://';
    }
  }
  return errors;
}

/** Form inputs hold strings; the API takes numbers and omits empty optional fields. */
export function toPayload(stepNumber, values) {
  const payload = {};
  for (const field of STEPS[stepNumber].fields) {
    const value = values[field.name].trim();
    if (value) payload[field.name] = field.type === 'number' ? Number(value) : value;
  }
  return payload;
}

export function toFormValues(stepNumber, source = {}) {
  return Object.fromEntries(
    STEPS[stepNumber].fields.map((field) => [field.name, String(source[field.name] ?? '')]),
  );
}

/** Values to start from when a step has no saved draft yet. */
export function accountDefaults(stepNumber, account) {
  if (!account || stepNumber > 2) return toFormValues(stepNumber);
  if (stepNumber === 1) return toFormValues(1, account);
  return toFormValues(2, {
    plan: account.plan,
    billing_country: BILLING_COUNTRIES.includes(account.country) ? account.country : '',
  });
}
