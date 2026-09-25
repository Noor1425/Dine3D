'use client';
import { useEffect, useState } from 'react';

/**
 * What the product shows while it is thinking.
 *
 * Three rules shape everything here.
 *
 * **Nothing appears instantly.** A spinner that flashes for 80ms and vanishes
 * reads as a glitch, not as progress — it makes a fast app feel broken. Every
 * indicator below waits before it shows itself, so work that finishes quickly
 * finishes silently.
 *
 * **A skeleton beats a spinner when the shape is known.** A page whose outline
 * appears first feels like it is arriving; a spinner in an empty rectangle
 * feels like it is stuck, and then the real content shoves the layout about
 * when it lands.
 *
 * **It says what it is doing.** "Loading" tells a cashier nothing. "Preparing
 * the till" tells them the thing they are waiting for is the thing they asked
 * for.
 */

/** Long enough that quick work never flashes, short enough to feel responsive. */
const APPEAR_AFTER_MS = 250;

/** True once `delay` has passed, so callers can render nothing before then. */
function useDelayed(delay = APPEAR_AFTER_MS) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return ready;
}

/**
 * A grey block standing in for content that has not arrived.
 *
 * `animate-pulse` is disabled under prefers-reduced-motion by the rule in
 * globals.css, so this stays a plain block for anyone who asked for that.
 */
export function Skeleton({ className = '', style = undefined }) {
  return <div aria-hidden="true" style={style} className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />;
}

/** The spinner itself. Sized to the text it sits beside. */
export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`loading-spinner ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A centred message for a whole screen that is not ready yet.
 *
 * `title` names the thing being fetched; `detail` says what will be there when
 * it arrives. Both are read out, because a screen reader otherwise announces
 * nothing at all while the page sits empty.
 */
export function LoadingScreen({ title = 'Loading', detail = null, delay = APPEAR_AFTER_MS }) {
  const ready = useDelayed(delay);
  if (!ready) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full flex-col items-center justify-center px-6 text-center"
    >
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-glow)] text-[var(--color-primary)]">
        <Spinner className="h-6 w-6" />
      </span>
      <p className="text-base font-bold text-slate-900">{title}</p>
      {detail ? <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">{detail}</p> : null}
    </div>
  );
}

/**
 * An inline indicator for a region of a page, not the whole thing.
 * Used where a table or a panel is refreshing under a header that already
 * rendered — the page should not jump back to a full-screen spinner for that.
 */
export function LoadingBlock({ label = 'Loading', className = '', delay = APPEAR_AFTER_MS }) {
  const ready = useDelayed(delay);
  if (!ready) return null;

  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-2.5 py-10 text-sm text-slate-500 ${className}`}>
      <Spinner className="h-4 w-4 text-[var(--color-primary)]" />
      <span>{label}</span>
    </div>
  );
}

/**
 * The state of a button that is doing something.
 *
 * Takes over the button's own label rather than sitting beside it, so the
 * button does not change width mid-press and move under the finger.
 */
export function ButtonSpinner({ label = 'Working…' }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <Spinner className="h-4 w-4" />
      <span>{label}</span>
    </span>
  );
}

/**
 * The outline of an ordinary admin page: a heading, a line of explanation and
 * some content. Rendered by app/admin/loading.js the instant a link is
 * clicked, so a navigation shows the shape of where you are going rather than
 * leaving the last page frozen while the next one loads.
 */
export function PageSkeleton({ rows = 5 }) {
  return (
    <div role="status" aria-live="polite" className="w-full">
      <span className="sr-only">Loading the page</span>

      <div className="mb-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            // Rows taper slightly, so the block reads as a list rather than a
            // grey slab.
            <Skeleton key={i} className="h-11 w-full" style={{ opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default LoadingScreen;
