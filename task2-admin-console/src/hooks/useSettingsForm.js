import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ApiError,
  getAccount,
  getSettings,
  saveSettingsStep,
  submitSettings,
} from '../lib/api.js';
import {
  STEP_NUMBERS,
  accountDefaults,
  toFormValues,
  toPayload,
  validateStep,
} from '../lib/settingsSchema.js';

const AUTOSAVE_DELAY_MS = 800;
const NETWORK_FAILURE = 'The server could not be reached or had a problem.';

const sameValues = (a, b) => Object.keys(a).every((key) => a[key] === b[key]);

export const isDirty = (step) => !sameValues(step.values, step.saved ?? step.defaults);
export const needsAttention = (step) =>
  Boolean(step.failure) || Object.keys(step.errors).length > 0;

const initialState = { status: 'loading', loadError: null, prefillFailed: false, steps: null, submit: 'idle', submitError: null };

function buildStep(stepNumber, savedDraft, account) {
  const defaults = accountDefaults(stepNumber, account);
  const saved = savedDraft ? toFormValues(stepNumber, savedDraft) : null;
  return {
    defaults,
    saved,
    values: saved ?? defaults,
    errors: {},
    saveState: 'idle',
    failure: null,
  };
}

function updateStep(state, stepNumber, change) {
  const step = state.steps[stepNumber];
  return {
    ...state,
    steps: { ...state.steps, [stepNumber]: { ...step, ...change(step) } },
  };
}

function withoutKey(object, key) {
  const { [key]: _removed, ...rest } = object;
  return rest;
}

function reducer(state, action) {
  switch (action.type) {
    case 'loading':
      return initialState;
    case 'loaded':
      return { ...initialState, status: 'ready', prefillFailed: action.prefillFailed, steps: action.steps };
    case 'loadFailed':
      return { ...initialState, status: 'error', loadError: action.error };
    case 'edit':
      return updateStep(state, action.step, (step) => ({
        values: { ...step.values, [action.field]: action.value },
        errors: withoutKey(step.errors, action.field),
        saveState: 'idle',
        failure: null,
      }));
    case 'fieldChecked':
      return updateStep(state, action.step, (step) => ({
        errors: action.error
          ? { ...step.errors, [action.field]: action.error }
          : withoutKey(step.errors, action.field),
      }));
    case 'clientInvalid':
      return updateStep(state, action.step, () => ({ errors: action.errors }));
    case 'saving':
      return updateStep(state, action.step, () => ({ saveState: 'saving', failure: null }));
    case 'saved':
      return updateStep(state, action.step, (step) => {
        const isCurrent = sameValues(step.values, action.values);
        return {
          saved: action.values,
          saveState: isCurrent ? 'saved' : 'idle',
          errors: isCurrent ? {} : step.errors,
        };
      });
    case 'saveFailed':
      return updateStep(state, action.step, () => ({
        saveState: 'failed',
        errors: action.errors,
        failure: action.failure,
      }));
    case 'discard':
      return updateStep(state, action.step, (step) => ({
        values: step.saved ?? step.defaults,
        errors: {},
        saveState: 'idle',
        failure: null,
      }));
    case 'submitStarted':
      return { ...state, submit: 'submitting', submitError: null };
    case 'submitBlocked':
      return { ...state, submit: 'idle', submitError: action.message };
    case 'submitted':
      return { ...state, submit: 'done', submitError: null };
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

function failureFromError(error, stepNumber) {
  const detail = error instanceof ApiError && error.status === 422 ? error.detail : null;
  if (detail?.errors) {
    return {
      step: detail.step ?? stepNumber,
      errors: detail.errors,
      failure: { kind: 'validation', message: 'The server rejected this step.' },
    };
  }
  return {
    step: stepNumber,
    errors: {},
    failure: { kind: 'network', message: NETWORK_FAILURE },
  };
}

/**
 * Draft state for the 4-step form.
 *
 * Each step tracks `values` (what's on screen) and `saved` (what the server last
 * accepted). A failed save leaves `saved` alone, so nothing is falsely reported
 * as saved and the user's text stays available until they fix or discard it.
 */
export function useSettingsForm(accountId) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const latestState = useRef(state);
  latestState.current = state;
  const timers = useRef({});
  // One queue per step: saves run in order, and each one sends the latest values.
  const saveQueues = useRef({});

  const load = useCallback(async () => {
    dispatch({ type: 'loading' });
    const [drafts, account] = await Promise.allSettled([
      getSettings(accountId),
      getAccount(accountId),
    ]);
    if (drafts.status === 'rejected') {
      dispatch({ type: 'loadFailed', error: drafts.reason });
      return;
    }
    const accountData = account.status === 'fulfilled' ? account.value : null;
    const steps = Object.fromEntries(
      STEP_NUMBERS.map((n) => [n, buildStep(n, drafts.value[n], accountData)]),
    );
    dispatch({ type: 'loaded', steps, prefillFailed: !accountData });
  }, [accountId]);

  useEffect(() => {
    load();
    const pendingTimers = timers.current;
    return () => Object.values(pendingTimers).forEach(clearTimeout);
  }, [load]);

  const performSave = useCallback(
    async (stepNumber, { force, revealErrors }) => {
      const step = latestState.current.steps[stepNumber];
      // Editing clears 'failed', so this value is unchanged since the server refused it.
      if (step.saveState === 'failed' && !force) return false;
      if (!isDirty(step) && !(force && step.saved === null)) return true;

      const errors = validateStep(stepNumber, step.values);
      if (Object.keys(errors).length > 0) {
        if (revealErrors) dispatch({ type: 'clientInvalid', step: stepNumber, errors });
        return false;
      }

      dispatch({ type: 'saving', step: stepNumber });
      try {
        await saveSettingsStep(accountId, stepNumber, toPayload(stepNumber, step.values));
        dispatch({ type: 'saved', step: stepNumber, values: step.values });
        return true;
      } catch (error) {
        dispatch({ type: 'saveFailed', ...failureFromError(error, stepNumber) });
        return false;
      }
    },
    [accountId],
  );

  const saveStep = useCallback(
    (stepNumber, { force = false, revealErrors = false } = {}) => {
      clearTimeout(timers.current[stepNumber]);
      const previous = saveQueues.current[stepNumber] ?? Promise.resolve();
      const result = previous.then(() => performSave(stepNumber, { force, revealErrors }));
      saveQueues.current[stepNumber] = result;
      return result;
    },
    [performSave],
  );

  const editField = useCallback(
    (stepNumber, field, value) => {
      dispatch({ type: 'edit', step: stepNumber, field, value });
      clearTimeout(timers.current[stepNumber]);
      timers.current[stepNumber] = setTimeout(() => saveStep(stepNumber), AUTOSAVE_DELAY_MS);
    },
    [saveStep],
  );

  const checkField = useCallback((stepNumber, field) => {
    const step = latestState.current.steps[stepNumber];
    if (step.failure) return;
    const error = validateStep(stepNumber, step.values)[field];
    dispatch({ type: 'fieldChecked', step: stepNumber, field, error });
  }, []);

  const discardStep = useCallback((stepNumber) => {
    clearTimeout(timers.current[stepNumber]);
    dispatch({ type: 'discard', step: stepNumber });
  }, []);

  /** Saves whatever can be saved. Returns false if any step is still unsaved. */
  const flushAll = useCallback(async () => {
    const results = await Promise.all(STEP_NUMBERS.map((n) => saveStep(n)));
    return results.every(Boolean);
  }, [saveStep]);

  /** Returns the step number the user needs to look at, or null on success. */
  const submit = useCallback(async () => {
    dispatch({ type: 'submitStarted' });
    const results = await Promise.all(
      STEP_NUMBERS.map((n) => saveStep(n, { force: true, revealErrors: true })),
    );
    const firstFailure = results.indexOf(false);
    if (firstFailure !== -1) {
      const step = STEP_NUMBERS[firstFailure];
      dispatch({ type: 'submitBlocked', message: `Step ${step} needs attention before you can submit.` });
      return step;
    }
    try {
      await submitSettings(accountId);
      dispatch({ type: 'submitted' });
      return null;
    } catch (error) {
      const missing = error.detail?.missing_steps;
      const message = missing
        ? `The server has no saved draft for step ${missing.join(', ')}.`
        : `Submit failed. ${NETWORK_FAILURE} Your drafts are still saved.`;
      dispatch({ type: 'submitBlocked', message });
      return missing?.[0] ?? null;
    }
  }, [accountId, saveStep]);

  return { state, reload: load, editField, checkField, saveStep, discardStep, flushAll, submit };
}
