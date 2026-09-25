const {
  canAccessAdminRoute,
  firstAllowedAdminRoute,
  homeRouteForSession,
  hasTenantPermission,
} = require('../src/lib/tenantAccess');

/**
 * Where each role lands after signing in, and whether they can stay there.
 *
 * Sign-in cannot know what someone may open — the login response carries no
 * permissions — so it sends everyone to the first page in the route list and
 * the admin layout moves them on. That is fine as long as the layout survives
 * the move. It did not: the redirect branch returned without clearing
 * sessionChecking, and the effect keys on isAuthPage rather than pathname, so
 * it never ran again. A cashier signed in, was bounced off the dashboard they
 * cannot read, and sat on "Verifying your secure session…" for good.
 *
 * These lock the two halves of that: the home a role is sent to must be a page
 * that role can actually open, for every role.
 */

// Straight from GET /api/auth/me on this system.
const ROLE_PERMISSIONS = {
  cashier: ['pos.*', 'orders.read', 'orders.status', 'shift.*', 'receipt.*', 'tables.read',
    'menu.read', 'categories.read', 'delivery.read', 'delivery.assign', 'delivery.riders.read',
    'sync.read', 'sync.devices.register', 'sync.operations', 'entitlements.read'],
  owner: ['*'],
  kitchen: ['kitchen.read', 'orders.read', 'orders.status'],
};

const canFor = (permissions) => (required) => required.some(
  (permission) => hasTenantPermission({ permissions, deniedPermissions: [], sessionType: 'normal' }, permission),
);

describe.each(Object.entries(ROLE_PERMISSIONS))('a %s', (role, permissions) => {
  const canAny = canFor(permissions);

  test('is sent somewhere it is allowed to be', () => {
    const home = homeRouteForSession(role, canAny);
    expect(home).not.toBeNull();
    expect(canAccessAdminRoute(home, canAny)).toBe(true);
  });
});

test('a cashier is not sent to a dashboard they cannot read', () => {
  // The specific failure: /admin/dashboard is first in the route list, so any
  // caller that does not consult real permissions lands everyone there.
  const canAny = canFor(ROLE_PERMISSIONS.cashier);

  expect(canAccessAdminRoute('/admin/dashboard', canAny)).toBe(false);
  expect(homeRouteForSession('cashier', canAny)).toBe('/admin/pos');
  expect(canAccessAdminRoute('/admin/pos', canAny)).toBe(true);
});

test('a rider is sent out of the backoffice entirely', () => {
  // A rider matches no admin route, so a home inside /admin could only ever be
  // a page they are immediately bounced off.
  const canAny = canFor([]);

  expect(firstAllowedAdminRoute(canAny)).toBeNull();
  expect(homeRouteForSession('rider', canAny)).toBe('/rider');
});

test('an account with no permissions at all has no admin home', () => {
  // The caller must fall back to the login page rather than redirect in a ring.
  expect(homeRouteForSession('cashier', canFor([]))).toBeNull();
});

/**
 * The layout must clear its checking flag even when it redirects, because the
 * effect that sets it does not re-run on navigation. Asserted against the
 * source: the behaviour lives in a React effect whose failure mode is a screen
 * that never changes, which no unit test of the pure helpers above can catch.
 */
test('the admin layout clears sessionChecking on the redirect path too', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'app', 'admin', 'layout.js'), 'utf8',
  );

  const guard = source.indexOf('const allowedHere = canAccessAdminRoute(pathname, canAny)');
  expect(guard).toBeGreaterThan(-1);

  // Between deciding the route is wrong and finishing setup there must be no
  // `return` — that return is precisely what stranded the session.
  const afterGuard = source.slice(guard, source.indexOf('setSessionChecking(false)', guard));
  expect(afterGuard).not.toMatch(/\breturn\b/);
});
