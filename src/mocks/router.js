import { getDb } from './db';
import { uid, iso, daysAgo, DEMO_LOGIN } from './seed';

/* ------------------------------------------------------------------ *
 * Small route-matching helpers
 * ------------------------------------------------------------------ */

function compile(pattern) {
  // "/menu/:id/toggle" -> RegExp with named groups
  const re = pattern
    .split('/')
    .map((seg) => (seg.startsWith(':') ? `(?<${seg.slice(1)}>[^/]+)` : seg))
    .join('/');
  return new RegExp(`^${re}$`);
}

const routes = [];
function on(method, pattern, handler) {
  routes.push({ method, regex: compile(pattern), handler });
}

/* ------------------------------------------------------------------ *
 * Auth / session helpers
 * ------------------------------------------------------------------ */

function getSession(db, cookies) {
  // middleware.js gates every /admin/* page on the presence of
  // dine3d_identity or dine3d_refresh — not our own session id cookie name.
  // Using the same names here means a client-side navigation to a protected
  // page never gets bounced back to /admin/login?reason=session_expired.
  const sid = cookies.dine3d_identity || cookies.dine3d_refresh;
  if (!sid) return null;
  return db.sessions.get(sid) || null;
}

function requireAuth(db, cookies) {
  const session = getSession(db, cookies);
  if (!session) {
    const err = new Error('Not authenticated');
    err.status = 401;
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  return session;
}

function userPayload(db, session) {
  const isOwnerLike = session.staffId === db.ids.OWNER_ID || !session.staffId;
  const staff = db.staff.find((s) => s.id === session.staffId) || db.staff.find((s) => s.id === db.ids.OWNER_ID);
  return {
    id: staff.id,
    role: staff.role,
    sessionType: 'normal',
    restaurantId: db.restaurant.id,
    isImpersonating: false,
    isPreviewing: false,
    authModel: 'user',
    actorUserId: staff.id,
    isPosOperator: !!session.operator,
    posTerminalLocked: false,
    operator: session.operator || null,
    permissions: ['*'],
    deniedPermissions: [],
  };
}

function mePayload(db, session) {
  return {
    user: userPayload(db, session),
    restaurant: { ...db.restaurant },
    restaurants: [{
      id: db.restaurant.id,
      name: db.restaurant.name,
      slug: db.restaurant.slug,
      logo: db.restaurant.logo,
      currency: db.restaurant.currency,
      role: 'owner',
      accessLevel: 'corporate',
    }],
    member: { id: uid('member'), role: 'owner', accessLevel: 'corporate', accessibleBranchIds: [] },
    branches: db.locations.map((l) => ({ id: l.id, code: l.code, name: l.name, isPrimary: l.isPrimary })),
  };
}

/* ------------------------------------------------------------------ *
 * Subscription / entitlements — everything allowed, generous limits
 * ------------------------------------------------------------------ */

const ALL_FEATURES = [
  'menu_management', 'table_qr_generation', 'qr_ordering', 'pos_orders',
  'order_status_management', 'basic_reports', 'advanced_reports', 'audit_logs',
  'inventory_management', 'discounts', 'stock_transfers', 'custom_roles',
  'multi_location', 'delivery_management', 'theme_customization', 'staff_management',
  'data_export',
];

function buildFeatures() {
  return Object.fromEntries(ALL_FEATURES.map((key) => [key, { allowed: true, source: 'plan' }]));
}

function buildLimitsAndUsage(db) {
  const limits = {
    'locations.max': { value: 10, source: 'plan' },
    'staff_users.max': { value: 50, source: 'plan' },
    'tables.max': { value: 100, source: 'plan' },
    'active_qr_codes.max': { value: 100, source: 'plan' },
    'monthly_orders.max': { value: 10000, source: 'plan' },
    'inventory_items.max': { value: 500, source: 'plan' },
    'menu_items.max': { value: 500, source: 'plan' },
  };
  const usageFor = (current, max) => ({ current, limit: max, remaining: Math.max(0, max - current), overLimit: false, source: 'plan' });
  const usage = {
    'locations.max': usageFor(db.locations.length, limits['locations.max'].value),
    'staff_users.max': usageFor(db.staff.length, limits['staff_users.max'].value),
    'tables.max': usageFor(db.tables.length, limits['tables.max'].value),
    'active_qr_codes.max': usageFor(db.tables.length, limits['active_qr_codes.max'].value),
    'monthly_orders.max': usageFor(db.orders.length, limits['monthly_orders.max'].value),
    'inventory_items.max': usageFor(db.ingredients.length, limits['inventory_items.max'].value),
    'menu_items.max': usageFor(db.menuItems.length, limits['menu_items.max'].value),
  };
  return { limits, usage };
}

function buildSubscriptionPayload(db, { withHistory } = {}) {
  const { limits, usage } = buildLimitsAndUsage(db);
  const payload = {
    restaurant: { id: db.restaurant.id, name: db.restaurant.name, isActive: db.restaurant.isActive, menuPublished: db.restaurant.menuPublished },
    operational: true,
    subscriptionAccess: { operational: true, status: 'ACTIVE' },
    subscription: {
      id: uid('sub'),
      status: 'ACTIVE',
      startDate: iso(daysAgo(90)),
      trialEnd: null,
      currentPeriodStart: iso(daysAgo(30)),
      currentPeriodEnd: null,
      graceEnd: null,
      cancellationDate: null,
      expirationDate: null,
      complimentaryUntil: null,
      cancelAtPeriodEnd: false,
      scheduledChangeAt: null,
      plan: db.plan,
      scheduledPlan: null,
    },
    features: buildFeatures(),
    limits,
    generatedAt: iso(new Date()),
    usage,
  };
  if (withHistory) {
    payload.history = [{
      id: uid('hist'), subscriptionId: payload.subscription.id, restaurantId: db.restaurant.id,
      fromStatus: null, toStatus: 'ACTIVE', reason: 'Demo restaurant provisioned', actorId: 'seed',
      actorRole: 'system', source: 'seed', metadata: null, effectiveAt: iso(daysAgo(90)), createdAt: iso(daysAgo(90)),
    }];
    payload.billingEvents = [];
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * Analytics / reports synthesis
 * ------------------------------------------------------------------ */

function seededRandom(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000);
}

function revenueSeries(db, days = 30) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOrders = db.orders.filter((o) => o.createdAt.slice(0, 10) === dateStr && o.status !== 'CANCELLED');
    const actual = dayOrders.reduce((sum, o) => sum + o.grandTotal, 0);
    const r = seededRandom(dateStr);
    const weekday = d.getDay();
    const weekendBump = (weekday === 5 || weekday === 6) ? 1.3 : 1;
    const synthetic = Math.round((3500 + r * 5000) * weekendBump);
    out.push({ date: dateStr, revenue: actual > 0 ? actual : synthetic });
  }
  return out;
}

function popularItemsSeries(db, limit = 6) {
  const counts = new Map();
  for (const order of db.orders) {
    if (order.status === 'CANCELLED') continue;
    for (const line of order.items) {
      counts.set(line.name, (counts.get(line.name) || 0) + line.quantity);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, quantity]) => ({ name, quantity }));
  if (ranked.length < limit) {
    const used = new Set(ranked.map((r) => r.name));
    for (const item of db.menuItems) {
      if (ranked.length >= limit) break;
      if (used.has(item.name)) continue;
      ranked.push({ name: item.name, quantity: Math.max(1, Math.round(seededRandom(item.id) * 20)) });
    }
  }
  return ranked.slice(0, limit).sort((a, b) => b.quantity - a.quantity);
}

function activitySeries(db) {
  const actor = db.staff.find((s) => s.id === db.ids.OWNER_ID);
  const events = [
    ['CREATE', 'MenuItem', { name: 'Chicken Biryani' }],
    ['UPDATE', 'MenuItem', { name: 'Zinger Burger', isAvailable: true }],
    ['CREATE', 'Order', { orderNumber: 'ORD-1009' }],
    ['UPDATE', 'Order', { status: 'COMPLETED' }],
    ['CREATE', 'Category', { name: 'Desserts' }],
    ['UPDATE', 'Theme', { primaryColor: '#FF6B35' }],
    ['CREATE', 'Table', { label: 'VIP-1' }],
    ['UPDATE', 'Ingredient', { name: 'Chicken Breast', currentStock: 42 }],
    ['CREATE', 'Staff', { name: 'Hina Malik' }],
    ['UPDATE', 'Restaurant', { menuPublished: true }],
    ['CREATE', 'Promo', { code: 'WELCOME10' }],
    ['DELETE', 'Table', { label: 'T5' }],
  ];
  return events.map((([action, entityType, newValue], idx) => ({
    id: uid('audit'),
    createdAt: iso(daysAgo(Math.floor(idx / 3), 9 + idx)),
    userId: actor.id,
    userRole: actor.role,
    action,
    entityType,
    newValue,
    previousValue: null,
    ipAddress: '39.45.12.88',
  })));
}

/* ------------------------------------------------------------------ *
 * Generic, safe fallback for the long tail of endpoints this demo
 * doesn't hand-model (supplier CRM, purchase orders, waste analytics,
 * cost trends, ...). Keeps every screen from crashing on an undefined
 * read, even if the data itself is empty.
 * ------------------------------------------------------------------ */

function fallbackBody(method) {
  if (method === 'GET') {
    return {
      items: [], data: [], results: [], list: [], logs: [], alerts: [],
      suppliers: [], purchaseOrders: [], expenses: [], notes: [], grns: [],
      reorderSuggestions: [], trends: [], orders: [], riders: [], assignments: [],
      summary: {}, total: 0,
    };
  }
  return { success: true };
}

/* ------------------------------------------------------------------ *
 * Route table
 * ------------------------------------------------------------------ */

// ---- auth ----
on('GET', '/auth/csrf', (ctx) => {
  const token = uid('csrf');
  return { status: 200, body: { csrfToken: token }, headers: { 'x-csrf-token': token }, cookies: [{ name: 'dine3d_csrf', value: token, options: { httpOnly: false, sameSite: 'lax', path: '/' } }] };
});

on('POST', '/auth/login', (ctx) => {
  const { restaurantCode, email, password } = ctx.body || {};
  const normalizedCode = String(restaurantCode || '').trim().toUpperCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const staff = ctx.db.staff.find((s) => s.email.toLowerCase() === normalizedEmail);
  const validCode = normalizedCode === ctx.db.restaurant.restaurantCode;
  const validPassword = normalizedEmail === DEMO_LOGIN.email.toLowerCase() && password === DEMO_LOGIN.password;

  if (!staff || !validCode || !validPassword) {
    return { status: 401, body: { state: 'INVALID_CREDENTIALS', code: 'INVALID_CREDENTIALS', error: 'The restaurant code, email, or password is incorrect.' } };
  }

  const sid = uid('sess');
  ctx.db.sessions.set(sid, { staffId: staff.id, operator: null, createdAt: Date.now() });

  return {
    status: 200,
    body: {
      state: 'AUTHENTICATED',
      success: true,
      user: { id: staff.id, email: staff.email, name: staff.name, role: staff.role, authModel: 'user' },
      restaurant: { id: ctx.db.restaurant.id, restaurantCode: ctx.db.restaurant.restaurantCode, name: ctx.db.restaurant.name, slug: ctx.db.restaurant.slug, logo: ctx.db.restaurant.logo, currency: ctx.db.restaurant.currency, isActive: ctx.db.restaurant.isActive },
      membership: { id: uid('member'), role: 'owner', accessLevel: 'corporate', accessibleBranchIds: [] },
      session: { expiresAt: iso(new Date(Date.now() + 30 * 24 * 3600 * 1000)), accessExpiresIn: 900 },
    },
    cookies: [
      { name: 'dine3d_identity', value: sid, options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 } },
      { name: 'dine3d_refresh', value: sid, options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 } },
    ],
  };
});

on('GET', '/auth/me', (ctx) => {
  const session = requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: mePayload(ctx.db, session) };
});

on('POST', '/auth/refresh', (ctx) => {
  const session = getSession(ctx.db, ctx.cookies);
  if (!session) return { status: 401, body: { error: 'Session expired', code: 'SESSION_EXPIRED' } };
  return { status: 200, body: { success: true } };
});

on('POST', '/auth/logout', (ctx) => {
  const sid = ctx.cookies.dine3d_identity || ctx.cookies.dine3d_refresh;
  if (sid) ctx.db.sessions.delete(sid);
  return {
    status: 200,
    body: { success: true },
    cookies: [
      { name: 'dine3d_identity', value: '', options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 } },
      { name: 'dine3d_refresh', value: '', options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 } },
    ],
  };
});
on('POST', '/auth/logout-all', (ctx) => routes.find((r) => r.method === 'POST' && r.regex.test('/auth/logout')).handler(ctx));
on('GET', '/auth/sessions', (ctx) => {
  const session = requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { sessions: [{ familyId: 'demo-session', createdAt: iso(daysAgo(0)), current: true, userAgent: 'This device' }] } };
});

// ---- POS operator ----
on('POST', '/pos/quick-login', (ctx) => {
  const session = requireAuth(ctx.db, ctx.cookies);
  const pin = String(ctx.body?.pin || '');
  const staff = ctx.db.staff.find((s) => s.pin === pin);
  if (!staff) return { status: 401, body: { error: 'Invalid PIN', code: 'INVALID_PIN' } };
  session.operator = { id: staff.id, name: staff.name, role: staff.role };
  return { status: 200, body: { operator: session.operator } };
});
on('GET', '/pos/operator', (ctx) => {
  const session = requireAuth(ctx.db, ctx.cookies);
  const shift = ctx.db.posShifts?.find((s) => s.staffId === session.operator?.id && s.status === 'OPEN');
  return { status: 200, body: { operator: session.operator || null, activeShift: shift || null, terminalLocked: false } };
});
on('POST', '/pos/quick-logout', (ctx) => {
  const session = requireAuth(ctx.db, ctx.cookies);
  session.operator = null;
  return { status: 200, body: { success: true } };
});

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

on('GET', '/dashboard/stats', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const db = ctx.db;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = db.orders.filter((o) => o.createdAt.slice(0, 10) === todayStr);
  const pendingOrders = db.orders.filter((o) => ['PENDING', 'PREPARING'].includes(o.status));
  const todayRevenue = todayOrders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.grandTotal, 0);
  const { limits, usage } = buildLimitsAndUsage(db);
  return {
    status: 200,
    body: {
      stats: {
        totalOrders: db.orders.length,
        todayOrders: todayOrders.length,
        pendingOrders: pendingOrders.length,
        totalMenuItems: db.menuItems.length,
        totalTables: db.tables.length,
        totalCategories: db.categories.length,
        totalStaff: db.staff.length,
        todayRevenue,
        plan: db.plan,
        subscriptionStatus: 'ACTIVE',
        limits: {
          ...limits,
          maxStaff: limits['staff_users.max'].value,
          maxMenuItems: limits['menu_items.max'].value,
          maxTables: limits['tables.max'].value,
          maxCategories: 50,
        },
        usage,
      },
    },
  };
});

on('GET', '/dashboard/recent-orders', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const orders = [...ctx.db.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  return { status: 200, body: { orders } };
});

on('GET', '/dashboard/analytics', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { revenueData: revenueSeries(ctx.db), popularItems: popularItemsSeries(ctx.db) } };
});

on('GET', '/dashboard/activity', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const audits = activitySeries(ctx.db);
  return { status: 200, body: { audits, total: audits.length } };
});

on('GET', '/dashboard/reports/sales', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const db = ctx.db;
  const active = db.orders.filter((o) => o.status !== 'CANCELLED');
  const grossRevenue = active.reduce((s, o) => s + o.grandTotal, 0);
  const totalDiscount = active.reduce((s, o) => s + (o.discountAmount || 0), 0);
  const daily = revenueSeries(db).map((d) => ({ ...d, orders: db.orders.filter((o) => o.createdAt.slice(0, 10) === d.date).length }));
  const byType = new Map();
  for (const o of active) byType.set(o.orderType, (byType.get(o.orderType) || 0) + o.grandTotal);
  return {
    status: 200,
    body: {
      range: { from: iso(daysAgo(30)), to: iso(new Date()) },
      summary: { orderCount: active.length, grossRevenue, totalDiscount },
      daily,
      byOrderType: [...byType.entries()].map(([orderType, revenue]) => ({ orderType, revenue })),
    },
  };
});

on('GET', '/dashboard/reports/inventory', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const low = ctx.db.ingredients.filter((i) => i.isLowStock);
  return { status: 200, body: { summary: { lowStockCount: low.length, totalWasteCost: 1850 }, items: low } };
});

on('GET', '/dashboard/reports/staff-performance', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const performance = ctx.db.staff.map((s, idx) => ({
    staffId: s.id,
    name: s.name,
    ordersHandled: Math.max(3, Math.round(seededRandom(s.id) * 40) + (idx === 0 ? 20 : 0)),
    revenue: Math.round((seededRandom(s.id + 'r')) * 50000) + 8000,
  })).sort((a, b) => b.ordersHandled - a.ordersHandled);
  return { status: 200, body: { performance } };
});

on('GET', '/dashboard/reports/item-performance', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const topSelling = popularItemsSeries(ctx.db, 8);
  return { status: 200, body: { topSelling, slowMoving: ctx.db.menuItems.slice(-3).map((m) => ({ name: m.name, quantity: 0 })) } };
});

on('GET', '/dashboard/settings/billing', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { billing: { autoPay: false, currency: 'PKR' } } };
});
on('PATCH', '/dashboard/settings/billing', (ctx) => ({ status: 200, body: { success: true } }));
on('GET', '/dashboard/settings/fbr', (ctx) => ({ status: 200, body: { fbr: { enabled: false, mode: 'SANDBOX', token: null } } }));
on('PATCH', '/dashboard/settings/fbr', (ctx) => ({ status: 200, body: { success: true } }));
on('POST', '/dashboard/settings/fbr/test', (ctx) => ({ status: 200, body: { success: true, message: 'Connected (demo mode).' } }));

/* ------------------------------------------------------------------ *
 * Menu / categories / tables / theme
 * ------------------------------------------------------------------ */

on('GET', '/menu', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { items: ctx.db.menuItems } };
});
on('POST', '/menu', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const category = ctx.db.categories.find((c) => c.id === ctx.body.categoryId) || ctx.db.categories[0];
  const item = {
    id: uid('menu'),
    restaurantId: ctx.db.restaurant.id,
    categoryId: category.id,
    name: ctx.body.name || 'New Item',
    description: ctx.body.description || '',
    basePrice: String(ctx.body.basePrice || 0),
    imageUrl: null, modelUrl: null, modelPoster: null,
    isAvailable: true, isFeatured: false, allergens: [], calories: null, sortOrder: 0,
    createdAt: iso(new Date()), updatedAt: iso(new Date()),
    category: { id: category.id, name: category.name, icon: category.icon },
    variants: [], modifierGroups: [],
  };
  ctx.db.menuItems.unshift(item);
  return { status: 201, body: { item } };
});
on('PUT', '/menu/:id', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const item = ctx.db.menuItems.find((m) => m.id === ctx.params.id);
  if (!item) return { status: 404, body: { error: 'Not found' } };
  Object.assign(item, ctx.body, { updatedAt: iso(new Date()) });
  return { status: 200, body: { item } };
});
on('DELETE', '/menu/:id', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  ctx.db.menuItems = ctx.db.menuItems.filter((m) => m.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});
on('PATCH', '/menu/:id/toggle', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const item = ctx.db.menuItems.find((m) => m.id === ctx.params.id);
  if (!item) return { status: 404, body: { error: 'Not found' } };
  item.isAvailable = !item.isAvailable;
  return { status: 200, body: { item } };
});
on('PATCH', '/menu/publication', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  ctx.db.restaurant.menuPublished = !!ctx.body?.published;
  return { status: 200, body: { success: true, menuPublished: ctx.db.restaurant.menuPublished } };
});
on('GET', '/stock-images', () => ({ status: 200, body: { images: [] } }));
on('GET', '/menu-templates', () => ({ status: 200, body: { templates: [] } }));
on('POST', '/menu-templates/apply', () => ({ status: 200, body: { success: true } }));

on('GET', '/categories', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { categories: ctx.db.categories } };
});
on('POST', '/categories', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const category = { id: uid('cat'), restaurantId: ctx.db.restaurant.id, name: ctx.body.name || 'New Category', description: ctx.body.description || null, icon: ctx.body.icon || '🍽️', sortOrder: ctx.db.categories.length + 1, isActive: true, createdAt: iso(new Date()), _count: { menuItems: 0 } };
  ctx.db.categories.push(category);
  return { status: 201, body: { category } };
});
on('PUT', '/categories/:id', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const category = ctx.db.categories.find((c) => c.id === ctx.params.id);
  if (!category) return { status: 404, body: { error: 'Not found' } };
  Object.assign(category, ctx.body);
  return { status: 200, body: { category } };
});
on('DELETE', '/categories/:id', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  ctx.db.categories = ctx.db.categories.filter((c) => c.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});

on('GET', '/tables', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { tables: ctx.db.tables } };
});
on('POST', '/tables', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const label = ctx.body.label || ctx.body.tableNumber || `T${ctx.db.tables.length + 1}`;
  const table = { id: uid('table'), restaurantId: ctx.db.restaurant.id, branchId: ctx.db.ids.MAIN_BRANCH_ID, tableNumber: label, label, capacity: ctx.body.capacity || 4, qrToken: uid('qr'), qrCodeUrl: null, isActive: true, isQrActive: true, qrRevokedAt: null, createdAt: iso(new Date()) };
  ctx.db.tables.push(table);
  return { status: 201, body: { table } };
});
on('DELETE', '/tables/:id', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  ctx.db.tables = ctx.db.tables.filter((t) => t.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});
on('POST', '/tables/:id/regenerate-qr', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const table = ctx.db.tables.find((t) => t.id === ctx.params.id);
  if (!table) return { status: 404, body: { error: 'Not found' } };
  table.qrToken = uid('qr');
  return { status: 200, body: { table } };
});

on('GET', '/theme', (ctx) => ({ status: 200, body: { theme: ctx.db.theme } }));
on('PUT', '/theme', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  Object.assign(ctx.db.theme, ctx.body, { updatedAt: iso(new Date()) });
  return { status: 200, body: { theme: ctx.db.theme } };
});
on('POST', '/theme/reset', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  Object.assign(ctx.db.theme, { primaryColor: '#FF6B35', secondaryColor: '#1A1A2E', accentColor: '#F7C948', backgroundColor: '#FFFFFF', textColor: '#1A1A2E' });
  return { status: 200, body: { theme: ctx.db.theme } };
});

/* ------------------------------------------------------------------ *
 * Subscription / billing
 * ------------------------------------------------------------------ */

on('GET', '/subscription/current', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: buildSubscriptionPayload(ctx.db, { withHistory: true }) };
});
on('GET', '/subscription/entitlements', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: buildSubscriptionPayload(ctx.db) };
});
on('GET', '/billing/plans', (ctx) => ({
  status: 200,
  body: {
    plans: [
      { key: 'free_trial', name: 'Free Trial', price: '0', currency: 'PKR', billingInterval: 'MONTHLY' },
      { key: 'business', name: 'Business', price: '4999', currency: 'PKR', billingInterval: 'MONTHLY' },
      { key: 'enterprise', name: 'Enterprise', price: '12999', currency: 'PKR', billingInterval: 'MONTHLY' },
    ],
  },
}));
on('GET', '/billing/status', (ctx) => ({ status: 200, body: { status: 'ACTIVE', plan: ctx.db.plan } }));
on('GET', '/billing/summary', (ctx) => {
  const daily = revenueSeries(ctx.db, 14).map((d) => ({ date: d.date, quantity: Math.max(1, Math.round(d.revenue / 500)) }));
  const quantity = daily.reduce((s, d) => s + d.quantity, 0);
  return {
    status: 200,
    body: {
      usage: {
        periodStart: iso(daysAgo(13)), periodEnd: iso(new Date()), currency: 'PKR', metered: true,
        plan: ctx.db.plan, unit: 'ORDER', rate: 5, includedUnits: 500, quantity,
        billableUnits: Math.max(0, quantity - 500), eventCount: quantity, baseFee: Number(ctx.db.plan.price),
        meteredAmount: 0, minimumCharge: Number(ctx.db.plan.price), maximumCharge: 14999, cappedAmount: 0,
        projectedTotal: Number(ctx.db.plan.price), daily,
      },
      balance: { currency: 'PKR', amountDue: 0, openInvoices: 0 },
      instructions: {
        currency: 'PKR',
        methods: [{ method: 'JAZZCASH', label: 'JazzCash', accountNumber: '03275110501', accountTitle: 'Dine3D', referenceLabel: 'Transaction ID (TID)', referenceHint: 'The 12-digit TID from your JazzCash confirmation SMS.', steps: ['Open JazzCash and choose Money Transfer → Mobile Account.', 'Send the invoice amount to 03275110501 (Dine3D).', 'Copy the Transaction ID (TID) from the confirmation SMS.', 'Enter that TID below and submit — your invoice is marked paid once we verify it.'] }],
        support: { whatsapp: '03144704840', whatsappUrl: 'https://wa.me/923144704840', note: 'Send your payment screenshot on WhatsApp if you need the invoice cleared urgently.' },
        terms: { dueDays: 3, graceDays: 0 },
        invoice: null,
      },
      standing: { overdue: false },
      invoices: ctx.db.invoices,
      payments: [],
    },
  };
});
on('GET', '/billing/usage', (ctx) => ({ status: 200, body: { plan: ctx.db.plan, quantity: ctx.db.orders.length, includedUnits: 10000 } }));
on('GET', '/billing/invoices', (ctx) => ({ status: 200, body: { invoices: ctx.db.invoices } }));
on('GET', '/billing/invoices/:id', (ctx) => {
  const invoice = ctx.db.invoices.find((i) => i.id === ctx.params.id);
  if (!invoice) return { status: 404, body: { error: 'Not found' } };
  return { status: 200, body: { invoice } };
});
on('GET', '/billing/payments', () => ({ status: 200, body: { payments: [] } }));
on('POST', '/billing/payments', () => ({ status: 200, body: { success: true } }));
function planLadder(db) {
  const definitions = [
    { key: 'free_trial', name: 'Free Trial', meteredRate: 0, minimumCharge: 0, maximumCharge: 0, ceilingOrders: 100, features: ['Menu management', 'QR ordering', 'Basic reports'] },
    { key: 'business', name: 'Business', meteredRate: 5, minimumCharge: 4999, maximumCharge: 14999, ceilingOrders: 10000, features: ['Everything in Free Trial', 'Inventory management', 'Multi-location', 'Custom roles', 'Advanced reports', 'Audit logs'] },
    { key: 'enterprise', name: 'Enterprise', meteredRate: 4, minimumCharge: 12999, maximumCharge: 39999, ceilingOrders: 100000, features: ['Everything in Business', 'Dedicated support', 'Priority onboarding', 'Custom integrations'] },
  ];
  const plans = definitions.map((d) => ({ ...d, currency: db.restaurant.currency, meteredUnit: 'ORDER', isCurrent: d.key === db.plan.key }));
  const current = plans.find((p) => p.isCurrent) || plans[0];
  return { current, scheduled: null, plans };
}
on('GET', '/billing/plan', (ctx) => ({ status: 200, body: planLadder(ctx.db) }));
on('POST', '/billing/plan', (ctx) => {
  if (ctx.body?.planKey) ctx.db.plan = { ...ctx.db.plan, key: ctx.body.planKey };
  return { status: 200, body: { success: true, plan: ctx.db.plan } };
});
on('GET', '/billing/standing', () => ({ status: 200, body: { standing: { overdue: false } } }));

/* ------------------------------------------------------------------ *
 * Locations / stock transfers / custom roles
 * ------------------------------------------------------------------ */

on('GET', '/v2/branches', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const branches = ctx.db.locations.map((l) => ({ ...l, email: l.email || null }));
  return {
    status: 200,
    body: {
      branches,
      canManageAll: true,
      usage: { current: branches.filter((b) => b.isActive).length, pending: 0, limit: 10 },
    },
  };
});
on('GET', '/v2/branches/requests/mine', () => ({ status: 200, body: { requests: [] } }));
on('POST', '/v2/branches/requests', (ctx) => ({ status: 201, body: { success: true } }));
on('PATCH', '/v2/branches/requests/:id/cancel', () => ({ status: 200, body: { success: true } }));
on('POST', '/v2/branches', (ctx) => {
  const branch = { id: uid('branch'), restaurantId: ctx.db.restaurant.id, code: (ctx.body.code || 'NEW').toUpperCase(), name: ctx.body.name || 'New Branch', timezone: ctx.body.timezone || 'Asia/Karachi', address: ctx.body.address || null, city: ctx.body.city || null, country: 'PK', phone: ctx.body.phone || null, email: ctx.body.email || null, isPrimary: false, isActive: true, createdAt: iso(new Date()), updatedAt: iso(new Date()) };
  ctx.db.locations.push(branch);
  return { status: 201, body: { branch } };
});
on('PUT', '/v2/branches/:id', (ctx) => {
  const branch = ctx.db.locations.find((l) => l.id === ctx.params.id);
  if (!branch) return { status: 404, body: { error: 'Not found' } };
  Object.assign(branch, ctx.body, { updatedAt: iso(new Date()) });
  return { status: 200, body: { branch } };
});
on('DELETE', '/v2/branches/:id', (ctx) => {
  ctx.db.locations = ctx.db.locations.filter((l) => l.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});
on('GET', '/v2/branches/:id/members', (ctx) => {
  const branch = ctx.db.locations.find((l) => l.id === ctx.params.id);
  const owner = ctx.db.staff.find((s) => s.role === 'owner');
  return { status: 200, body: { members: branch ? [{ principalType: 'staff', principalId: owner.id, name: owner.name, email: owner.email, role: 'owner' }] : [] } };
});
on('POST', '/v2/branches/:id/members', () => ({ status: 201, body: { success: true } }));
on('DELETE', '/v2/branches/:id/members/:type/:principalId', () => ({ status: 200, body: { success: true } }));
on('POST', '/v2/auth/invitations/send', () => ({ status: 200, body: { success: true } }));

on('GET', '/locations', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { locations: ctx.db.locations } };
});
on('POST', '/locations', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const location = { id: uid('branch'), restaurantId: ctx.db.restaurant.id, code: (ctx.body.code || 'NEW').toUpperCase(), name: ctx.body.name || 'New Branch', timezone: 'Asia/Karachi', city: ctx.body.city || null, country: 'PK', isPrimary: false, isActive: true, createdAt: iso(new Date()), updatedAt: iso(new Date()) };
  ctx.db.locations.push(location);
  return { status: 201, body: { location } };
});
on('PATCH', '/locations/:id', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const location = ctx.db.locations.find((l) => l.id === ctx.params.id);
  if (!location) return { status: 404, body: { error: 'Not found' } };
  Object.assign(location, ctx.body, { updatedAt: iso(new Date()) });
  return { status: 200, body: { location } };
});

on('GET', '/stock-transfers', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { transfers: ctx.db.stockTransfers } };
});
on('POST', '/stock-transfers', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const transfer = { id: uid('transfer'), restaurantId: ctx.db.restaurant.id, status: 'PENDING', items: ctx.body.items || [], createdAt: iso(new Date()), ...ctx.body };
  ctx.db.stockTransfers.unshift(transfer);
  return { status: 201, body: { transfer } };
});
on('POST', '/stock-transfers/:id/dispatch', (ctx) => {
  const t = ctx.db.stockTransfers.find((x) => x.id === ctx.params.id);
  if (!t) return { status: 404, body: { error: 'Not found' } };
  t.status = 'IN_TRANSIT';
  return { status: 200, body: { transfer: t } };
});
on('POST', '/stock-transfers/:id/complete', (ctx) => {
  const t = ctx.db.stockTransfers.find((x) => x.id === ctx.params.id);
  if (!t) return { status: 404, body: { error: 'Not found' } };
  t.status = 'COMPLETED';
  return { status: 200, body: { transfer: t } };
});

on('GET', '/custom-roles', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { roles: ctx.db.customRoles } };
});
on('GET', '/custom-roles/catalog', (ctx) => ({ status: 200, body: { permissions: ctx.db.permissionCatalog } }));
on('POST', '/custom-roles', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const role = { id: uid('role'), restaurantId: ctx.db.restaurant.id, name: ctx.body.name || 'New Role', description: ctx.body.description || '', permissions: ctx.body.permissions || [], staffCount: 0, createdAt: iso(new Date()) };
  ctx.db.customRoles.push(role);
  return { status: 201, body: { role } };
});
on('PATCH', '/custom-roles/:id', (ctx) => {
  const role = ctx.db.customRoles.find((r) => r.id === ctx.params.id);
  if (!role) return { status: 404, body: { error: 'Not found' } };
  Object.assign(role, ctx.body);
  return { status: 200, body: { role } };
});

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

on('GET', '/inventory', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { ingredients: ctx.db.ingredients } };
});
on('POST', '/inventory', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const ingredient = { id: uid('ing'), restaurantId: ctx.db.restaurant.id, name: ctx.body.name || 'New Ingredient', unit: ctx.body.unit || 'kg', currentStock: Number(ctx.body.currentStock || 0), lowStockThreshold: Number(ctx.body.lowStockThreshold || 5), costPerUnit: Number(ctx.body.costPerUnit || 0), isLowStock: false, createdAt: iso(new Date()), updatedAt: iso(new Date()) };
  ctx.db.ingredients.unshift(ingredient);
  return { status: 201, body: { ingredient } };
});
on('PUT', '/inventory/:id', (ctx) => {
  const ing = ctx.db.ingredients.find((i) => i.id === ctx.params.id);
  if (!ing) return { status: 404, body: { error: 'Not found' } };
  Object.assign(ing, ctx.body, { updatedAt: iso(new Date()) });
  ing.isLowStock = ing.currentStock <= ing.lowStockThreshold;
  return { status: 200, body: { ingredient: ing } };
});
on('DELETE', '/inventory/:id', (ctx) => {
  ctx.db.ingredients = ctx.db.ingredients.filter((i) => i.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});
on('POST', '/inventory/:id/adjust', (ctx) => {
  const ing = ctx.db.ingredients.find((i) => i.id === ctx.params.id);
  if (!ing) return { status: 404, body: { error: 'Not found' } };
  ing.currentStock += Number(ctx.body?.delta || 0);
  ing.isLowStock = ing.currentStock <= ing.lowStockThreshold;
  ing.updatedAt = iso(new Date());
  return { status: 200, body: { ingredient: ing } };
});
on('GET', '/inventory/logs', () => ({ status: 200, body: { logs: [] } }));
on('POST', '/inventory/count', (ctx) => ({ status: 200, body: { success: true } }));
on('GET', '/inventory/alerts', (ctx) => {
  const alerts = ctx.db.ingredients.filter((i) => i.isLowStock).map((i) => ({ id: uid('alert'), ingredientId: i.id, ingredientName: i.name, currentStock: i.currentStock, threshold: i.lowStockThreshold, createdAt: iso(new Date()) }));
  return { status: 200, body: { alerts } };
});
on('POST', '/inventory/alerts/:id/acknowledge', () => ({ status: 200, body: { success: true } }));
on('GET', '/inventory/suppliers', () => ({
  status: 200,
  body: { suppliers: [{ id: uid('sup'), name: 'Lahore Fresh Foods', phone: '+92 42 111222333', isActive: true }, { id: uid('sup'), name: 'Metro Wholesale', phone: '+92 42 444555666', isActive: true }] },
}));
on('POST', '/inventory/suppliers', (ctx) => ({ status: 201, body: { supplier: { id: uid('sup'), ...ctx.body } } }));
on('GET', '/inventory/purchase-orders', (ctx) => ({
  status: 200,
  body: { purchaseOrders: [{ id: uid('po'), status: 'PENDING', supplierName: 'Metro Wholesale', total: 24500, createdAt: iso(daysAgo(2)) }] },
}));

/* ------------------------------------------------------------------ *
 * Delivery
 * ------------------------------------------------------------------ */

on('GET', '/delivery/riders', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { riders: ctx.db.riders } };
});
on('POST', '/delivery/riders', (ctx) => {
  const rider = { id: uid('rider'), restaurantId: ctx.db.restaurant.id, name: ctx.body.name || 'New Rider', phone: ctx.body.phone || '', vehicleType: ctx.body.vehicleType || 'Motorcycle', isActive: true, isAvailable: true, status: 'AVAILABLE', totalDeliveries: 0, rating: null, createdAt: iso(new Date()) };
  ctx.db.riders.push(rider);
  return { status: 201, body: { rider } };
});
on('PATCH', '/delivery/riders/:id', (ctx) => {
  const rider = ctx.db.riders.find((r) => r.id === ctx.params.id);
  if (!rider) return { status: 404, body: { error: 'Not found' } };
  Object.assign(rider, ctx.body);
  return { status: 200, body: { rider } };
});
on('GET', '/delivery/assignments', (ctx) => ({ status: 200, body: { assignments: ctx.db.deliveryAssignments } }));
on('POST', '/delivery/assignments', (ctx) => {
  const assignment = { id: uid('assign'), orderId: ctx.body.orderId, riderId: ctx.body.riderId, status: 'ASSIGNED', createdAt: iso(new Date()) };
  ctx.db.deliveryAssignments.unshift(assignment);
  return { status: 201, body: { assignment } };
});
on('POST', '/delivery/assignments/:id/cancel', (ctx) => {
  const a = ctx.db.deliveryAssignments.find((x) => x.id === ctx.params.id);
  if (a) a.status = 'CANCELLED';
  return { status: 200, body: { success: true } };
});

/* ------------------------------------------------------------------ *
 * Staff
 * ------------------------------------------------------------------ */

on('GET', '/staff', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { staff: ctx.db.staff } };
});
on('POST', '/staff', (ctx) => {
  const member = { id: uid('staff'), restaurantId: ctx.db.restaurant.id, name: ctx.body.name || 'New Staff', email: ctx.body.email || `staff${ctx.db.staff.length + 1}@example.com`, role: ctx.body.role || 'cashier', isActive: true, phone: ctx.body.phone || '', pin: ctx.body.pin || null, createdAt: iso(new Date()) };
  ctx.db.staff.push(member);
  return { status: 201, body: { staff: member } };
});
on('PUT', '/staff/:id', (ctx) => {
  const member = ctx.db.staff.find((s) => s.id === ctx.params.id);
  if (!member) return { status: 404, body: { error: 'Not found' } };
  Object.assign(member, ctx.body);
  return { status: 200, body: { staff: member } };
});
on('DELETE', '/staff/:id', (ctx) => {
  ctx.db.staff = ctx.db.staff.filter((s) => s.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});

/* ------------------------------------------------------------------ *
 * Orders / POS
 * ------------------------------------------------------------------ */

function newOrderFromBody(db, body, sourceDefault) {
  const items = (body.items || []).map((line) => ({
    id: uid('oi'),
    menuItemId: line.menuItemId || line.id,
    name: line.name || 'Item',
    quantity: line.quantity || 1,
    price: Number(line.price || 0),
    itemTotal: Number(line.price || 0) * (line.quantity || 1),
  }));
  const subtotal = items.reduce((s, l) => s + l.itemTotal, 0);
  const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;
  const order = {
    id: uid('order'),
    restaurantId: db.restaurant.id,
    orderNumber: `ORD-${1000 + db.orders.length}`,
    status: 'PENDING',
    orderType: body.orderType || 'DINE_IN',
    source: body.source || sourceDefault || 'POS',
    items,
    subtotal,
    taxPercent: 5,
    taxAmount,
    discountAmount: 0,
    grandTotal: Math.round((subtotal + taxAmount) * 100) / 100,
    customerName: body.customerName || 'Walk-in Customer',
    tableId: body.tableId || null,
    createdAt: iso(new Date()),
    updatedAt: iso(new Date()),
  };
  db.orders.unshift(order);
  return order;
}

on('GET', '/orders', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const page = Number(ctx.query.get('page') || 1);
  const pageSize = Number(ctx.query.get('limit') || ctx.query.get('pageSize') || 20);
  const sorted = [...ctx.db.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const start = (page - 1) * pageSize;
  return { status: 200, body: { orders: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize } };
});
on('GET', '/orders/live', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const active = ctx.db.orders.filter((o) => ['PENDING', 'PREPARING', 'READY'].includes(o.status));
  return { status: 200, body: { orders: active } };
});
on('GET', '/orders/track/:id', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Order not found' } };
  return { status: 200, body: { order } };
});
on('POST', '/orders', (ctx) => {
  const order = newOrderFromBody(ctx.db, ctx.body || {}, 'ONLINE');
  return { status: 201, body: { success: true, order } };
});
on('PATCH', '/orders/:id/status', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  order.status = ctx.body.status || order.status;
  order.updatedAt = iso(new Date());
  return { status: 200, body: { order } };
});

on('POST', '/pos/orders', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const order = newOrderFromBody(ctx.db, ctx.body || {}, 'POS');
  return { status: 201, body: { success: true, order } };
});
on('POST', '/pos/orders/:id/pay', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  order.status = 'COMPLETED';
  order.paymentStatus = 'PAID';
  order.paymentMethod = ctx.body?.method || 'CASH';
  return { status: 200, body: { order } };
});
on('POST', '/pos/orders/:id/split', (ctx) => ({ status: 200, body: { success: true, splits: ctx.body?.splits || [] } }));
on('POST', '/pos/orders/:id/split-plan', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  const total = order?.grandTotal || 0;
  const parts = Number(ctx.body?.partyOf || ctx.body?.parts || 2);
  const each = Math.round((total / parts) * 100) / 100;
  return { status: 200, body: { plan: Array.from({ length: parts }, (_, i) => ({ index: i + 1, amount: each })) } };
});
on('POST', '/pos/orders/:id/transition', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  Object.assign(order, ctx.body);
  order.updatedAt = iso(new Date());
  return { status: 200, body: { order } };
});
on('POST', '/pos/orders/:id/refund', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  order.status = 'REFUNDED';
  return { status: 200, body: { order } };
});
on('POST', '/pos/orders/:id/void', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  order.status = 'CANCELLED';
  return { status: 200, body: { order } };
});
on('POST', '/pos/orders/merge', (ctx) => {
  const [firstId, ...rest] = ctx.body?.orderIds || [];
  const first = ctx.db.orders.find((o) => o.id === firstId);
  if (!first) return { status: 404, body: { error: 'Not found' } };
  for (const id of rest) {
    const other = ctx.db.orders.find((o) => o.id === id);
    if (!other) continue;
    first.items.push(...other.items);
    first.subtotal += other.subtotal;
    first.taxAmount += other.taxAmount;
    first.grandTotal += other.grandTotal;
    ctx.db.orders = ctx.db.orders.filter((o) => o.id !== id);
  }
  return { status: 200, body: { order: first } };
});
on('POST', '/pos/orders/:id/transfer-table', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  order.tableId = ctx.body?.toTableId || order.tableId;
  return { status: 200, body: { order } };
});
on('POST', '/pos/orders/:id/repeat', (ctx) => {
  const original = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!original) return { status: 404, body: { error: 'Not found' } };
  const order = newOrderFromBody(ctx.db, { items: original.items, orderType: original.orderType, tableId: original.tableId, customerName: original.customerName }, 'POS');
  return { status: 201, body: { order } };
});
on('POST', '/pos/tabs/hold', (ctx) => {
  ctx.db.heldTabs = ctx.db.heldTabs || [];
  const tab = { id: uid('tab'), ...ctx.body, heldAt: iso(new Date()) };
  ctx.db.heldTabs.push(tab);
  return { status: 201, body: { tab } };
});
on('GET', '/pos/tabs/held', (ctx) => ({ status: 200, body: { tabs: ctx.db.heldTabs || [] } }));
on('POST', '/pos/tabs/:id/resume', (ctx) => {
  ctx.db.heldTabs = ctx.db.heldTabs || [];
  const idx = ctx.db.heldTabs.findIndex((t) => t.id === ctx.params.id);
  if (idx === -1) return { status: 404, body: { error: 'Not found' } };
  const [tab] = ctx.db.heldTabs.splice(idx, 1);
  return { status: 200, body: { tab } };
});

on('POST', '/pos/shifts/open', (ctx) => {
  const session = requireAuth(ctx.db, ctx.cookies);
  ctx.db.posShifts = ctx.db.posShifts || [];
  const shift = { id: uid('shift'), staffId: session.operator?.id || session.staffId, openedAt: iso(new Date()), openingCash: Number(ctx.body?.openingCash || 0), status: 'OPEN', movements: [] };
  ctx.db.posShifts.push(shift);
  return { status: 201, body: { shift } };
});
on('GET', '/pos/shifts/active/:staffId', (ctx) => {
  const shift = (ctx.db.posShifts || []).find((s) => s.staffId === ctx.params.staffId && s.status === 'OPEN');
  return { status: 200, body: { shift: shift || null } };
});
on('POST', '/pos/shifts/:id/drawer', (ctx) => {
  const shift = (ctx.db.posShifts || []).find((s) => s.id === ctx.params.id);
  if (!shift) return { status: 404, body: { error: 'Not found' } };
  shift.movements.push({ id: uid('mv'), ...ctx.body, createdAt: iso(new Date()) });
  return { status: 200, body: { shift } };
});
on('POST', '/pos/shifts/:id/close', (ctx) => {
  const shift = (ctx.db.posShifts || []).find((s) => s.id === ctx.params.id);
  if (!shift) return { status: 404, body: { error: 'Not found' } };
  shift.status = 'CLOSED';
  shift.closedAt = iso(new Date());
  shift.closingCash = Number(ctx.body?.closingCash || shift.openingCash);
  return { status: 200, body: { shift } };
});
on('GET', '/pos/shifts/:id/reconciliation', (ctx) => {
  const shift = (ctx.db.posShifts || []).find((s) => s.id === ctx.params.id);
  if (!shift) return { status: 404, body: { error: 'Not found' } };
  return { status: 200, body: { reconciliation: { openingCash: shift.openingCash, closingCash: shift.closingCash || shift.openingCash, movements: shift.movements, variance: 0 } } };
});
on('GET', '/pos/receipt/:id', (ctx) => {
  const order = ctx.db.orders.find((o) => o.id === ctx.params.id);
  if (!order) return { status: 404, body: { error: 'Not found' } };
  return { status: 200, body: { receipt: { order, restaurant: ctx.db.restaurant, printedAt: iso(new Date()) } } };
});

/* ------------------------------------------------------------------ *
 * Offline sync engine — health/bootstrap only, enough to keep the UI in
 * ONLINE mode instead of showing an "isolated / restricted" banner. The
 * deeper edge-node / emergency-primary-POS machinery isn't modeled.
 * ------------------------------------------------------------------ */

on('GET', '/sync/health', () => ({
  status: 200,
  body: { database: 'connected', serverTime: iso(new Date()), minimumLocalSchemaVersion: 1, maximumLocalSchemaVersion: 20, edge: null },
}));
on('GET', '/sync/bootstrap', (ctx) => ({
  status: 200,
  body: {
    offlineAccessToken: 'demo-offline-token',
    device: { deviceType: 'POS', isPrimaryPos: true, emergencyEpoch: 0, capabilities: null, name: 'Demo Browser' },
    offlineAuthority: { policyVersion: 1 },
    locations: ctx.db.locations,
  },
}));
on('POST', '/sync/devices/register', (ctx) => ({
  status: 200,
  body: { success: true, device: { deviceType: 'POS', isPrimaryPos: true, emergencyEpoch: 0 } },
}));

/* ------------------------------------------------------------------ *
 * Data & History / exports
 * ------------------------------------------------------------------ */

function groupBy(orders, keyFn) {
  const map = new Map();
  for (const o of orders) {
    const key = keyFn(o) || 'UNKNOWN';
    const row = map.get(key) || { key, count: 0, amount: 0 };
    row.count += 1;
    row.amount += o.grandTotal;
    map.set(key, row);
  }
  return [...map.values()];
}

on('GET', '/exports/history/summary', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  const db = ctx.db;
  const from = ctx.query.get('from');
  const to = ctx.query.get('to');
  const inRange = db.orders.filter((o) => {
    const day = o.createdAt.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  });
  const nonCancelled = inRange.filter((o) => o.status !== 'CANCELLED');
  const refunded = inRange.filter((o) => o.status === 'REFUNDED');
  const grossSales = nonCancelled.reduce((s, o) => s + o.grandTotal, 0);
  const refunds = refunded.reduce((s, o) => s + o.grandTotal, 0);
  const discounts = nonCancelled.reduce((s, o) => s + (o.discountAmount || 0), 0);
  const earliest = db.orders.reduce((min, o) => (!min || o.createdAt < min ? o.createdAt : min), null);
  return {
    status: 200,
    body: {
      restaurant: { currency: db.restaurant.currency },
      sales: {
        netAfterRefunds: Math.round((grossSales - refunds) * 100) / 100,
        orders: nonCancelled.length,
        grossSales,
        refunds,
        averageTicket: nonCancelled.length ? Math.round((grossSales / nonCancelled.length) * 100) / 100 : 0,
        discounts,
      },
      operations: {
        inventoryValuation: Math.round(db.ingredients.reduce((s, i) => s + i.currentStock * i.costPerUnit, 0)),
        stockMovements: { count: db.ingredients.length * 2 },
      },
      breakdowns: {
        statuses: groupBy(inRange, (o) => o.status),
        orderTypes: groupBy(inRange, (o) => o.orderType),
        paymentMethods: groupBy(inRange.filter((o) => o.paymentMethod), (o) => o.paymentMethod),
      },
      availability: { earliestOrderAt: earliest },
    },
  };
});
on('GET', '/exports/history/exports', () => ({
  status: 200,
  body: {
    data: [
      { id: uid('exp'), dataset: 'orders', format: 'XLSX', checksumSha256: 'a1b2c3d4e5f6…', scope: 'All branches', createdAt: iso(daysAgo(2)) },
      { id: uid('exp'), dataset: 'inventory', format: 'CSV', checksumSha256: 'f6e5d4c3b2a1…', scope: 'Main Branch', createdAt: iso(daysAgo(5)) },
    ],
  },
}));

/* ------------------------------------------------------------------ *
 * Promos
 * ------------------------------------------------------------------ */

on('GET', '/promos', (ctx) => {
  requireAuth(ctx.db, ctx.cookies);
  return { status: 200, body: { promos: ctx.db.promos } };
});
on('POST', '/promos', (ctx) => {
  const promo = { id: uid('promo'), restaurantId: ctx.db.restaurant.id, code: (ctx.body.code || 'PROMO').toUpperCase(), description: ctx.body.description || '', discountType: ctx.body.discountType || 'PERCENTAGE', discountValue: Number(ctx.body.discountValue || 0), isActive: true, usageCount: 0, maxUsage: ctx.body.maxUsage || null, createdAt: iso(new Date()) };
  ctx.db.promos.push(promo);
  return { status: 201, body: { promo } };
});
on('DELETE', '/promos/:id', (ctx) => {
  ctx.db.promos = ctx.db.promos.filter((p) => p.id !== ctx.params.id);
  return { status: 200, body: { success: true } };
});

/* ------------------------------------------------------------------ *
 * Public storefront (no auth required)
 * ------------------------------------------------------------------ */

on('GET', '/r/:slug', (ctx) => {
  if (ctx.params.slug !== ctx.db.restaurant.slug) return { status: 404, body: { error: 'Restaurant not found' } };
  return { status: 200, body: { restaurant: ctx.db.restaurant, theme: ctx.db.theme } };
});
on('GET', '/r/:slug/menu', (ctx) => {
  if (ctx.params.slug !== ctx.db.restaurant.slug) return { status: 404, body: { error: 'Restaurant not found' } };
  const available = ctx.db.menuItems.filter((item) => item.isAvailable);
  const categories = ctx.db.categories
    .filter((cat) => cat.isActive)
    .map((cat) => ({ ...cat, menuItems: available.filter((item) => item.categoryId === cat.id) }));
  const categorized = new Set(categories.flatMap((c) => c.menuItems.map((i) => i.id)));
  const uncategorized = available.filter((item) => !categorized.has(item.id));
  return { status: 200, body: { categories, uncategorized } };
});
on('GET', '/r/:slug/table/:token', (ctx) => {
  if (ctx.params.slug !== ctx.db.restaurant.slug) return { status: 404, body: { error: 'Restaurant not found' } };
  const table = ctx.db.tables.find((t) => t.qrToken === ctx.params.token);
  if (!table) return { status: 404, body: { error: 'This QR code is unavailable' } };
  return { status: 200, body: { table: { ...table, tableNumber: table.tableNumber || table.label } } };
});

/* ------------------------------------------------------------------ *
 * Dispatcher
 * ------------------------------------------------------------------ */

export function handleMockRequest({ method, path, query, body, cookies }) {
  const db = getDb();
  const ctx = { db, cookies, query, body };

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.regex.exec(path);
    if (!match) continue;
    ctx.params = match.groups || {};
    try {
      const result = route.handler(ctx);
      return { status: result.status || 200, body: result.body, headers: result.headers || {}, cookies: result.cookies || [] };
    } catch (err) {
      if (err.status) {
        return { status: err.status, body: { error: err.message, code: err.code }, headers: {}, cookies: [] };
      }
      console.error('[mock-api] handler error for', method, path, err);
      return { status: 500, body: { error: 'Mock server error', message: err.message }, headers: {}, cookies: [] };
    }
  }

  // Unmocked endpoint — degrade gracefully instead of failing the screen.
  return { status: 200, body: fallbackBody(method), headers: {}, cookies: [] };
}
