import menuFixture from './seed/menu.json';
import categoriesFixture from './seed/categories.json';

/**
 * Everything this standalone demo needs to look like a real, running
 * restaurant — no database, no backend process, just data held in memory
 * for the life of this Node process. It was captured from a real seeded
 * Dine3D restaurant (menu items, categories, theme, locations) and then
 * extended by hand (orders, inventory, staff, riders, invoices, ...) for
 * modules that aren't reachable on a Free Trial plan. The mock plan below
 * is deliberately generous — "Business", every feature allowed — so
 * nothing in the UI shows an upsell wall during a demo.
 */

const RESTAURANT_ID = 'd0d540aa-cdbb-428e-81be-7d317523850f';
const OWNER_ID = '3583f392-9b86-4041-9501-f68823a38d15';
const CASHIER_ID = '1c001f8d-b3b3-407e-b0fc-f7104f23b9aa';
const MAIN_BRANCH_ID = '1ec3517b-ed86-42a5-96e7-818241606f96';
const SECOND_BRANCH_ID = 'branch-gulberg-0002';

const now = () => new Date();
const iso = (d) => d.toISOString();
const daysAgo = (n, hour = 12, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

function flattenMenuItems() {
  return menuFixture.items.map((item) => ({ ...item }));
}

function buildIngredients() {
  const units = 'kg';
  const rows = [
    ['Chicken Breast', 'kg', 42, 10, 480],
    ['Beef Cubes', 'kg', 18, 8, 950],
    ['Basmati Rice', 'kg', 65, 15, 320],
    ['Mozzarella Cheese', 'kg', 9, 6, 1450],
    ['Pizza Dough Base', 'pcs', 24, 10, 90],
    ['Cooking Oil', 'litre', 30, 10, 520],
    ['Wheat Flour', 'kg', 55, 15, 180],
    ['Tomatoes', 'kg', 12, 10, 140],
    ['Onions', 'kg', 20, 10, 110],
    ['Potatoes', 'kg', 8, 10, 100],
    ['Cola Syrup Concentrate', 'litre', 6, 3, 2100],
    ['Full Cream Milk', 'litre', 14, 8, 260],
    ['Sugar', 'kg', 16, 8, 190],
    ['Mixed Spices Blend', 'kg', 5, 3, 900],
  ];
  return rows.map(([name, unit, stock, threshold, cost], idx) => ({
    id: uid('ing'),
    restaurantId: RESTAURANT_ID,
    branchId: idx % 3 === 0 ? SECOND_BRANCH_ID : MAIN_BRANCH_ID,
    name,
    unit: unit || units,
    currentStock: stock,
    lowStockThreshold: threshold,
    costPerUnit: cost,
    isLowStock: stock <= threshold,
    supplier: idx % 2 === 0 ? 'Lahore Fresh Foods' : 'Metro Wholesale',
    updatedAt: iso(daysAgo(idx % 5)),
    createdAt: iso(daysAgo(30)),
  }));
}

function buildStaff() {
  return [
    {
      id: OWNER_ID,
      restaurantId: RESTAURANT_ID,
      name: 'Asjad Yousaf',
      email: 'asjad@gmail.com',
      role: 'owner',
      isActive: true,
      phone: '+92 300 1234567',
      pin: null,
      createdAt: iso(daysAgo(60)),
    },
    {
      id: CASHIER_ID,
      restaurantId: RESTAURANT_ID,
      name: 'Asjad (POS)',
      email: 'asjadpos@gmail.com',
      role: 'cashier',
      isActive: true,
      phone: '+92 301 7654321',
      pin: '1234',
      createdAt: iso(daysAgo(45)),
    },
    {
      id: uid('staff'),
      restaurantId: RESTAURANT_ID,
      name: 'Hina Malik',
      email: 'hina.kitchen@example.com',
      role: 'kitchen',
      isActive: true,
      phone: '+92 302 4455667',
      pin: '4321',
      createdAt: iso(daysAgo(20)),
    },
  ];
}

function buildRiders() {
  return [
    {
      id: uid('rider'),
      restaurantId: RESTAURANT_ID,
      name: 'Bilal Ahmed',
      phone: '+92 333 1122334',
      vehicleType: 'Motorcycle',
      isActive: true,
      isAvailable: true,
      status: 'AVAILABLE',
      totalDeliveries: 214,
      rating: 4.8,
      createdAt: iso(daysAgo(90)),
    },
    {
      id: uid('rider'),
      restaurantId: RESTAURANT_ID,
      name: 'Usman Tariq',
      phone: '+92 321 9988776',
      vehicleType: 'Motorcycle',
      isActive: true,
      isAvailable: false,
      status: 'ON_DELIVERY',
      totalDeliveries: 132,
      rating: 4.6,
      createdAt: iso(daysAgo(70)),
    },
  ];
}

function buildTables() {
  const names = ['T1', 'T2', 'T3', 'T4', 'VIP-1', 'VIP-2'];
  return names.map((label, idx) => ({
    id: uid('table'),
    restaurantId: RESTAURANT_ID,
    branchId: MAIN_BRANCH_ID,
    tableNumber: label,
    label,
    capacity: idx >= 4 ? 8 : 4,
    qrToken: uid('qr'),
    qrCodeUrl: null,
    isActive: true,
    createdAt: iso(daysAgo(80)),
  }));
}

function buildPromos() {
  return [
    {
      id: uid('promo'),
      restaurantId: RESTAURANT_ID,
      code: 'WELCOME10',
      description: '10% off your first order',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      isActive: true,
      usageCount: 38,
      maxUsage: null,
      createdAt: iso(daysAgo(50)),
    },
    {
      id: uid('promo'),
      restaurantId: RESTAURANT_ID,
      code: 'FREESHIP',
      description: 'Free delivery on orders above Rs. 1000',
      discountType: 'FIXED',
      discountValue: 150,
      isActive: true,
      usageCount: 12,
      maxUsage: 200,
      createdAt: iso(daysAgo(14)),
    },
  ];
}

function buildCustomRoles() {
  return [
    {
      id: uid('role'),
      restaurantId: RESTAURANT_ID,
      name: 'Shift Manager',
      description: 'Runs the floor during a shift: orders, tables, refunds up to a limit.',
      permissions: ['orders.read', 'orders.write', 'tables.write', 'pos.refund'],
      staffCount: 1,
      createdAt: iso(daysAgo(40)),
    },
    {
      id: uid('role'),
      restaurantId: RESTAURANT_ID,
      name: 'Inventory Lead',
      description: 'Owns stock counts, purchase orders, and supplier relationships.',
      permissions: ['inventory.read', 'inventory.write', 'inventory.purchase_orders'],
      staffCount: 1,
      createdAt: iso(daysAgo(25)),
    },
  ];
}

const PERMISSION_CATALOG = [
  { key: 'orders.read', label: 'View orders', group: 'Orders' },
  { key: 'orders.write', label: 'Manage orders', group: 'Orders' },
  { key: 'pos.refund', label: 'Issue refunds', group: 'Point of Sale' },
  { key: 'tables.write', label: 'Manage tables', group: 'Floor' },
  { key: 'inventory.read', label: 'View inventory', group: 'Inventory' },
  { key: 'inventory.write', label: 'Manage inventory', group: 'Inventory' },
  { key: 'inventory.purchase_orders', label: 'Manage purchase orders', group: 'Inventory' },
  { key: 'menu.write', label: 'Manage menu', group: 'Menu' },
  { key: 'staff.write', label: 'Manage staff', group: 'Team' },
];

function buildOrders(menuItems) {
  const pick = (n) => menuItems[n % menuItems.length];
  const lineFor = (item, qty) => ({
    id: uid('oi'),
    menuItemId: item.id,
    name: item.name,
    quantity: qty,
    price: Number(item.basePrice),
    itemTotal: Number(item.basePrice) * qty,
  });

  const specs = [
    { daysBack: 0, hour: 13, minute: 5, status: 'COMPLETED', type: 'DINE_IN', items: [[0, 2], [7, 1]] },
    { daysBack: 0, hour: 13, minute: 40, status: 'PREPARING', type: 'TAKEAWAY', items: [[14, 1], [3, 2]] },
    { daysBack: 0, hour: 14, minute: 10, status: 'PENDING', type: 'DELIVERY', items: [[16, 1]] },
    { daysBack: 0, hour: 11, minute: 20, status: 'COMPLETED', type: 'QR_ORDER', items: [[9, 3], [5, 2]] },
    { daysBack: 1, hour: 19, minute: 30, status: 'COMPLETED', type: 'DINE_IN', items: [[18, 1], [8, 1]] },
    { daysBack: 1, hour: 20, minute: 5, status: 'COMPLETED', type: 'DELIVERY', items: [[25, 1], [1, 2]] },
    { daysBack: 2, hour: 12, minute: 45, status: 'CANCELLED', type: 'TAKEAWAY', items: [[12, 1]] },
    { daysBack: 2, hour: 18, minute: 15, status: 'COMPLETED', type: 'DINE_IN', items: [[24, 1], [6, 1]] },
    { daysBack: 3, hour: 13, minute: 0, status: 'COMPLETED', type: 'QR_ORDER', items: [[20, 2]] },
    { daysBack: 4, hour: 21, minute: 10, status: 'COMPLETED', type: 'DELIVERY', items: [[17, 1], [15, 1]] },
  ];

  return specs.map((spec, idx) => {
    const items = spec.items.map(([itemIdx, qty]) => lineFor(pick(itemIdx), qty));
    const subtotal = items.reduce((sum, l) => sum + l.itemTotal, 0);
    const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;
    const discountAmount = idx === 3 ? 50 : 0;
    const createdAt = daysAgo(spec.daysBack, spec.hour, spec.minute);
    return {
      id: uid('order'),
      restaurantId: RESTAURANT_ID,
      orderNumber: `ORD-${1000 + idx}`,
      status: spec.status,
      orderType: spec.type,
      source: spec.type === 'QR_ORDER' ? 'QR' : spec.type === 'DELIVERY' ? 'ONLINE' : 'POS',
      items,
      subtotal,
      taxPercent: 5,
      taxAmount,
      discountAmount,
      grandTotal: Math.round((subtotal + taxAmount - discountAmount) * 100) / 100,
      customerName: ['Ahmed Raza', 'Sara Khan', 'Bilal Iqbal', 'Ayesha Noor', 'Hamza Sheikh'][idx % 5],
      tableId: spec.type === 'DINE_IN' ? uid('table') : null,
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
    };
  }).reverse();
}

export function createInitialDb() {
  const menuItems = flattenMenuItems();
  const categories = categoriesFixture.categories.map((c) => ({ ...c }));
  const orders = buildOrders(menuItems);

  return {
    restaurant: {
      id: RESTAURANT_ID,
      name: 'Foodpanda Pakistan',
      slug: 'foodpanda-pk',
      restaurantCode: 'DINE-1000',
      phone: '+92 300 1234567',
      address: 'Lahore, Pakistan',
      logo: null,
      currency: 'PKR',
      isActive: true,
      createdAt: iso(daysAgo(120)),
      description: 'A demo multi-branch restaurant used to showcase Dine3D.',
      timezone: 'Asia/Karachi',
      orderPrefix: 'ORD',
      receiptFooter: 'Thank you for ordering with us!',
      taxRegistrationNumber: null,
      lowStockThreshold: 10,
      menuPublished: true,
      tipEnabled: false,
      isKitchenEnabled: true,
    },
    theme: {
      id: uid('theme'),
      restaurantId: RESTAURANT_ID,
      primaryColor: '#FF6B35',
      secondaryColor: '#1A1A2E',
      accentColor: '#F7C948',
      backgroundColor: '#FFFFFF',
      textColor: '#1A1A2E',
      fontFamily: 'Inter',
      headingFont: 'Outfit',
      layoutTemplate: 'grid',
      borderRadius: '12px',
      offerText: 'Free delivery on orders above Rs. 1000',
      customCss: null,
      createdAt: iso(daysAgo(60)),
      updatedAt: iso(daysAgo(2)),
    },
    locations: [
      {
        id: MAIN_BRANCH_ID,
        restaurantId: RESTAURANT_ID,
        code: 'MAIN',
        name: 'Main Branch (Gulshan)',
        timezone: 'Asia/Karachi',
        address: '12-C Gulshan Block, Lahore',
        city: 'Lahore',
        country: 'PK',
        phone: '+92 300 1234567',
        isPrimary: true,
        isActive: true,
        createdAt: iso(daysAgo(120)),
        updatedAt: iso(daysAgo(120)),
      },
      {
        id: SECOND_BRANCH_ID,
        restaurantId: RESTAURANT_ID,
        code: 'GULBERG',
        name: 'Gulberg Branch',
        timezone: 'Asia/Karachi',
        address: '45 Main Boulevard, Gulberg III, Lahore',
        city: 'Lahore',
        country: 'PK',
        phone: '+92 300 9988776',
        isPrimary: false,
        isActive: true,
        createdAt: iso(daysAgo(35)),
        updatedAt: iso(daysAgo(35)),
      },
    ],
    categories,
    menuItems,
    tables: buildTables(),
    ingredients: buildIngredients(),
    orders,
    staff: buildStaff(),
    riders: buildRiders(),
    deliveryAssignments: [],
    promos: buildPromos(),
    customRoles: buildCustomRoles(),
    permissionCatalog: PERMISSION_CATALOG,
    stockTransfers: [
      {
        id: uid('transfer'),
        restaurantId: RESTAURANT_ID,
        fromBranchId: MAIN_BRANCH_ID,
        toBranchId: SECOND_BRANCH_ID,
        status: 'IN_TRANSIT',
        items: [{ ingredientName: 'Mozzarella Cheese', quantity: 3, unit: 'kg' }],
        createdAt: iso(daysAgo(1)),
      },
    ],
    invoices: [
      {
        id: uid('inv'),
        number: 'INV-2026-0091',
        status: 'PAID',
        total: 4999,
        amountDue: 0,
        meteredQuantity: 214,
        currency: 'PKR',
        periodStart: iso(daysAgo(60)),
        periodEnd: iso(daysAgo(30)),
        issuedAt: iso(daysAgo(60)),
        dueAt: iso(daysAgo(57)),
        paidAt: iso(daysAgo(58)),
        createdAt: iso(daysAgo(60)),
        lines: [
          { id: uid('line'), description: 'Business plan — base fee', quantity: 1, amount: 4999 },
        ],
      },
      {
        id: uid('inv'),
        number: 'INV-2026-0114',
        status: 'PAID',
        total: 4999,
        amountDue: 0,
        meteredQuantity: 198,
        currency: 'PKR',
        periodStart: iso(daysAgo(30)),
        periodEnd: iso(now()),
        issuedAt: iso(daysAgo(30)),
        dueAt: iso(daysAgo(27)),
        paidAt: iso(daysAgo(28)),
        createdAt: iso(daysAgo(30)),
        lines: [
          { id: uid('line'), description: 'Business plan — base fee', quantity: 1, amount: 4999 },
        ],
      },
    ],
    plan: {
      id: 'plan-business',
      key: 'business',
      name: 'Business',
      price: '4999',
      currency: 'PKR',
      billingInterval: 'MONTHLY',
    },
    sessions: new Map(),
    csrfTokens: new Set(),
    ids: { RESTAURANT_ID, OWNER_ID, CASHIER_ID, MAIN_BRANCH_ID, SECOND_BRANCH_ID },
  };
}

export const DEMO_LOGIN = {
  restaurantCode: 'DINE-1000',
  email: 'asjad@gmail.com',
  password: 'Velvet-Lantern-Sky-731!',
};

export { uid, iso, daysAgo, now };
