const fs = require('fs');
const path = require('path');

/**
 * One address per thing.
 *
 * This app had a rule that turned the first path segment into a restaurant
 * subdomain, so /register was redirected to register.localhost:3000 — a host
 * that serves the home page. It was issued as a 308, which is permanent, so
 * browsers cached it and kept doing it long after the server stopped. Every
 * menu also had two addresses, and the backoffice answered on several hosts at
 * once, which is how an invitation email came to point at one of them while
 * every button on the site pointed at another.
 *
 * These read the middleware source rather than run it, because what matters is
 * that the rules are absent or present at all — a routing rule that should not
 * exist cannot be tested by calling it.
 */

const MIDDLEWARE = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware.js'), 'utf8');

test('no rule turns a path segment into a subdomain', () => {
  // The rule that caused it, in any form: building a host out of a slug.
  expect(MIDDLEWARE).not.toMatch(/\$\{slug\}\.localhost/);
  expect(MIDDLEWARE).not.toMatch(/\$\{firstSegment\}\./);
});

test('no redirect is permanent', () => {
  // A 308 is cached by the browser for ever. Every redirect here is about
  // which host serves a path, and that is a thing that changes.
  //
  // Matched as a status argument, not as the digits — the comments in the
  // middleware explain the 308 that caused this, and should keep doing so.
  expect(MIDDLEWARE).not.toMatch(/,\s*308\s*\)/);
  expect(MIDDLEWARE).not.toMatch(/status:\s*308/);
});

test('a cross-host redirect names the host it is going to', () => {
  // NextResponse.redirect() collapses a URL it considers same-origin down to a
  // path, and in development every host is the same origin — so the redirect
  // resolves against the host the browser is already on and loops for ever,
  // reporting a correct 307 at every hop.
  expect(MIDDLEWARE).toMatch(/function redirectToHost/);
  expect(MIDDLEWARE).toMatch(/headers\.set\('Location'/);

  const crossHost = MIDDLEWARE.match(/NextResponse\.redirect\(new URL\(`\$\{adminOrigin\}/g);
  expect(crossHost).toBeNull();
});

test('the root of a tenant subdomain is that restaurant, not the marketing site', () => {
  // `firstSegment` is empty for "/", and the empty string is a reserved root —
  // so this check used to return early for <restaurant>.dine3d.ai and serve the
  // public site instead of the menu. A QR code hid it, because its URL carries
  // a table token.
  expect(MIDDLEWARE).toMatch(/if \(firstSegment && reservedRoots\.has\(firstSegment\)\)/);
});

test('the register page is not reachable through a subdomain rule', () => {
  // Kept as an explicit reserved root: it is the single most linked page on the
  // site and the one this whole class of bug was found through.
  expect(MIDDLEWARE).toMatch(/'register'/);
});

test('no internal link points at a page that does not exist', () => {
  const appDir = path.join(__dirname, '..', 'src', 'app');
  const routes = new Set(['/']);
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Route groups and dynamic segments are not literal link targets.
      if (entry.name.startsWith('(') || entry.name.startsWith('[')) continue;
      const route = `${prefix}/${entry.name}`;
      if (fs.existsSync(path.join(dir, entry.name, 'page.js'))) routes.add(route);
      walk(path.join(dir, entry.name), route);
    }
  };
  walk(appDir);

  const files = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!full.includes('graphify-out')) collect(full); }
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  collect(path.join(__dirname, '..', 'src'));

  const dead = new Set();
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/href=["']([^"'{}]+)["']/g)) {
      const href = match[1].split('?')[0].split('#')[0];
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const clean = href.length > 1 ? href.replace(/\/$/, '') : href;
      if (!routes.has(clean)) dead.add(clean);
    }
  }

  expect([...dead]).toEqual([]);
});

test('there is one register page, not two', () => {
  const registerDir = path.join(__dirname, '..', 'src', 'app', 'register');
  const pages = fs.readdirSync(registerDir).filter((name) => name.startsWith('page'));
  expect(pages).toEqual(['page.js']);
});
