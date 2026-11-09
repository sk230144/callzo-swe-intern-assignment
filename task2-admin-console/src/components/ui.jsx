const BUTTON_STYLES = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100',
};

/**
 * Uses aria-disabled rather than disabled: a disabled button drops keyboard
 * focus, which would lose the user's place when, say, "Next" reaches the last page.
 */
export function Button({ variant = 'secondary', isDisabled = false, onClick, className = '', ...props }) {
  return (
    <button
      type="button"
      aria-disabled={isDisabled || undefined}
      onClick={isDisabled ? undefined : onClick}
      className={`min-h-10 rounded-md px-3 text-sm font-medium ${BUTTON_STYLES[variant]} ${
        isDisabled ? 'cursor-not-allowed opacity-50' : ''
      } ${className}`}
      {...props}
    />
  );
}

const NOTICE_STYLES = {
  error: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
};

export function Notice({ tone = 'error', role = 'alert', title, children, actions }) {
  return (
    <div role={role} className={`rounded-md border p-3 text-sm ${NOTICE_STYLES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
