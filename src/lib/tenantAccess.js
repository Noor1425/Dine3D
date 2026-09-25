export function permissionPatternMatches(rule, action) {
  const normalizedRule = String(rule || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!normalizedRule || !normalizedAction) return false;
  if (normalizedRule === '*' || normalizedRule === normalizedAction) return true;
  if (normalizedRule.endsWith('.*')) {
    const prefix = normalizedRule.slice(0, -2);
    return normalizedAction === prefix || normalizedAction.startsWith(`${prefix}.`);
  }
  const ruleSegments = normalizedRule.split('.');
  const actionSegments = normalizedAction.split('.');
  return ruleSegments.length === actionSegments.length
    && ruleSegments.every((segment, index) => segment === '*' || segment === actionSegments[index]);
}

const isSensitiveImpersonationAction = (action) => {
  const normalized = String(action || '').toLowerCase();
  return normalized.endsWith('.delete')
    || ['billing', 'custom_roles', 'security', 'settings', 'staff', 'subscription', 'sessions.revoke']
      .some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}.`));
};

export function hasTenantPermission(policy, action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (!normalized) return false;
  const denied = Array.isArray(policy?.deniedPermissions) ? policy.deniedPermissions : [];
  if (denied.some((rule) => permissionPatternMatches(rule, normalized))) return false;

  if (policy?.sessionType === 'preview') return normalized.endsWith('.read');
  if (policy?.sessionType === 'impersonation' && isSensitiveImpersonationAction(normalized)) return false;

  const permissions = Array.isArray(policy?.permissions) ? policy.permissions : [];
  return permissions.some((rule) => permissionPatternMatches(rule, normalized));
}

export const ADMIN_ROUTE_POLICIES = Object.freeze([
  { prefix: '/admin/dashboard', any: ['dashboard.read'] },
  { prefix: '/admin/pos', any: ['pos.read'] },
  { prefix: '/admin/kds', any: ['kitchen.read'] },
  { prefix: '/admin/orders', any: ['orders.read'] },
  { prefix: '/admin/data-history', any: ['exports.read'] },
  { prefix: '/admin/menu', any: ['menu.read'] },
  { prefix: '/admin/categories', any: ['categories.write', 'categories.delete'] },
  { prefix: '/admin/inventory', any: ['inventory.read'] },
  { prefix: '/admin/delivery', any: ['delivery.read'] },
  { prefix: '/admin/activity', any: ['dashboard.read'] },
  { prefix: '/admin/staff-v2', any: ['staff.read'] },
  { prefix: '/admin/staff', any: ['staff.read'] },
  { prefix: '/admin/branches-v2', any: ['locations.read'] },
  { prefix: '/admin/tables', any: ['tables.read'] },
  { prefix: '/admin/settings', any: ['settings.read', 'theme.read'] },
  { prefix: '/admin/subscription', any: ['subscription.read', 'billing.read'] },
  { prefix: '/admin/billing', any: ['billing.read'] },
  { prefix: '/admin/sync', any: ['sync.read'] },
  { prefix: '/admin/setup', any: ['sync.read'] },
]);

export function canAccessAdminRoute(pathname, canAny) {
  if (pathname === '/admin') return true;
  const policy = ADMIN_ROUTE_POLICIES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return Boolean(policy && canAny(policy.any));
}

export function firstAllowedAdminRoute(canAny) {
  return ADMIN_ROUTE_POLICIES.find((policy) => canAny(policy.any))?.prefix || null;
}

/** The portal a rider works from. Nothing under /admin is open to them. */
export const RIDER_HOME = '/rider';

/**
 * Where a session belongs after signing in, or after being turned away from a
 * page it cannot see.
 *
 * A rider matches no admin route at all — that is the whole point of the role —
 * so sending them to the dashboard and letting the guard sort it out left them
 * on "Verifying your secure session…" with nowhere to go. They have a home; it
 * is just not inside the backoffice.
 */
export function homeRouteForSession(role, canAny) {
  if (String(role || '').toLowerCase() === 'rider') return RIDER_HOME;

  return firstAllowedAdminRoute(canAny);
}
