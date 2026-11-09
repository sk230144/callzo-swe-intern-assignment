import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isDirty, needsAttention, useSettingsForm } from '../hooks/useSettingsForm.js';
import { STEPS, STEP_NUMBERS } from '../lib/settingsSchema.js';
import { Button, Notice } from './ui.jsx';

const INPUT = 'mt-1 block min-h-10 w-full rounded-md border bg-white px-2 text-sm';
const LAST_STEP = STEP_NUMBERS.at(-1);

function firstUnsavedStep(steps) {
  return STEP_NUMBERS.find((n) => steps[n].saved === null) ?? LAST_STEP;
}

function saveStatusText(step) {
  if (step.saveState === 'saving') return 'Saving draft…';
  if (step.saveState === 'failed') return 'Not saved';
  if (isDirty(step)) return 'Unsaved changes';
  return step.saved ? 'Draft saved' : '';
}

/** True when the server is applying its rule that step 2 rejects saves once step 4 exists. */
function isBillingLocked(stepNumber, steps) {
  return (
    stepNumber === 2 &&
    steps[2].failure?.kind === 'validation' &&
    Boolean(steps[2].values.billing_country) &&
    steps[4].saved !== null
  );
}

function Stepper({ steps, current, furthest, onSelect }) {
  return (
    <nav aria-label="Form steps">
      <ol className="grid grid-cols-4 gap-1">
        {STEP_NUMBERS.map((n) => {
          const flagged = needsAttention(steps[n]);
          const isLocked = n > furthest;
          const status = flagged ? 'needs attention' : steps[n].saved ? 'saved' : 'not saved yet';
          const marker = flagged ? '!' : steps[n].saved ? '✓' : n;
          return (
            <li key={n}>
              <button
                type="button"
                aria-current={n === current ? 'step' : undefined}
                aria-disabled={isLocked || undefined}
                aria-label={`Step ${n}, ${STEPS[n].title}, ${status}${isLocked ? ', complete earlier steps first' : ''}`}
                onClick={isLocked ? undefined : () => onSelect(n)}
                className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border px-1 text-xs sm:text-sm ${
                  n === current ? 'border-blue-700 bg-blue-50 font-semibold' : 'border-slate-200'
                } ${isLocked ? 'cursor-not-allowed opacity-50' : ''} ${flagged ? 'border-red-500 text-red-900' : ''}`}
              >
                <span aria-hidden="true">{marker}</span>
                <span className={n === current ? '' : 'hidden sm:inline'}>{STEPS[n].title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Field({ field, value, error, onChange, onBlur }) {
  const errorId = `${field.name}-error`;
  const hintId = `${field.name}-hint`;
  const describedBy = [error && errorId, field.hint && hintId].filter(Boolean).join(' ');
  const shared = {
    id: field.name,
    value,
    required: field.required,
    onBlur,
    onChange: (event) => onChange(event.target.value),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: `${INPUT} ${error ? 'border-red-600' : 'border-slate-300'}`,
  };

  return (
    <div>
      <label htmlFor={field.name} className="block text-sm font-medium text-slate-800">
        {field.label}
        {field.required && <span className="text-red-800"> (required)</span>}
      </label>
      {field.type === 'select' ? (
        <select {...shared}>
          <option value="">Choose…</option>
          {field.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          type={field.type}
          min={field.type === 'number' ? 0 : undefined}
          autoComplete={field.autoComplete ?? 'off'}
        />
      )}
      {field.hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-600">
          {field.hint}
        </p>
      )}
      {/* Always rendered: an error appearing on blur must not move the button being clicked. */}
      <p id={errorId} className="mt-1 min-h-5 text-sm text-red-800">
        {error}
      </p>
    </div>
  );
}

function SaveFailure({ stepNumber, steps, onRetry, onDiscard }) {
  const step = steps[stepNumber];
  if (!step.failure) return null;
  const fieldNames = STEPS[stepNumber].fields.map((field) => field.name);
  const otherErrors = Object.entries(step.errors).filter(([name]) => !fieldNames.includes(name));
  const lastSaved = step.saved
    ? 'Your last saved values are still in place.'
    : 'Nothing has been saved for this step yet.';

  return (
    <Notice
      title="This step wasn't saved"
      actions={
        <>
          {step.failure.kind === 'network' && <Button onClick={onRetry}>Try again</Button>}
          <Button onClick={onDiscard}>{step.saved ? 'Discard my changes' : 'Reset this step'}</Button>
        </>
      }
    >
      {isBillingLocked(stepNumber, steps) ? (
        <p>
          Plan and billing can't be changed once a webhook draft exists, even though a country is
          selected. {lastSaved} Discard your change to continue with the saved values.
        </p>
      ) : (
        <p>
          {step.failure.message} {lastSaved}
        </p>
      )}
      {otherErrors.map(([name, message]) => (
        <p key={name}>{message}</p>
      ))}
    </Notice>
  );
}

function OtherStepFailures({ steps, current, onSelect }) {
  const failed = STEP_NUMBERS.filter((n) => n !== current && steps[n].failure);
  if (failed.length === 0) return null;
  return (
    <Notice
      tone="warning"
      title={`Step ${failed.join(' and ')} couldn't be saved`}
      actions={failed.map((n) => (
        <Button key={n} onClick={() => onSelect(n)}>
          Go to step {n}
        </Button>
      ))}
    />
  );
}

/** Opens a native modal, which traps focus, and returns focus to the opener afterwards. */
function useModal(onRequestClose, onClosed) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      const canReturn = opener?.isConnected && opener !== document.body;
      (canReturn ? opener : document.getElementById('page-title'))?.focus();
    };
  }, []);

  return {
    ref,
    onCancel: (event) => {
      event.preventDefault();
      onRequestClose();
    },
    onClose: onClosed,
  };
}

function SubmittedView({ headingRef, onDone }) {
  return (
    <div className="py-6">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold text-slate-900">
        Settings submitted
      </h3>
      <p className="mt-1 text-sm text-slate-700">All four steps were saved for this account.</p>
      <Button variant="primary" className="mt-4" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function submitLabel(stepNumber, submitState) {
  if (stepNumber !== LAST_STEP) return 'Save and continue';
  return submitState === 'submitting' ? 'Submitting…' : 'Submit';
}

function StepForm({ form, visibleStep, furthest, headingRef, formRef, onSelectStep, onAdvance }) {
  const { state } = form;
  const step = state.steps[visibleStep];

  const handleSubmit = (event) => {
    event.preventDefault();
    if (state.submit !== 'submitting') onAdvance();
  };

  const handleDiscard = () => {
    form.discardStep(visibleStep);
    headingRef.current?.focus();
  };

  return (
    <>
      <Stepper
        steps={state.steps}
        current={visibleStep}
        furthest={furthest}
        onSelect={onSelectStep}
      />
      <OtherStepFailures steps={state.steps} current={visibleStep} onSelect={onSelectStep} />

      <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 ref={headingRef} tabIndex={-1} className="font-semibold text-slate-900">
            Step {visibleStep} of {LAST_STEP}: {STEPS[visibleStep].title}
          </h3>
          <p role="status" className="shrink-0 text-xs text-slate-600">
            {saveStatusText(step)}
          </p>
        </div>

        <SaveFailure
          stepNumber={visibleStep}
          steps={state.steps}
          onRetry={() => form.saveStep(visibleStep, { force: true, revealErrors: true })}
          onDiscard={handleDiscard}
        />

        {STEPS[visibleStep].fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={step.values[field.name]}
            error={step.errors[field.name]}
            onChange={(value) => form.editField(visibleStep, field.name, value)}
            onBlur={() => form.checkField(visibleStep, field.name)}
          />
        ))}

        {state.submitError && <Notice>{state.submitError}</Notice>}

        <div className="flex justify-between gap-2">
          <Button isDisabled={visibleStep === 1} onClick={() => onSelectStep(visibleStep - 1)}>
            Back
          </Button>
          <button
            type="submit"
            aria-disabled={state.submit === 'submitting' || undefined}
            className="min-h-10 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800"
          >
            {submitLabel(visibleStep, state.submit)}
          </button>
        </div>
      </form>
    </>
  );
}

export function SettingsDialog({ accountId, stepNumber, onStepChange, onClose }) {
  const form = useSettingsForm(accountId);
  const { state } = form;
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const headingRef = useRef(null);
  const formRef = useRef(null);

  const requestClose = useCallback(async () => {
    if (state.status !== 'ready' || state.submit === 'done' || (await form.flushAll())) onClose();
    else setIsConfirmingClose(true);
  }, [form, onClose, state.status, state.submit]);

  const modal = useModal(requestClose, onClose);
  const furthest = state.steps ? firstUnsavedStep(state.steps) : 1;
  const visibleStep = Math.min(stepNumber, furthest);

  useEffect(() => {
    headingRef.current?.focus();
  }, [visibleStep, state.status, state.submit]);

  const focusFirstProblem = () => {
    requestAnimationFrame(() => {
      const invalid = formRef.current?.querySelector('[aria-invalid="true"]');
      (invalid ?? headingRef.current)?.focus();
    });
  };

  const selectStep = (next) => {
    form.saveStep(visibleStep);
    onStepChange(next);
  };

  const advance = async () => {
    if (visibleStep === LAST_STEP) {
      const stepToFix = await form.submit();
      if (stepToFix) {
        onStepChange(stepToFix);
        focusFirstProblem();
      }
    } else if (await form.saveStep(visibleStep, { force: true, revealErrors: true })) {
      onStepChange(visibleStep + 1);
    } else {
      focusFirstProblem();
    }
  };

  const loadErrorIs404 = state.loadError?.status === 404;

  return (
    <dialog
      {...modal}
      aria-labelledby="settings-title"
      className="m-0 h-dvh max-h-none w-full max-w-none bg-white p-0 backdrop:bg-slate-900/50 sm:m-auto sm:h-fit sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-lg"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <header className="flex items-center justify-between gap-2">
          <h2 id="settings-title" className="text-lg font-semibold text-slate-900">
            Settings for account {accountId}
          </h2>
          <Button onClick={requestClose}>Close</Button>
        </header>

        {state.status === 'loading' && (
          <p role="status" className="py-12 text-center text-sm text-slate-600">
            Loading saved drafts…
          </p>
        )}

        {state.status === 'error' && (
          <Notice
            title={loadErrorIs404 ? "This account doesn't exist" : "Saved drafts didn't load"}
            actions={!loadErrorIs404 && <Button onClick={form.reload}>Retry</Button>}
          >
            {!loadErrorIs404 && 'The form stays closed until drafts load, so nothing gets overwritten.'}
          </Notice>
        )}

        {state.status === 'ready' && state.submit === 'done' && (
          <SubmittedView headingRef={headingRef} onDone={onClose} />
        )}

        {state.status === 'ready' && state.submit !== 'done' && (
          <>
            {state.prefillFailed && (
              <Notice tone="warning" role="status">
                Account details couldn't be loaded, so new fields aren't prefilled. Saved drafts are
                shown as normal.
              </Notice>
            )}
            <StepForm
              form={form}
              visibleStep={visibleStep}
              furthest={furthest}
              headingRef={headingRef}
              formRef={formRef}
              onSelectStep={selectStep}
              onAdvance={advance}
            />
            {isConfirmingClose && (
              <Notice
                tone="warning"
                title="Some changes aren't saved"
                actions={
                  <>
                    <Button onClick={() => setIsConfirmingClose(false)}>Keep editing</Button>
                    <Button onClick={onClose}>Discard and close</Button>
                  </>
                }
              >
                Closing now loses the changes that couldn't be saved. Saved drafts are kept.
              </Notice>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
