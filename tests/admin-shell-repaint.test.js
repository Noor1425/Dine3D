const fs = require('fs');
const path = require('path');

/**
 * The backoffice shell must not ask the browser to blur what is behind it.
 *
 * The shell is a viewport-height box with overflow hidden, and the content area
 * inside it is its own scroll container. A sticky bar sitting above that with a
 * backdrop-filter is a compositing layer that has to keep re-sampling whatever
 * scrolls underneath it — and Chrome drops that sample when the window is
 * re-composited, which is exactly what a native file dialog does when it takes
 * focus. The page behind then paints as an empty block until something forces a
 * repaint.
 *
 * It looked like a layout bug for a long time. It was not: the layout was
 * always correct and the pixels were stale, which is why measuring the boxes
 * found nothing wrong.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const ADMIN_CSS = read('src', 'styles', 'admin.css');
const LAYOUT = read('src', 'app', 'admin', 'layout.js');

// Declarations only. The comment inside this rule explains the backdrop-filter
// that caused all this, and should keep doing so.
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const topbarRule = withoutComments(ADMIN_CSS.match(/\.admin-topbar\s*\{([\s\S]*?)\n\}/)[1]);
const topbarMarkup = LAYOUT.match(/className="admin-topbar[^"]*"/)[0];

test('the sticky topbar is not a backdrop-filter layer', () => {
  expect(topbarRule).not.toMatch(/backdrop-filter/);
  expect(topbarMarkup).not.toMatch(/backdrop-blur/);
});

test('the topbar is opaque, so nothing needs to show through it', () => {
  // A translucent bar without the blur would show sharp content sliding under
  // it, which is worse than either. Opaque is the whole point.
  expect(topbarRule).toMatch(/background:\s*#FFFFFF/i);
  expect(topbarMarkup).toMatch(/\bbg-white\b/);
  expect(topbarMarkup).not.toMatch(/bg-white\/\d+/);
});

test('a blurred overlay only exists while it is actually being shown', () => {
  // The drawer scrim is a legitimate use: it covers the viewport for as long as
  // the drawer is open and is unmounted the rest of the time, so it is never a
  // live layer behind an ordinary page.
  const scrim = LAYOUT.match(/\{sidebarOpen && \([\s\S]{0,400}?\)\}/);
  expect(scrim).not.toBeNull();
  expect(scrim[0]).toMatch(/backdrop-blur-sm/);
});
