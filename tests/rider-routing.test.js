/**
 * A rider never arrives at the backoffice.
 *
 * Their whole permission set is their own deliveries, so every page under
 * /admin is closed to them. That was true of the API from the start, but the
 * *pages* were a different story: a rider signing in landed on the dashboard,
 * got the admin HTML, fired a dozen requests that all came back 403, and sat on
 * "Verifying your secure session…" with nowhere to go.
 *
 * Two fixes, tested here:
 *
 *   1. Sign-in routes by role, so a rider is sent to their own portal.
 *   2. The edge refuses /admin to a rider outright, so the backoffice HTML is
 *      never built for them at all — not rendered and then corrected.
 *
 * The second reads the role from the identity cookie without verifying it. That
 * is routing, not authorization: a forged cookie would receive the admin page
 * and then be refused by every API call, exactly as before. Nothing is granted
 * by trusting the claim, so nothing is lost by reading it.
 */

const fs = require('fs');
const path = require('path');

const {
  ADMIN_ROUTE_POLICIES,
  RIDER_HOME,
  canAccessAdminRoute,
  firstAllowedAdminRoute,
  homeRouteForSession,
  permissionPatternMatches,
} = require('../src/lib/tenantAccess');

/** The permission checker the layout builds, for a given permission set. */
const allow = (permissions) => (needed) => needed.some(
  (action) => permissions.some((rule) => permissionPatternMatches(rule, action)),
);

const RIDER_PERMISSIONS = ['delivery.self', 'entitlements.read'];

describe('A rider is sent to their own portal', () => {
  test('after signing in', () => {
    expect(homeRouteForSession('rider', allow(RIDER_PERMISSIONS))).toBe('/rider');
  });

  test('however the role is cased, because it arrives from a token', () => {
    expect(homeRouteForSession('RIDER', allow(RIDER_PERMISSIONS))).toBe('/rider');
  });

  test('and everyone else still goes to the backoffice', () => {
    expect(homeRouteForSession('owner', allow(['*']))).toBe('/admin/dashboard');
    expect(homeRouteForSession('cashier', allow(['pos.read', 'orders.read']))).toBe('/admin/pos');
  });

  test('the rider home is not an admin route, or the guard would fight it', () => {
    expect(RIDER_HOME.startsWith('/admin')).toBe(false);
    expect(ADMIN_ROUTE_POLICIES.some(({ prefix }) => prefix === RIDER_HOME)).toBe(false);
  });
});

describe('There is no admin page a rider can reach', () => {
  const riderCan = allow(RIDER_PERMISSIONS);

  test('not one of the registered routes opens for them', () => {
    const reachable = ADMIN_ROUTE_POLICIES
      .filter((policy) => riderCan(policy.any))
      .map((policy) => policy.prefix);
    expect(reachable).toEqual([]);
  });

  test.each(['/admin/dashboard', '/admin/pos', '/admin/delivery', '/admin/settings', '/admin/billing'])(
    '%s is refused',
    (route) => {
      expect(canAccessAdminRoute(route, riderCan)).toBe(false);
    },
  );

  test('so they have no first allowed admin route at all', () => {
    // This is exactly why sending them to the dashboard dead-ended: there was
    // no destination to fall back to.
    expect(firstAllowedAdminRoute(riderCan)).toBeNull();
  });

  test('but delivery does open for the staff who dispatch them', () => {
    expect(canAccessAdminRoute('/admin/delivery', allow(['delivery.read']))).toBe(true);
  });
});

describe('The edge turns a rider away before building any admin page', () => {
  const middleware = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware.js'), 'utf8');

  test('the identity cookie is read for a role', () => {
    expect(middleware).toMatch(/roleFromIdentityCookie/);
    expect(middleware).toMatch(/dine3d_identity/);
  });

  test('a rider is redirected to their portal from admin paths', () => {
    expect(middleware).toMatch(/roleFromIdentityCookie\(req\) === 'rider'/);
    expect(middleware).toMatch(/NextResponse\.redirect\(new URL\('\/rider'/);
  });

  test('the check runs before the session gate, not after', () => {
    // Order matters: after the gate, a rider with an expired cookie would be
    // sent to the login page and back into the same loop.
    expect(middleware.indexOf("=== 'rider'")).toBeLessThan(middleware.indexOf('hasSessionCookie'));
  });

  test('the rider portal itself is still gated like any signed-in page', () => {
    expect(middleware).toMatch(/isRiderPath/);
    expect(middleware).toMatch(/isProtectedAdminPath\s*=.*isRiderPath/s);
  });

  test('the cookie is decoded defensively, never assumed well-formed', () => {
    // A malformed cookie must not throw inside middleware, which would take
    // down every route on the site.
    expect(middleware).toMatch(/catch\s*\{[\s\S]*?return null;/);
  });
});
