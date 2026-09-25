const {
  canAccessAdminRoute,
  firstAllowedAdminRoute,
  hasTenantPermission,
  permissionPatternMatches,
} = require('../src/lib/tenantAccess');

const cashierPolicy = {
  sessionType: 'normal',
  deniedPermissions: [],
  permissions: [
    'pos.*', 'orders.read', 'orders.status', 'shift.*', 'receipt.*', 'tables.read',
    'menu.read', 'categories.read', 'sync.read', 'sync.devices.register', 'sync.operations', 'entitlements.read',
  ],
};

describe('tenant permission policy', () => {
  test('supports resource and action wildcards', () => {
    expect(permissionPatternMatches('inventory.*', 'inventory.purchase-orders.approve')).toBe(true);
    expect(permissionPatternMatches('*.read', 'menu.read')).toBe(true);
    expect(permissionPatternMatches('menu.read', 'menu.write')).toBe(false);
  });

  test('explicit deny overrides broad grants', () => {
    expect(hasTenantPermission({ permissions: ['*'], deniedPermissions: ['billing.*'] }, 'billing.manage')).toBe(false);
  });

  test('preview sessions expose reads but conceal mutations', () => {
    const preview = { permissions: ['*'], deniedPermissions: [], sessionType: 'preview' };
    expect(hasTenantPermission(preview, 'orders.read')).toBe(true);
    expect(hasTenantPermission(preview, 'orders.status')).toBe(false);
  });

  test('impersonation cannot mutate identity, access, billing, or security', () => {
    const impersonation = { permissions: ['*'], deniedPermissions: [], sessionType: 'impersonation' };
    expect(hasTenantPermission(impersonation, 'orders.status')).toBe(true);
    expect(hasTenantPermission(impersonation, 'staff.write')).toBe(false);
    expect(hasTenantPermission(impersonation, 'custom_roles.write')).toBe(false);
    expect(hasTenantPermission(impersonation, 'billing.manage')).toBe(false);
  });

  test('cashier sees operational pages but not management modules', () => {
    const canAny = (required) => required.some((permission) => hasTenantPermission(cashierPolicy, permission));
    expect(canAccessAdminRoute('/admin/pos', canAny)).toBe(true);
    expect(canAccessAdminRoute('/admin/orders', canAny)).toBe(true);
    expect(canAccessAdminRoute('/admin/menu', canAny)).toBe(true);
    expect(canAccessAdminRoute('/admin/categories', canAny)).toBe(false);
    expect(canAccessAdminRoute('/admin/inventory', canAny)).toBe(false);
    expect(canAccessAdminRoute('/admin/staff', canAny)).toBe(false);
    expect(canAccessAdminRoute('/admin/settings', canAny)).toBe(false);
    expect(canAccessAdminRoute('/admin/subscription', canAny)).toBe(false);
    expect(firstAllowedAdminRoute(canAny)).toBe('/admin/pos');
  });
});

describe('Plan price selection', () => {
  // Mirrors the plan card: a price row must never contradict the plan's own
  // currency. A stale USD row against a PKR plan showed "USD 0" on the pricing
  // screen for two plans.
  const resolvePrice = (plan) => {
    const monthly = plan.prices?.find((price) =>
      price.billingInterval === 'MONTHLY' && price.currency === plan.currency) || null;
    return { amount: monthly?.amount ?? plan.price, currency: monthly?.currency ?? plan.currency };
  };

  test('a price row in the plan currency is used', () => {
    expect(resolvePrice({
      currency: 'PKR', price: '5999',
      prices: [{ currency: 'PKR', billingInterval: 'MONTHLY', amount: '5999' }],
    })).toEqual({ amount: '5999', currency: 'PKR' });
  });

  test('a stale row in another currency is ignored in favour of the plan price', () => {
    expect(resolvePrice({
      currency: 'PKR', price: '5999',
      prices: [{ currency: 'USD', billingInterval: 'MONTHLY', amount: '0' }],
    })).toEqual({ amount: '5999', currency: 'PKR' });
  });

  test('a plan with no price rows falls back to its own price', () => {
    expect(resolvePrice({ currency: 'PKR', price: '2999', prices: [] }))
      .toEqual({ amount: '2999', currency: 'PKR' });
  });
});
