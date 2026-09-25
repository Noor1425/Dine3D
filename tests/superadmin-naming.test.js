const fs = require('fs');
const path = require('path');

/**
 * The control plane calls each page one thing.
 *
 * A page's name was written in three places — the sidebar, a hand-kept title
 * map in the header, and the page's own heading — and all three had drifted.
 * Four pages were missing from the title map entirely and rendered as
 * "Control plane › Control plane", and fifteen headings disagreed with the
 * sidebar link that led to them: you clicked "Activity feed" and arrived at
 * "Admin audit log".
 *
 * The header now derives its title from the navigation, so that half cannot
 * drift again. This holds the other half: the page you land on has to agree
 * with the link you clicked.
 */

const SUPERADMIN = path.join(__dirname, '..', 'src', 'app', 'superadmin');
const LAYOUT = fs.readFileSync(path.join(SUPERADMIN, 'layout.js'), 'utf8');

/** Every sidebar entry that leads to a page of its own. */
const navEntries = () => {
  const block = LAYOUT.slice(LAYOUT.indexOf('const NAV = ['), LAYOUT.indexOf('\n];', LAYOUT.indexOf('const NAV = [')));
  return [...block.matchAll(/href:\s*'\/superadmin\/([a-z0-9-]+)'\s*,\s*label:\s*'([^']+)'/g)]
    .map(([, slug, label]) => ({ slug, label }));
};

/** The first <h1> a page renders, with JSX entities resolved. */
const headingOf = (slug) => {
  const file = path.join(SUPERADMIN, slug, 'page.js');
  if (!fs.existsSync(file)) return null;
  const match = fs.readFileSync(file, 'utf8').match(/<h1[^>]*>([^<{]+)<\/h1>/);
  return match ? match[1].replaceAll('&amp;', '&').trim() : null;
};

const entries = navEntries();

test('the sidebar is not empty (the parser still finds it)', () => {
  // Without this, every assertion below would vacuously pass if the NAV
  // structure were rewritten into a shape the regex misses.
  expect(entries.length).toBeGreaterThanOrEqual(15);
});

describe.each(entries)('$label', ({ slug, label }) => {
  test('the page it opens is headed with the same name', () => {
    const heading = headingOf(slug);
    // A page composed from a shared header component has no literal h1 to
    // read; that is not drift, so it is skipped rather than failed.
    if (heading === null) return;
    expect(heading).toBe(label);
  });
});

test('no page heading is left in Title Case', () => {
  // "All Orders" and "3D Model Requests" sat beside "Billing event history".
  // Mixed casing across one screen is the cheapest tell of unfinished UI.
  const offenders = entries
    .map(({ slug, label }) => ({ slug, label, heading: headingOf(slug) }))
    .filter(({ heading }) => heading)
    .filter(({ heading }) => {
      const words = heading.split(' ').slice(1).filter((word) => word.length > 3);
      // Allow proper nouns that are genuinely capitalised everywhere.
      const allowed = new Set(['Dine3d', 'JazzCash', 'Edge', 'QR']);
      return words.some((word) => /^[A-Z]/.test(word) && !allowed.has(word));
    })
    .map(({ slug, heading }) => `${slug}: "${heading}"`);

  expect(offenders).toEqual([]);
});
