'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The thin bar that crosses the top of the screen while a page is on its way.
 *
 * It exists to answer one question a skeleton cannot: *did my click register?*
 * A skeleton only appears once the router commits to the new route, and on a
 * slow connection that can be a second after the press — during which the old
 * page sits there looking ignored and people click again.
 *
 * It advances quickly at first and then crawls towards 90%, never reaching the
 * end on its own. A bar that fills and then waits is worse than no bar: it has
 * told you it finished and then made you keep waiting. Only the arrival of the
 * new page completes it.
 *
 * Like everything else here it waits before appearing, so a fast navigation —
 * which most are, once the app is built — shows nothing at all.
 */

const APPEAR_AFTER_MS = 180;

export default function RouteProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const firstRender = useRef(true);
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    // The first paint is not a navigation — the page is already here.
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }

    // A completed navigation: finish the bar, then take it away.
    setWidth(100);
    const done = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 260);
    return () => clearTimeout(done);
  }, [pathname]);

  useEffect(() => {
    // Any click on a link to somewhere else starts the bar. Listening on the
    // document rather than wrapping every Link means a page added later is
    // covered without anyone remembering to opt in.
    const onClick = (event) => {
      const link = event.target?.closest?.('a[href]');
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;

      const href = link.getAttribute('href');
      if (!href || !href.startsWith('/') || href === pathname) return;

      clearTimers();
      timers.current.push(setTimeout(() => {
        setVisible(true);
        setWidth(18);
      }, APPEAR_AFTER_MS));
      // Two more nudges, each smaller, so it keeps moving without pretending
      // to know how long the page will take.
      timers.current.push(setTimeout(() => setWidth(64), APPEAR_AFTER_MS + 260));
      timers.current.push(setTimeout(() => setWidth(88), APPEAR_AFTER_MS + 900));
    };

    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      clearTimers();
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      className="route-progress"
      style={{ width: `${width}%`, opacity: width === 100 ? 0 : 1 }}
      role="progressbar"
      aria-label="Loading the next page"
      aria-hidden={width === 100}
    />
  );
}
