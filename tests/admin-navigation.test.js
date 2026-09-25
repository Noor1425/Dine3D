/**
 * The sidebar and the route guard have to agree.
 *
 * They are two separate lists. The sidebar decides what a user is *offered*;
 * `ADMIN_ROUTE_POLICIES` decides what they are *allowed*, and it denies by
 * default — a route missing from it is unreachable no matter who you are.
 *
 * That default is right, and it is also how a new page can ship with a working
 * link in the sidebar that bounces every visitor back to the dashboard. It
 * happened with /admin/delivery. These tests keep the two lists honest about
 * each other.
 */

const fs = require('fs');
const path = require('path');

const { ADMIN_ROUTE_POLICIES, canAccessAdminRoute, permissionPatternMatches } = require('../src/lib/tenantAccess');

const APP_ADMIN = path.join(__dirname, '..', 'src', 'app', 'admin');

/** Every /admin/* route that actually has a page. */
const adminRoutes = fs.readdirSync(APP_ADMIN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => fs.existsSync(path.join(APP_ADMIN, entry.name, 'page.js')))
  .map((entry) => `/admin/${entry.name}`);

/** Every link the admin sidebar renders. */
const navHrefs = (() => {
  const source = fs.readFileSync(path.join(APP_ADMIN, 'layout.js'), 'utf8');
  return [...source.matchAll(/href:\s*'(\/admin\/[^']+)'/g)].map((match) => match[1]);
})();

describe('The admin sidebar and the route guard agree', () => {
  test('the lists are actually being read', () => {
    expect(adminRoutes.length).toBeGreaterThan(10);
    expect(navHrefs.length).toBeGreaterThan(10);
    expect(ADMIN_ROUTE_POLICIES.length).toBeGreaterThan(10);
  });

  test('every sidebar link leads somewhere the guard permits', () => {
    // A link the guard denies is worse than no link: it looks like a feature
    // and behaves like a bug, bouncing the user back to the dashboard.
    const unreachable = navHrefs.filter((href) => !ADMIN_ROUTE_POLICIES.some(
      ({ prefix }) => href === prefix || href.startsWith(`${prefix}/`),
    ));
    expect(unreachable).toEqual([]);
  });

  test('every admin page that exists is reachable', () => {
    const orphaned = adminRoutes
      // Sign-in and registration are deliberately outside the guard.
      .filter((route) => !['/admin/login', '/admin/register'].includes(route))
      .filter((route) => !ADMIN_ROUTE_POLICIES.some(
        ({ prefix }) => route === prefix || route.startsWith(`${prefix}/`),
      ));
    expect(orphaned).toEqual([]);
  });

  test('every sidebar link points at a page that exists', () => {
    const broken = navHrefs.filter((href) => !fs.existsSync(
      path.join(APP_ADMIN, href.replace('/admin/', ''), 'page.js'),
    ));
    expect(broken).toEqual([]);
  });
});

describe('The guard denies by default', () => {
  const allow = (permissions) => (needed) => needed.some(
    (action) => permissions.some((rule) => permissionPatternMatches(rule, action)),
  );

  test('an unknown route is refused even to an owner', () => {
    expect(canAccessAdminRoute('/admin/not-a-page', allow(['*']))).toBe(false);
  });

  test('delivery opens for someone who can read deliveries', () => {
    expect(canAccessAdminRoute('/admin/delivery', allow(['delivery.read']))).toBe(true);
  });

  test('and stays shut for someone who cannot', () => {
    expect(canAccessAdminRoute('/admin/delivery', allow(['orders.read', 'menu.read']))).toBe(false);
  });

  test('a rider has no admin page at all', () => {
    // Their entire permission set is delivery.self — the portal lives at
    // /rider precisely because none of /admin is open to them.
    const riderCan = allow(['delivery.self', 'entitlements.read']);
    const reachable = ADMIN_ROUTE_POLICIES.filter((policy) => riderCan(policy.any));
    expect(reachable).toEqual([]);
  });
});
