'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * A looping step counter that only runs while it is on screen.
 *
 * The landing page shows several of these at once. Left running, they would
 * keep re-rendering behind the fold and drain a phone battery to animate
 * something nobody is looking at — so the loop is tied to visibility.
 *
 * Anyone who has asked their system to stop moving things gets the finished
 * state immediately and no timer at all. That is the whole point of the
 * setting: not a slower animation, no animation.
 *
 * Returns [step, ref]: attach the ref to the element being watched.
 */
export function useStep(count, intervalMs = 1200, { holdAtEnd = 0 } = {}) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) {
      setStep(count - 1);
      return undefined;
    }
    if (!visible) return undefined;

    // The next timer is scheduled OUTSIDE the state updater, and that matters.
    // Scheduling inside it made the updater impure, and React double-invokes
    // updaters under StrictMode — so every tick armed two timers, each of which
    // armed two more. They multiplied until the loop raced and the panel
    // flickered, and the cleanup only ever cleared the most recent one.
    let timer;
    let current = 0;
    setStep(0);

    const tick = () => {
      current = (current + 1) % count;
      setStep(current);
      // Pause on the finished state so it can be read before it starts over.
      timer = setTimeout(tick, current === count - 1 ? intervalMs + holdAtEnd : intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => clearTimeout(timer);
  }, [visible, reduced, count, intervalMs, holdAtEnd]);

  return [step, ref, reduced];
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Count from 0 to `value` when it changes, for figures that should tick up. */
export function useCountUp(value, durationMs = 600) {
  const [shown, setShown] = useState(value);
  const reduced = usePrefersReducedMotion();
  const from = useRef(value);

  useEffect(() => {
    if (reduced) { setShown(value); return undefined; }
    const start = performance.now();
    const origin = from.current;
    let frame;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease out, so it settles rather than stopping dead.
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(origin + (value - origin) * eased);
      // Track what is actually on screen, not just the last completed target.
      // Otherwise a value that changes mid-count restarts from a number nobody
      // ever saw, and the figure visibly jumps.
      from.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduced]);

  return shown;
}
