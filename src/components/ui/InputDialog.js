'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A replacement for window.prompt().
 *
 * The till is an Electron app, and Electron does not implement prompt() — it
 * throws "prompt() is not supported.". So every control that asked for a cash
 * amount, a void reason or a table number died silently on the one device a
 * restaurant actually runs: the button did nothing and said nothing, because
 * the throw happened before the handler's try/catch and surfaced only as an
 * unhandled rejection in a console nobody has open during service.
 *
 * It also asks for everything at once. Closing a shift used to be two
 * consecutive prompts — the cash count, then the notes — with no way back to
 * the first once you had answered it.
 *
 * Returns [dialog, ask]. Render `dialog` once anywhere in the tree; `ask()`
 * resolves with an object of the typed values, or null if the operator backed
 * out. A single-field call still resolves to an object: ask(...).then(r => r.amount).
 */
export function useInputDialog() {
  const [request, setRequest] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const resolverRef = useRef(null);
  const firstFieldRef = useRef(null);

  const close = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    setValues({});
    setError('');
    if (resolve) resolve(result);
  }, []);

  const ask = useCallback((options) => {
    // A second ask while one is open would strand the first caller forever.
    if (resolverRef.current) resolverRef.current(null);
    const fields = options.fields || [{ name: 'value', ...options }];
    setValues(Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ''])));
    setError('');
    setRequest({ ...options, fields });
    return new Promise((resolve) => { resolverRef.current = resolve; });
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    const timer = setTimeout(() => firstFieldRef.current?.focus(), 30);
    const onKey = (event) => { if (event.key === 'Escape') close(null); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [request, close]);

  const submit = () => {
    for (const field of request.fields) {
      const raw = String(values[field.name] ?? '').trim();
      if (field.required && !raw) {
        setError(`${field.label} is required.`);
        return;
      }
      if (raw && field.type === 'number') {
        const amount = Number(raw);
        if (!Number.isFinite(amount)) {
          setError(`${field.label} must be a number.`);
          return;
        }
        if (field.min !== undefined && amount < field.min) {
          setError(`${field.label} must be at least ${field.min}.`);
          return;
        }
      }
      if (field.minLength && raw.length < field.minLength) {
        setError(`${field.label} must be at least ${field.minLength} characters.`);
        return;
      }
    }
    close(Object.fromEntries(request.fields.map((f) => [f.name, String(values[f.name] ?? '').trim()])));
  };

  const dialog = request ? (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="input-dialog-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(null); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="input-dialog-title" className="text-lg font-extrabold tracking-tight text-slate-900">
            {request.title}
          </h2>
          {request.description ? (
            <p className="mt-1 text-sm leading-5 text-slate-500">{request.description}</p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {request.fields.map((field, index) => (
            <label key={field.name} className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {field.label}
                {field.required ? null : <span className="ml-1 normal-case tracking-normal text-slate-400">(optional)</span>}
              </span>
              <div className="mt-2 flex items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-slate-400">
                {field.prefix ? (
                  <span className="pr-1 text-sm font-semibold text-slate-400">{field.prefix}</span>
                ) : null}
                <input
                  ref={index === 0 ? firstFieldRef : null}
                  type={field.type === 'number' ? 'number' : 'text'}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  step={field.type === 'number' ? 'any' : undefined}
                  value={values[field.name] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) => {
                    setValues((previous) => ({ ...previous, [field.name]: event.target.value }));
                    setError('');
                  }}
                  onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
                  className="h-11 flex-1 bg-transparent text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none"
                />
              </div>
              {field.hint ? <p className="mt-1.5 text-[11px] text-slate-500">{field.hint}</p> : null}
            </label>
          ))}

          {error ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={() => close(null)}
            className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className={`h-11 flex-[1.4] rounded-xl text-sm font-bold text-white transition hover:opacity-90 ${
              request.destructive ? 'bg-rose-600' : 'bg-slate-950'
            }`}
          >
            {request.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [dialog, ask];
}
