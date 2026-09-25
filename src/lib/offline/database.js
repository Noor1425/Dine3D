'use client';

import Dexie from 'dexie';

export const OFFLINE_SCHEMA_VERSION = 6;
export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  EDGE_COMMITTED: 'edge_committed',
  SYNCING: 'syncing',
  ACKNOWLEDGED: 'acknowledged',
  RETRYABLE_FAILED: 'retryable_failed',
  PERMANENTLY_FAILED: 'permanently_failed',
  CONFLICT: 'conflict',
  BLOCKED_BY_AUTH: 'blocked_by_auth',
});

export const ACTIVE_OUTBOX_STATUSES = Object.freeze([
  OUTBOX_STATUS.PENDING,
  OUTBOX_STATUS.EDGE_COMMITTED,
  OUTBOX_STATUS.SYNCING,
  OUTBOX_STATUS.RETRYABLE_FAILED,
  OUTBOX_STATUS.BLOCKED_BY_AUTH,
]);

const databaseCache = new Map();

function assertBrowser() {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable in this environment');
  }
}

function assertTenantId(tenantId) {
  const value = String(tenantId || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{8,80}$/.test(value)) {
    throw new Error('A valid tenant identifier is required for offline storage');
  }
  return value;
}

export function createGlobalId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function databaseName(tenantId) {
  return `dine3d-offline-${assertTenantId(tenantId)}`;
}

function configureDatabase(tenantId) {
  const db = new Dexie(databaseName(tenantId));

  // Version 1 is retained so upgrades can be tested and are transactional.
  db.version(1).stores({
    cachedRestaurant: '&id,tenantId,updatedAt',
    orders: '&id,tenantId,locationId,syncStatus,updatedAt',
    orderItems: '&id,tenantId,orderId,syncStatus',
    syncOutbox: '&operationId,[tenantId+status],[deviceId+localSequence],entityId,createdAt,nextRetryAt',
    syncCheckpoints: '&id,tenantId,deviceId,updatedAt',
    deviceIdentity: '&id,tenantId,deviceId,updatedAt',
  });

  db.version(2).stores({
    cachedRestaurant: '&id,tenantId,updatedAt',
    cachedLocations: '&id,tenantId,isActive,updatedAt',
    tables: '&id,tenantId,locationId,isActive,updatedAt',
    menuCategories: '&id,tenantId,sortOrder,updatedAt',
    menuItems: '&id,tenantId,categoryId,isAvailable,updatedAt',
    modifiers: '&id,tenantId,menuItemId,modifierGroupId,updatedAt',
    recipes: '&id,tenantId,menuItemId,ingredientId,updatedAt',
    inventorySnapshots: '&id,tenantId,locationId,updatedAt',
    orders: '&id,tenantId,locationId,syncStatus,fulfilmentStatus,paymentState,updatedAt',
    orderItems: '&id,tenantId,orderId,syncStatus,updatedAt',
    kitchenTickets: '&id,tenantId,locationId,orderId,syncStatus,updatedAt',
    payments: '&id,tenantId,locationId,orderId,syncStatus,status,updatedAt',
    inventoryMovements: '&id,tenantId,locationId,inventoryItemId,syncStatus,businessTimestamp',
    purchaseReceipts: '&id,tenantId,locationId,purchaseOrderId,syncStatus,updatedAt',
    wastage: '&id,tenantId,locationId,inventoryItemId,syncStatus,updatedAt',
    stockAdjustments: '&id,tenantId,locationId,inventoryItemId,syncStatus,updatedAt',
    operationalNotes: '&id,tenantId,locationId,syncStatus,updatedAt',
    syncOutbox: '&operationId,[tenantId+status],[deviceId+localSequence],entityId,createdAt,nextRetryAt',
    syncConflicts: '&id,operationId,[tenantId+status],entityId,createdAt',
    syncCheckpoints: '&id,tenantId,deviceId,updatedAt',
    deviceIdentity: '&id,tenantId,deviceId,updatedAt',
    localAuditEvents: '&id,tenantId,deviceId,action,createdAt',
    publicQrSubmissions: '&id,tenantId,tableId,status,updatedAt',
    metadata: '&id,tenantId,updatedAt',
  }).upgrade(async (tx) => {
    const now = new Date().toISOString();
    for (const tableName of ['orders', 'orderItems', 'syncOutbox']) {
      const table = tx.table(tableName);
      await table.toCollection().modify((record) => {
        record.tenantId = record.tenantId || tenantId;
        record.updatedAt = record.updatedAt || now;
        record.syncStatus = record.syncStatus || record.status || OUTBOX_STATUS.PENDING;
        if (tableName === 'syncOutbox') record.status = record.status || OUTBOX_STATUS.PENDING;
      });
    }
  });

  db.version(3).stores({
    cachedRestaurant: '&id,tenantId,updatedAt',
    cachedLocations: '&id,tenantId,isActive,updatedAt',
    cachedSuppliers: '&id,tenantId,isActive,updatedAt',
    cachedPurchaseOrders: '&id,tenantId,locationId,status,updatedAt',
    tables: '&id,tenantId,locationId,isActive,updatedAt',
    menuCategories: '&id,tenantId,sortOrder,updatedAt',
    menuItems: '&id,tenantId,categoryId,isAvailable,updatedAt',
    modifiers: '&id,tenantId,menuItemId,modifierGroupId,updatedAt',
    recipes: '&id,tenantId,menuItemId,ingredientId,updatedAt',
    inventorySnapshots: '&id,tenantId,locationId,updatedAt',
    orders: '&id,tenantId,locationId,syncStatus,fulfilmentStatus,paymentState,updatedAt',
    orderItems: '&id,tenantId,orderId,syncStatus,updatedAt',
    kitchenTickets: '&id,tenantId,locationId,orderId,syncStatus,updatedAt',
    payments: '&id,tenantId,locationId,orderId,syncStatus,status,updatedAt',
    inventoryMovements: '&id,tenantId,locationId,inventoryItemId,syncStatus,businessTimestamp',
    purchaseReceipts: '&id,tenantId,locationId,purchaseOrderId,syncStatus,updatedAt',
    wastage: '&id,tenantId,locationId,inventoryItemId,syncStatus,updatedAt',
    stockAdjustments: '&id,tenantId,locationId,inventoryItemId,syncStatus,updatedAt',
    operationalNotes: '&id,tenantId,locationId,syncStatus,updatedAt',
    syncOutbox: '&operationId,[tenantId+status],[deviceId+localSequence],entityId,createdAt,nextRetryAt',
    syncConflicts: '&id,operationId,[tenantId+status],entityId,createdAt',
    syncCheckpoints: '&id,tenantId,deviceId,updatedAt',
    deviceIdentity: '&id,tenantId,deviceId,updatedAt',
    localAuditEvents: '&id,tenantId,deviceId,action,createdAt',
    publicQrSubmissions: '&id,tenantId,tableId,status,updatedAt',
    metadata: '&id,tenantId,updatedAt',
  });

  // `db.tables` is a reserved Dexie property containing the collection of
  // schema tables. Versions 2–3 accidentally used the same name for cached
  // restaurant tables. Keep the legacy store intact for rollback/export and
  // copy its rows transactionally to the non-reserved v4 store.
  db.version(4).stores({
    cachedRestaurant: '&id,tenantId,updatedAt',
    cachedLocations: '&id,tenantId,isActive,updatedAt',
    cachedSuppliers: '&id,tenantId,isActive,updatedAt',
    cachedPurchaseOrders: '&id,tenantId,locationId,status,updatedAt',
    tables: '&id,tenantId,locationId,isActive,updatedAt',
    cachedTables: '&id,tenantId,locationId,isActive,updatedAt',
    menuCategories: '&id,tenantId,sortOrder,updatedAt',
    menuItems: '&id,tenantId,categoryId,isAvailable,updatedAt',
    modifiers: '&id,tenantId,menuItemId,modifierGroupId,updatedAt',
    recipes: '&id,tenantId,menuItemId,ingredientId,updatedAt',
    inventorySnapshots: '&id,tenantId,locationId,updatedAt',
    orders: '&id,tenantId,locationId,syncStatus,fulfilmentStatus,paymentState,updatedAt',
    orderItems: '&id,tenantId,orderId,syncStatus,updatedAt',
    kitchenTickets: '&id,tenantId,locationId,orderId,syncStatus,updatedAt',
    payments: '&id,tenantId,locationId,orderId,syncStatus,status,updatedAt',
    inventoryMovements: '&id,tenantId,locationId,inventoryItemId,syncStatus,businessTimestamp',
    purchaseReceipts: '&id,tenantId,locationId,purchaseOrderId,syncStatus,updatedAt',
    wastage: '&id,tenantId,locationId,inventoryItemId,syncStatus,updatedAt',
    stockAdjustments: '&id,tenantId,locationId,inventoryItemId,syncStatus,updatedAt',
    operationalNotes: '&id,tenantId,locationId,syncStatus,updatedAt',
    syncOutbox: '&operationId,[tenantId+status],[deviceId+localSequence],entityId,createdAt,nextRetryAt',
    syncConflicts: '&id,operationId,[tenantId+status],entityId,createdAt',
    syncCheckpoints: '&id,tenantId,deviceId,updatedAt',
    deviceIdentity: '&id,tenantId,deviceId,updatedAt',
    localAuditEvents: '&id,tenantId,deviceId,action,createdAt',
    publicQrSubmissions: '&id,tenantId,tableId,status,updatedAt',
    metadata: '&id,tenantId,updatedAt',
  }).upgrade(async (tx) => {
    const legacyRows = await tx.table('tables').toArray();
    if (legacyRows.length > 0) await tx.table('cachedTables').bulkPut(legacyRows);
  });

  // Version 5 adds the access path used by the incremental sync scheduler.
  // Existing records are re-indexed transactionally by IndexedDB; no local
  // orders or pending operations are rewritten or discarded.
  db.version(5).stores({
    syncOutbox: '&operationId,[tenantId+status],[tenantId+status+localSequence],[deviceId+localSequence],entityId,createdAt,nextRetryAt',
  });

  /**
   * Version 6 caches the delivery riders. Without them the rider selector at
   * the till is empty the moment the internet drops, and a delivery goes out
   * with nobody's name against it — which is exactly when knowing who has the
   * food matters most.
   */
  db.version(6).stores({
    cachedRiders: '&id,restaurantId,branchId,isAvailable',
  });

  db.on('versionchange', () => {
    db.close();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dine3d-offline-update-required'));
    }
  });

  return db;
}

export async function getTenantDatabase(tenantId) {
  assertBrowser();
  const normalizedTenantId = assertTenantId(tenantId);
  if (!databaseCache.has(normalizedTenantId)) {
    databaseCache.set(normalizedTenantId, configureDatabase(normalizedTenantId));
  }
  const db = databaseCache.get(normalizedTenantId);
  try {
    await db.open();
    return db;
  } catch (error) {
    // Dexie schema upgrades are transactional. Never delete a database to
    // recover from a migration failure; expose the error for export/support.
    error.code = error.code || 'LOCAL_SCHEMA_MIGRATION_FAILED';
    throw error;
  }
}

export function closeTenantDatabase(tenantId) {
  const normalizedTenantId = assertTenantId(tenantId);
  const db = databaseCache.get(normalizedTenantId);
  db?.close();
  databaseCache.delete(normalizedTenantId);
}

function iso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function stampLocalRecord(record, context, overrides = {}) {
  const now = iso();
  return {
    ...record,
    tenantId: context.tenantId,
    restaurantId: context.tenantId,
    locationId: record.locationId ?? context.locationId ?? null,
    deviceId: record.deviceId || context.deviceId,
    createdAt: record.createdAt || now,
    updatedAt: now,
    localVersion: Number(record.localVersion || 1),
    serverVersion: record.serverVersion ?? null,
    syncStatus: record.syncStatus || OUTBOX_STATUS.PENDING,
    ...overrides,
  };
}

async function nextSequence(db, context) {
  const checkpointId = `${context.tenantId}:${context.deviceId}`;
  const existing = await db.syncCheckpoints.get(checkpointId);
  const next = Number(existing?.lastLocalSequence || 0) + 1;
  await db.syncCheckpoints.put(stampLocalRecord({
    id: checkpointId,
    deviceId: context.deviceId,
    lastLocalSequence: next,
    lastServerCheckpoint: existing?.lastServerCheckpoint || null,
    lastSuccessfulSyncAt: existing?.lastSuccessfulSyncAt || null,
  }, context, { syncStatus: 'local' }));
  return next;
}

function outboxRecord(command, context, localSequence) {
  const createdAt = iso(command.clientCreatedAt || new Date());
  return {
    operationId: command.operationId,
    entityId: command.entityId,
    entityType: command.entityType,
    operationType: command.operationType,
    tenantId: context.tenantId,
    restaurantId: context.tenantId,
    locationId: command.locationId ?? context.locationId ?? null,
    deviceId: context.deviceId,
    userId: context.userId,
    operatorId: context.operatorId || null,
    operatorSessionId: context.operatorSessionId || null,
    payload: command.payload,
    localSequence,
    dependencyIds: command.dependencyIds || [],
    createdAt,
    updatedAt: createdAt,
    retryCount: 0,
    nextRetryAt: createdAt,
    lastError: null,
    status: OUTBOX_STATUS.PENDING,
    appVersion: context.appVersion || 'web',
    localSchemaVersion: OFFLINE_SCHEMA_VERSION,
    deviceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    clientTimestamp: createdAt,
    offlineAccessToken: context.offlineAccessToken || null,
    operatingMode: context.operatingMode || null,
    emergencyEpoch: Number.isSafeInteger(context.emergencyEpoch) ? context.emergencyEpoch : null,
  };
}

function auditRecord(context, action, entityType, entityId, metadata = null) {
  const createdAt = iso();
  return stampLocalRecord({
    id: createGlobalId(),
    action,
    entityType,
    entityId,
    userId: context.userId,
    metadata,
    createdAt,
  }, context, { syncStatus: 'local' });
}

export async function ensureDeviceIdentity(tenantId, userId, options = {}) {
  const db = await getTenantDatabase(tenantId);
  const key = `${tenantId}:primary`;
  return db.transaction('rw', db.deviceIdentity, async () => {
    const existing = await db.deviceIdentity.get(key);
    if (existing) return existing;
    const deviceId = createGlobalId();
    const now = iso();
    const device = {
      id: key,
      tenantId,
      restaurantId: tenantId,
      locationId: options.locationId || null,
      deviceId,
      userId,
      name: options.name || `Browser ${deviceId.slice(0, 8)}`,
      platform: typeof navigator !== 'undefined' ? navigator.platform || 'browser' : 'browser',
      deviceType: options.deviceType || 'POS',
      isPrimaryPos: false,
      emergencyEpoch: 0,
      createdAt: now,
      updatedAt: now,
      localVersion: 1,
      serverVersion: null,
      syncStatus: OUTBOX_STATUS.PENDING,
    };
    await db.deviceIdentity.put(device);
    return device;
  });
}

export async function saveDeviceSyncConfiguration(tenantId, configuration = {}) {
  const db = await getTenantDatabase(tenantId);
  const key = `${tenantId}:primary`;
  return db.transaction('rw', db.deviceIdentity, async () => {
    const current = await db.deviceIdentity.get(key);
    if (!current) throw new Error('Device identity is not initialized');
    const updated = {
      ...current,
      locationId: configuration.locationId || current.locationId || null,
      edgeAccessToken: configuration.edgeAccessToken || current.edgeAccessToken || null,
      edge: configuration.edge === undefined ? current.edge || null : configuration.edge,
      name: configuration.name || current.name,
      deviceType: configuration.deviceType || current.deviceType || 'POS',
      isPrimaryPos: configuration.isPrimaryPos === undefined ? Boolean(current.isPrimaryPos) : Boolean(configuration.isPrimaryPos),
      emergencyEpoch: Number(configuration.emergencyEpoch ?? current.emergencyEpoch ?? 0),
      capabilities: configuration.capabilities === undefined ? current.capabilities || null : configuration.capabilities,
      updatedAt: iso(),
    };
    await db.deviceIdentity.put(updated);
    return updated;
  });
}

function flattenBootstrap(bootstrap, context) {
  const locationId = context.locationId || bootstrap.locations?.find((item) => item.isPrimary)?.id || bootstrap.locations?.[0]?.id || null;
  const cacheContext = { ...context, locationId };
  const menuCategories = bootstrap.menu?.categories || [];
  const menuItems = menuCategories.flatMap((category) => category.menuItems || []).concat(bootstrap.menu?.uncategorized || []);
  const modifiers = menuItems.flatMap((item) => (item.modifierGroups || []).flatMap((group) =>
    (group.modifiers || []).map((modifier) => ({
      ...modifier,
      menuItemId: item.id,
      modifierGroupId: group.id,
      groupName: group.name,
    }))
  ));
  const orders = (bootstrap.activeOrders || []).map((item) => stampLocalRecord({
    ...item,
    fulfilmentStatus: item.status,
    paymentState: item.paymentStatus,
    locationId: item.branchId || cacheContext.locationId,
  }, cacheContext, { syncStatus: 'synchronized', serverVersion: item.stateVersion || 1 }));
  const orderItems = orders.flatMap((order) => (order.items || []).map((item) => stampLocalRecord(item, cacheContext, {
    syncStatus: 'synchronized', serverVersion: 1,
  })));
  return {
    cacheContext,
    restaurant: stampLocalRecord({
      ...bootstrap.restaurant,
      id: bootstrap.restaurant.id,
      offlineAccessToken: bootstrap.offlineAccessToken,
      offlineAccess: bootstrap.offlineAccess,
      entitlementSnapshot: bootstrap.entitlements,
      bootstrapVersion: bootstrap.version,
    }, cacheContext, { syncStatus: 'synchronized', serverVersion: bootstrap.version || 1 }),
    locations: (bootstrap.locations || []).map((item) => stampLocalRecord(item, cacheContext, { syncStatus: 'synchronized' })),
    tables: (bootstrap.tables || []).map((item) => stampLocalRecord(item, cacheContext, { syncStatus: 'synchronized' })),
    categories: menuCategories.map(({ menuItems: _items, ...category }) => stampLocalRecord(category, cacheContext, { syncStatus: 'synchronized' })),
    menuItems: menuItems.map((item) => stampLocalRecord(item, cacheContext, { syncStatus: 'synchronized' })),
    modifiers: modifiers.map((item) => stampLocalRecord(item, cacheContext, { syncStatus: 'synchronized' })),
    recipes: (bootstrap.recipes || []).map((item) => stampLocalRecord(item, cacheContext, { syncStatus: 'synchronized' })),
    inventory: (bootstrap.inventory || []).map((item) => stampLocalRecord(item, { ...cacheContext, locationId: item.locationId }, { syncStatus: 'synchronized' })),
    suppliers: (bootstrap.suppliers || []).map((item) => stampLocalRecord(item, cacheContext, { syncStatus: 'synchronized' })),
    purchaseOrders: (bootstrap.purchaseOrders || []).map((item) => stampLocalRecord(item, { ...cacheContext, locationId: item.locationId }, { syncStatus: 'synchronized' })),
    orders,
    orderItems,
  };
}

export async function cacheBootstrap(bootstrap, context) {
  const db = await getTenantDatabase(context.tenantId);
  const data = flattenBootstrap(bootstrap, context);
  const orderItemsByOrder = new Map();
  for (const item of data.orderItems) {
    const group = orderItemsByOrder.get(item.orderId) || [];
    group.push(item);
    orderItemsByOrder.set(item.orderId, group);
  }
  await db.transaction('rw', [
    db.cachedRestaurant, db.cachedLocations, db.cachedTables, db.menuCategories,
    db.menuItems, db.modifiers, db.recipes, db.inventorySnapshots, db.cachedSuppliers, db.cachedPurchaseOrders,
    db.orders, db.orderItems, db.kitchenTickets, db.syncCheckpoints, db.localAuditEvents,
    db.cachedRiders,
  ], async () => {
    await db.cachedRestaurant.put(data.restaurant);
    await Promise.all([
      db.cachedLocations.bulkPut(data.locations),
      db.cachedTables.bulkPut(data.tables),
      db.menuCategories.bulkPut(data.categories),
      db.menuItems.bulkPut(data.menuItems),
      db.modifiers.bulkPut(data.modifiers),
      db.recipes.bulkPut(data.recipes),
      db.cachedSuppliers.bulkPut(data.suppliers),
      // Replaced wholesale rather than merged: a rider who has left should
      // disappear from the till, not linger because nothing overwrote them.
      db.cachedRiders.clear().then(() => db.cachedRiders.bulkPut(data.deliveryRiders || [])),
    ]);
    for (const inventoryItem of data.inventory) {
      const existing = await db.inventorySnapshots.get(inventoryItem.id);
      if (existing?.syncStatus && existing.syncStatus !== 'synchronized') continue;
      await db.inventorySnapshots.put(inventoryItem);
    }
    for (const purchaseOrder of data.purchaseOrders) {
      const existing = await db.cachedPurchaseOrders.get(purchaseOrder.id);
      if (existing?.syncStatus && existing.syncStatus !== 'synchronized') continue;
      await db.cachedPurchaseOrders.put(purchaseOrder);
    }
    for (const order of data.orders) {
      const existing = await db.orders.get(order.id);
      if (existing?.syncStatus && existing.syncStatus !== 'synchronized') continue;
      await db.orders.put(order);
      await db.orderItems.bulkPut(orderItemsByOrder.get(order.id) || []);
      await db.kitchenTickets.put(stampLocalRecord({
        id: order.id, orderId: order.id, status: order.fulfilmentStatus, sentAt: order.createdAt,
      }, data.cacheContext, { syncStatus: 'synchronized', serverVersion: order.serverVersion }));
    }
    const checkpointId = `${context.tenantId}:${context.deviceId}`;
    const current = await db.syncCheckpoints.get(checkpointId);
    await db.syncCheckpoints.put(stampLocalRecord({
      id: checkpointId,
      deviceId: context.deviceId,
      lastLocalSequence: current?.lastLocalSequence || 0,
      lastServerCheckpoint: bootstrap.checkpoint || null,
      lastSuccessfulSyncAt: iso(),
    }, context, { syncStatus: 'synchronized' }));
    await db.localAuditEvents.put(auditRecord(context, 'OFFLINE_BOOTSTRAP_CACHED', 'Restaurant', context.tenantId, {
      version: bootstrap.version,
    }));
  });
  return data;
}

export async function getCachedBootstrap(tenantId) {
  const db = await getTenantDatabase(tenantId);
  const restaurant = await db.cachedRestaurant.get(tenantId);
  if (!restaurant) return null;
  const [locations, tables, categories, menuItems, recipes, inventory, suppliers, purchaseOrders] = await Promise.all([
    db.cachedLocations.where('tenantId').equals(tenantId).toArray(),
    db.cachedTables.where('tenantId').equals(tenantId).toArray(),
    db.menuCategories.where('tenantId').equals(tenantId).sortBy('sortOrder'),
    db.menuItems.where('tenantId').equals(tenantId).toArray(),
    db.recipes.where('tenantId').equals(tenantId).toArray(),
    db.inventorySnapshots.where('tenantId').equals(tenantId).toArray(),
    db.cachedSuppliers.where('tenantId').equals(tenantId).toArray(),
    db.cachedPurchaseOrders.where('tenantId').equals(tenantId).toArray(),
  ]);
  return { restaurant, locations, tables, categories, menuItems, recipes, inventory, suppliers, purchaseOrders };
}

export async function setOfflineVaultLocked(tenantId, locked, metadata = {}) {
  const db = await getTenantDatabase(tenantId);
  const id = `${tenantId}:offline-vault-state`;
  await db.metadata.put({
    id,
    tenantId,
    restaurantId: tenantId,
    locked: Boolean(locked),
    reason: metadata.reason || null,
    userId: metadata.userId || null,
    updatedAt: iso(),
    syncStatus: 'local',
  });
}

export function readOfflineTokenClaims(token) {
  try {
    const segment = String(token || '').split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(base64).split('').map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function decodeBase64UrlBytes(value) {
  const source = String(value || '');
  const base64 = source.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(source.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function configuredOfflinePublicKey() {
  return String(process.env.NEXT_PUBLIC_OFFLINE_ACCESS_PUBLIC_KEY || '').trim().replace(/\\n/g, '\n');
}

export async function verifyOfflineAccessToken(token, { tenantId = null, at = Date.now() } = {}) {
  const segments = String(token || '').split('.');
  if (segments.length !== 3) return { valid: false, claims: null, reason: 'malformed' };
  const claims = readOfflineTokenClaims(token);
  if (!claims || (tenantId && claims.restaurantId !== tenantId)
    || Number(claims.exp || 0) * 1000 <= at) {
    return { valid: false, claims, reason: 'claims' };
  }
  if (Number(claims.authorityPolicyVersion || 0) < 1) {
    return { valid: true, trustedAuthority: false, claims, reason: 'legacy' };
  }
  if (claims.type !== 'offline-access' || claims.iss !== 'dine3d-offline'
    || (claims.aud !== 'dine3d-sync' && !(Array.isArray(claims.aud) && claims.aud.includes('dine3d-sync')))) {
    return { valid: false, claims, reason: 'claims' };
  }
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(segments[0])));
  } catch {
    return { valid: false, claims: null, reason: 'malformed' };
  }
  const publicKeyPem = configuredOfflinePublicKey();
  if (header.alg !== 'RS256' || !publicKeyPem || !globalThis.crypto?.subtle) {
    return { valid: false, claims, reason: 'verification-key-unavailable' };
  }
  try {
    const der = decodeBase64UrlBytes(publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ''));
    const key = await globalThis.crypto.subtle.importKey(
      'spki',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await globalThis.crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeBase64UrlBytes(segments[2]),
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
    return { valid, trustedAuthority: valid, claims, reason: valid ? null : 'signature' };
  } catch {
    return { valid: false, claims, reason: 'verification-failed' };
  }
}

export async function getValidOfflineAccess(tenantId, at = Date.now()) {
  const db = await getTenantDatabase(tenantId);
  const vault = await db.metadata.get(`${tenantId}:offline-vault-state`);
  if (vault?.locked) return null;
  const cached = await getCachedBootstrap(tenantId);
  const token = cached?.restaurant?.offlineAccessToken;
  if (!cached || !token) return null;
  const verification = await verifyOfflineAccessToken(token, { tenantId, at });
  if (!verification.valid) return null;
  return { ...cached, claims: verification.claims, token, trustedAuthority: verification.trustedAuthority === true };
}

export async function enqueueOrder(context, draft) {
  if (!Array.isArray(draft?.items) || draft.items.length === 0) {
    throw new Error('An offline order must contain at least one item');
  }
  for (const item of draft.items) {
    if (!item.menuItemId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
      throw new Error('Offline order items require a menu item and positive whole-number quantity');
    }
  }
  const db = await getTenantDatabase(context.tenantId);
  const operationId = draft.operationId || createGlobalId();
  const orderId = draft.id || createGlobalId();
  const createdAt = iso(draft.localCreatedAt || new Date());
  let payment = null;
  let order;

  await db.transaction('rw', [db.orders, db.orderItems, db.kitchenTickets, db.payments, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents], async () => {
    const localSequence = await nextSequence(db, context);
    const localReference = draft.localReference || `LOCAL-${context.deviceId.slice(0, 6).toUpperCase()}-${String(localSequence).padStart(5, '0')}`;
    order = stampLocalRecord({
      ...draft,
      id: orderId,
      localReference,
      orderNumber: draft.orderNumber || localReference,
      fulfilmentStatus: draft.fulfilmentStatus || 'CONFIRMED',
      paymentState: draft.paymentState || (draft.cashPayment ? 'PAID' : 'UNPAID'),
      localCreatedAt: createdAt,
      offlineOrigin: true,
      stateVersion: 1,
    }, context);
    const items = (draft.items || []).map((item) => stampLocalRecord({
      ...item,
      id: item.id || createGlobalId(),
      orderId,
    }, context));
    order.items = items;
    await db.orders.put(order);
    await db.orderItems.bulkPut(items);
    await db.kitchenTickets.put(stampLocalRecord({
      id: createGlobalId(), orderId, status: order.fulfilmentStatus, sentAt: createdAt,
    }, context));

    if (draft.cashPayment) {
      payment = stampLocalRecord({
        ...draft.cashPayment,
        id: draft.cashPayment.id || createGlobalId(),
        orderId,
        method: 'CASH',
        status: 'completed',
        offlineOrigin: true,
        localCreatedAt: createdAt,
      }, context);
      await db.payments.put(payment);
    }

    const payload = {
      order: { ...order, items },
      cashPayment: payment,
      catalogSnapshotId: draft.catalogSnapshotId || null,
    };
    await db.syncOutbox.add(outboxRecord({
      operationId,
      entityId: orderId,
      entityType: 'Order',
      operationType: 'ORDER_CREATE',
      payload,
    }, context, localSequence));
    await db.localAuditEvents.put(auditRecord(context, 'ORDER_SAVED_ON_DEVICE', 'Order', orderId, { operationId }));
  });

  return { order, payment, operationId };
}

export async function enqueueOrderTransition(context, orderId, toStatus, options = {}) {
  const db = await getTenantDatabase(context.tenantId);
  const operationId = options.operationId || createGlobalId();
  await db.transaction('rw', [db.orders, db.kitchenTickets, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents], async () => {
    const order = await db.orders.get(orderId);
    if (!order || order.tenantId !== context.tenantId) throw new Error('Local order not found');
    const baseVersion = Number(order.expectedServerVersion || order.serverVersion || order.stateVersion || 1);
    const localVersion = Number(order.localVersion || 1) + 1;
    await db.orders.update(orderId, {
      fulfilmentStatus: toStatus,
      localVersion,
      expectedServerVersion: baseVersion + 1,
      updatedAt: iso(),
      syncStatus: OUTBOX_STATUS.PENDING,
    });
    const tickets = await db.kitchenTickets.where('orderId').equals(orderId).toArray();
    await Promise.all(tickets.map((ticket) => db.kitchenTickets.update(ticket.id, {
      status: toStatus, localVersion: Number(ticket.localVersion || 1) + 1, updatedAt: iso(), syncStatus: OUTBOX_STATUS.PENDING,
    })));
    const sequence = await nextSequence(db, context);
    const priorOperations = await db.syncOutbox.where('entityId').equals(orderId)
      .filter((entry) => entry.status !== OUTBOX_STATUS.ACKNOWLEDGED)
      .sortBy('localSequence');
    const priorOperation = priorOperations.at(-1);
    await db.syncOutbox.add(outboxRecord({
      operationId,
      entityId: orderId,
      entityType: 'Order',
      operationType: 'ORDER_TRANSITION',
      dependencyIds: priorOperation ? [priorOperation.operationId] : [],
      payload: { orderId, toStatus, reason: options.reason || null, baseVersion },
    }, context, sequence));
    await db.localAuditEvents.put(auditRecord(context, 'ORDER_TRANSITION_SAVED_ON_DEVICE', 'Order', orderId, { toStatus, operationId }));
  });
  return { operationId };
}

export async function enqueueCashPayment(context, orderId, paymentDraft) {
  if (!Number.isFinite(Number(paymentDraft?.amount)) || Number(paymentDraft.amount) <= 0) {
    throw new Error('Cash payment amount must be greater than zero');
  }
  const db = await getTenantDatabase(context.tenantId);
  const operationId = paymentDraft.operationId || createGlobalId();
  const paymentId = paymentDraft.id || createGlobalId();
  let payment;
  await db.transaction('rw', [db.orders, db.payments, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents], async () => {
    const order = await db.orders.get(orderId);
    if (!order || order.tenantId !== context.tenantId) throw new Error('Local order not found');
    payment = stampLocalRecord({
      ...paymentDraft,
      id: paymentId,
      orderId,
      method: 'CASH',
      status: 'completed',
      offlineOrigin: true,
      localCreatedAt: paymentDraft.localCreatedAt || iso(),
    }, context);
    await db.payments.put(payment);
    await db.orders.update(orderId, {
      paymentState: 'PAID',
      paymentStatus: 'PAID',
      syncStatus: OUTBOX_STATUS.PENDING,
      localVersion: Number(order.localVersion || 1) + 1,
      updatedAt: iso(),
    });
    const sequence = await nextSequence(db, context);
    const createOperation = await db.syncOutbox.where('entityId').equals(orderId).filter((entry) => entry.operationType === 'ORDER_CREATE').first();
    await db.syncOutbox.add(outboxRecord({
      operationId,
      entityId: paymentId,
      entityType: 'Payment',
      operationType: 'CASH_PAYMENT',
      dependencyIds: createOperation && createOperation.status !== OUTBOX_STATUS.ACKNOWLEDGED ? [createOperation.operationId] : [],
      payload: { payment },
    }, context, sequence));
    await db.localAuditEvents.put(auditRecord(context, 'CASH_PAYMENT_SAVED_ON_DEVICE', 'Payment', paymentId, { orderId, operationId }));
  });
  return { operationId, payment };
}

/** Riders this device knows about, for the till's selector with no internet. */
export async function getCachedRiders(tenantId, branchId = null) {
  const db = await getTenantDatabase(tenantId);
  const riders = await db.cachedRiders.toArray();
  return riders
    .filter((rider) => rider.isActive !== false && rider.isAvailable !== false)
    .filter((rider) => !branchId || !rider.branchId || rider.branchId === branchId);
}

/**
 * Name the rider for a delivery taken while the connection was down.
 *
 * Queued behind the order that created it: replaying an assignment for an order
 * the server has not seen yet would be refused, and would then look like a
 * permanent failure rather than a matter of ordering.
 */
export async function enqueueDeliveryAssignment(context, { orderId, riderId, deliveryFee = 0, notes = null, branchId = null }) {
  if (!orderId || !riderId) throw new Error('A delivery assignment needs an order and a rider');
  const db = await getTenantDatabase(context.tenantId);
  const operationId = createGlobalId();

  await db.transaction('rw', [db.orders, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents], async () => {
    const order = await db.orders.get(orderId);
    if (!order || order.tenantId !== context.tenantId) throw new Error('Local order not found');

    const sequence = await nextSequence(db, context);
    const createOperation = await db.syncOutbox
      .where('entityId').equals(orderId)
      .filter((entry) => entry.operationType === 'ORDER_CREATE')
      .first();

    await db.syncOutbox.add(outboxRecord({
      operationId,
      entityId: orderId,
      entityType: 'DeliveryAssignment',
      operationType: 'DELIVERY_ASSIGN',
      dependencyIds: createOperation && createOperation.status !== OUTBOX_STATUS.ACKNOWLEDGED
        ? [createOperation.operationId]
        : [],
      payload: { orderId, riderId, deliveryFee, notes, branchId: branchId || context.locationId || null },
    }, context, sequence));

    await db.localAuditEvents.put(
      auditRecord(context, 'DELIVERY_ASSIGNED_ON_DEVICE', 'DeliveryAssignment', orderId, { riderId, operationId }),
    );
  });

  return { operationId };
}

export async function cacheServerOrders(context, orders) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  const db = await getTenantDatabase(context.tenantId);
  await db.transaction('rw', [db.orders, db.orderItems, db.kitchenTickets], async () => {
    for (const source of orders) {
      if (!source?.id || source.restaurantId !== context.tenantId) continue;
      const current = await db.orders.get(source.id);
      if (current?.syncStatus && current.syncStatus !== 'synchronized') continue;
      const order = stampLocalRecord({
        ...source,
        fulfilmentStatus: source.status,
        paymentState: source.paymentStatus,
        locationId: source.branchId || context.locationId,
      }, context, { syncStatus: 'synchronized', serverVersion: source.stateVersion || 1 });
      const items = (source.items || []).map((item) => stampLocalRecord(item, context, {
        syncStatus: 'synchronized', serverVersion: 1,
      }));
      await db.orders.put(order);
      await db.orderItems.bulkPut(items);
      await db.kitchenTickets.put(stampLocalRecord({
        id: source.id,
        orderId: source.id,
        status: source.status,
        sentAt: source.createdAt,
      }, context, { syncStatus: 'synchronized', serverVersion: source.stateVersion || 1 }));
    }
  });
}

export async function applyEdgeOrderProjection(context, orders) {
  if (!Array.isArray(orders) || orders.length === 0) return [];
  const db = await getTenantDatabase(context.tenantId);
  const accepted = [];
  await db.transaction('rw', [db.orders, db.orderItems, db.kitchenTickets], async () => {
    for (const source of orders) {
      if (!source?.id || source.restaurantId !== context.tenantId
        || source.locationId !== context.locationId) continue;
      const current = await db.orders.get(source.id);
      if (Number(source.edgeRevision || 0) < Number(current?.edgeRevision || 0)) continue;
      const preserveOwnPending = current?.deviceId === context.deviceId
        && current.syncStatus !== 'synchronized';
      const order = stampLocalRecord({
        ...current,
        ...source,
        fulfilmentStatus: source.status,
        paymentState: source.paymentStatus,
        edgeRevision: Number(source.edgeRevision || 0),
        edgeUpdatedAt: source.edgeUpdatedAt,
        edgePending: Boolean(source.cloudPending),
      }, context, {
        syncStatus: preserveOwnPending ? current.syncStatus : 'synchronized',
        serverVersion: current?.serverVersion ?? null,
      });
      const items = (source.items || []).map((item) => stampLocalRecord({
        ...item,
        orderId: source.id,
      }, context, { syncStatus: 'synchronized', serverVersion: 1 }));
      order.items = items;
      await db.orders.put(order);
      if (items.length) await db.orderItems.bulkPut(items);
      const ticket = await db.kitchenTickets.where('orderId').equals(source.id).first();
      if (ticket) {
        await db.kitchenTickets.update(ticket.id, {
          status: source.status,
          edgeRevision: Number(source.edgeRevision || 0),
          edgePending: Boolean(source.cloudPending),
          updatedAt: iso(),
        });
      } else {
        await db.kitchenTickets.put(stampLocalRecord({
          id: `edge:${source.id}`,
          orderId: source.id,
          status: source.status,
          sentAt: source.createdAt,
          edgeRevision: Number(source.edgeRevision || 0),
          edgePending: Boolean(source.cloudPending),
        }, context, { syncStatus: 'synchronized', serverVersion: source.stateVersion || 1 }));
      }
      accepted.push(order);
    }
  });
  return accepted;
}

export async function applyEdgeInventoryProjection(context, movements) {
  if (!Array.isArray(movements) || movements.length === 0) return [];
  const db = await getTenantDatabase(context.tenantId);
  const accepted = [];
  await db.transaction('rw', [
    db.inventoryMovements, db.inventorySnapshots, db.stockAdjustments,
    db.wastage, db.localAuditEvents,
  ], async () => {
    for (const source of movements) {
      if (!source?.id || !source.operationId || source.restaurantId !== context.tenantId
        || source.locationId !== context.locationId || !source.inventoryItemId) continue;
      const existing = await db.inventoryMovements.get(source.id);
      if (existing) {
        if (Number(source.edgeRevision || 0) > Number(existing.edgeRevision || 0)) {
          await db.inventoryMovements.update(existing.id, {
            edgeRevision: Number(source.edgeRevision || 0),
            edgePending: Boolean(source.cloudPending),
            cloudStatus: source.cloudStatus || null,
            updatedAt: iso(),
          });
        }
        continue;
      }
      const quantityChange = Number(source.quantityChange);
      if (!Number.isFinite(quantityChange) || quantityChange === 0) continue;
      const record = stampLocalRecord({
        ...source,
        quantityChange,
        edgeRevision: Number(source.edgeRevision || 0),
        edgePending: Boolean(source.cloudPending),
      }, context, { syncStatus: 'synchronized', serverVersion: null });
      await db.inventoryMovements.put(record);
      if (source.changeType === 'WASTE') await db.wastage.put(record);
      else if (source.changeType !== 'PURCHASE_RECEIPT') await db.stockAdjustments.put(record);

      const snapshot = await db.inventorySnapshots.get(source.inventoryItemId);
      if (snapshot && snapshot.tenantId === context.tenantId
        && (!snapshot.locationId || snapshot.locationId === context.locationId)) {
        await db.inventorySnapshots.update(snapshot.id, {
          currentStock: Number(snapshot.currentStock || 0) + quantityChange,
          estimated: true,
          edgeRevision: Math.max(Number(snapshot.edgeRevision || 0), Number(source.edgeRevision || 0)),
          edgePending: Boolean(source.cloudPending),
          updatedAt: iso(),
        });
      }
      await db.localAuditEvents.put(auditRecord(
        context,
        'EDGE_INVENTORY_MOVEMENT_APPLIED',
        'InventoryMovement',
        source.id,
        { operationId: source.operationId, edgeRevision: source.edgeRevision },
      ));
      accepted.push(record);
    }
  });
  return accepted;
}

export async function enqueueInventoryAdjustment(context, adjustment) {
  if (String(adjustment?.reason || '').trim().length < 3) {
    throw new Error('A specific reason is required for every inventory movement');
  }
  const db = await getTenantDatabase(context.tenantId);
  const operationId = adjustment.operationId || createGlobalId();
  const movementId = adjustment.id || createGlobalId();
  await db.transaction('rw', [db.inventoryMovements, db.stockAdjustments, db.wastage, db.inventorySnapshots, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents], async () => {
    const snapshot = await db.inventorySnapshots.get(adjustment.inventoryItemId);
    if (!snapshot || snapshot.tenantId !== context.tenantId) throw new Error('Inventory item is not cached on this device');
    const quantityChange = Number(adjustment.quantityChange);
    if (!Number.isFinite(quantityChange) || quantityChange === 0) throw new Error('A non-zero stock movement is required');
    const estimated = Number(snapshot.currentStock || 0) + quantityChange;
    const record = stampLocalRecord({
      ...adjustment,
      id: movementId,
      inventoryItemId: adjustment.inventoryItemId,
      businessTimestamp: adjustment.businessTimestamp || iso(),
      quantityChange,
      estimatedStockAfter: estimated,
      operationId,
    }, context);
    await db.inventoryMovements.put(record);
    const detailTable = adjustment.changeType === 'WASTE' ? db.wastage : db.stockAdjustments;
    await detailTable.put(record);
    await db.inventorySnapshots.update(snapshot.id, {
      currentStock: estimated,
      estimated: true,
      localVersion: Number(snapshot.localVersion || 1) + 1,
      syncStatus: OUTBOX_STATUS.PENDING,
      updatedAt: iso(),
    });
    const sequence = await nextSequence(db, context);
    await db.syncOutbox.add(outboxRecord({
      operationId,
      entityId: movementId,
      entityType: 'InventoryMovement',
      operationType: 'INVENTORY_ADJUSTMENT',
      payload: { ...record, baseVersion: Number(snapshot.serverVersion || snapshot.stateVersion || 1) },
    }, context, sequence));
    await db.localAuditEvents.put(auditRecord(context, 'INVENTORY_MOVEMENT_SAVED_ON_DEVICE', 'InventoryMovement', movementId, { operationId }));
  });
  return { operationId, movementId };
}

export async function enqueuePurchaseReceipt(context, receiptDraft) {
  const db = await getTenantDatabase(context.tenantId);
  const operationId = receiptDraft.operationId || createGlobalId();
  const receiptId = receiptDraft.id || createGlobalId();
  let receipt;
  await db.transaction('rw', [
    db.cachedPurchaseOrders, db.purchaseReceipts, db.inventoryMovements,
    db.inventorySnapshots, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents,
  ], async () => {
    const purchaseOrder = await db.cachedPurchaseOrders.get(receiptDraft.purchaseOrderId);
    if (!purchaseOrder || purchaseOrder.tenantId !== context.tenantId) throw new Error('Purchase order is not cached on this device');
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(purchaseOrder.status)) throw new Error('This purchase order is not open for receiving');
    const businessTimestamp = receiptDraft.businessTimestamp || iso();
    const items = [];
    for (const source of receiptDraft.items || []) {
      const poItem = (purchaseOrder.items || []).find((item) => item.id === source.purchaseOrderItemId);
      if (!poItem) throw new Error('Purchase receipt contains an unknown line');
      const acceptedQty = Number(source.acceptedQty ?? source.receivedQty);
      if (!Number.isFinite(acceptedQty) || acceptedQty < 0) throw new Error('Accepted quantity is invalid');
      const line = { ...source, movementId: source.movementId || createGlobalId() };
      items.push(line);
      if (acceptedQty > 0) {
        const snapshot = await db.inventorySnapshots.get(poItem.ingredientId);
        if (snapshot) {
          const estimated = Number(snapshot.currentStock || 0) + acceptedQty;
          await db.inventorySnapshots.update(snapshot.id, {
            currentStock: estimated,
            estimated: true,
            syncStatus: OUTBOX_STATUS.PENDING,
            localVersion: Number(snapshot.localVersion || 1) + 1,
            updatedAt: iso(),
          });
          await db.inventoryMovements.put(stampLocalRecord({
            id: line.movementId,
            inventoryItemId: poItem.ingredientId,
            purchaseOrderId: purchaseOrder.id,
            quantityChange: acceptedQty,
            changeType: 'PURCHASE_RECEIPT',
            direction: 'IN',
            businessTimestamp,
            estimatedStockAfter: estimated,
            operationId,
          }, context));
        }
      }
    }
    const updatedPoItems = (purchaseOrder.items || []).map((item) => {
      const received = items.find((line) => line.purchaseOrderItemId === item.id);
      return received
        ? { ...item, receivedQuantity: Number(item.receivedQuantity || 0) + Number(received.receivedQty || 0), acceptedQuantity: Number(item.acceptedQuantity || 0) + Number(received.acceptedQty ?? received.receivedQty ?? 0) }
        : item;
    });
    const fullyReceived = updatedPoItems.every((item) => Number(item.receivedQuantity || 0) >= Number(item.quantity || 0));
    await db.cachedPurchaseOrders.update(purchaseOrder.id, {
      items: updatedPoItems,
      status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      estimated: true,
      syncStatus: OUTBOX_STATUS.PENDING,
      localVersion: Number(purchaseOrder.localVersion || 1) + 1,
      updatedAt: iso(),
    });
    receipt = stampLocalRecord({
      ...receiptDraft,
      id: receiptId,
      items,
      operationId,
      businessTimestamp,
    }, context);
    await db.purchaseReceipts.put(receipt);
    const sequence = await nextSequence(db, context);
    await db.syncOutbox.add(outboxRecord({
      operationId,
      entityId: receiptId,
      entityType: 'PurchaseReceipt',
      operationType: 'PURCHASE_RECEIPT',
      payload: { receipt },
    }, context, sequence));
    await db.localAuditEvents.put(auditRecord(context, 'PURCHASE_RECEIPT_SAVED_ON_DEVICE', 'PurchaseReceipt', receiptId, { operationId }));
  });
  return { operationId, receipt };
}

export async function enqueueOperationalNote(context, body) {
  const text = String(body || '').trim();
  if (!text || text.length > 2000) throw new Error('Operational note must contain 1–2000 characters');
  const db = await getTenantDatabase(context.tenantId);
  const id = createGlobalId();
  const operationId = createGlobalId();
  await db.transaction('rw', [db.operationalNotes, db.syncOutbox, db.syncCheckpoints, db.localAuditEvents], async () => {
    const note = stampLocalRecord({ id, body: text, businessTimestamp: iso(), operationId }, context);
    await db.operationalNotes.put(note);
    const sequence = await nextSequence(db, context);
    await db.syncOutbox.add(outboxRecord({
      operationId, entityId: id, entityType: 'OperationalNote', operationType: 'OPERATIONAL_NOTE', payload: note,
    }, context, sequence));
    await db.localAuditEvents.put(auditRecord(context, 'OPERATIONAL_NOTE_SAVED_ON_DEVICE', 'OperationalNote', id, { operationId }));
  });
  return { id, operationId };
}

export async function countPendingOperations(tenantId) {
  const db = await getTenantDatabase(tenantId);
  const outstanding = [
    ...ACTIVE_OUTBOX_STATUSES,
    OUTBOX_STATUS.PERMANENTLY_FAILED,
    OUTBOX_STATUS.CONFLICT,
  ];
  return db.syncOutbox
    .where('[tenantId+status]')
    .anyOf(outstanding.map((status) => [tenantId, status]))
    .count();
}

export async function getSyncDiagnostics(tenantId) {
  const db = await getTenantDatabase(tenantId);
  const [outbox, conflicts, devices, checkpoints] = await Promise.all([
    db.syncOutbox.where('tenantId').equals(tenantId).sortBy('createdAt'),
    db.syncConflicts.where('tenantId').equals(tenantId).sortBy('createdAt'),
    db.deviceIdentity.where('tenantId').equals(tenantId).toArray(),
    db.syncCheckpoints.where('tenantId').equals(tenantId).toArray(),
  ]);
  return { outbox, conflicts, devices, checkpoints };
}

export async function applyConflictResolution(tenantId, resolutionResult) {
  const db = await getTenantDatabase(tenantId);
  const now = iso();
  await db.transaction('rw', [db.syncConflicts, db.syncOutbox, db.orders], async () => {
    const conflict = await db.syncConflicts.get(resolutionResult.conflictId);
    if (!conflict) throw new Error('Local conflict record not found');
    await db.syncConflicts.update(conflict.id, {
      status: 'resolved',
      resolution: resolutionResult.resolution,
      resolvedAt: now,
      updatedAt: now,
    });
    await db.syncOutbox.update(conflict.operationId, {
      status: OUTBOX_STATUS.ACKNOWLEDGED,
      acknowledgedAt: now,
      result: { conflictResolution: resolutionResult.resolution, order: resolutionResult.order || null },
      lastError: null,
      updatedAt: now,
    });
    if (resolutionResult.order?.id) {
      await db.orders.update(resolutionResult.order.id, {
        fulfilmentStatus: resolutionResult.order.status,
        paymentState: resolutionResult.order.paymentStatus,
        stateVersion: resolutionResult.order.stateVersion,
        serverVersion: resolutionResult.order.stateVersion,
        expectedServerVersion: resolutionResult.order.stateVersion,
        syncStatus: 'synchronized',
        updatedAt: now,
      });
    } else if (conflict.entityType === 'Order' && conflict.serverValue?.id) {
      await db.orders.update(conflict.entityId, {
        ...conflict.serverValue,
        fulfilmentStatus: conflict.serverValue.status || conflict.serverValue.fulfilmentStatus,
        serverVersion: conflict.serverVersion,
        expectedServerVersion: conflict.serverVersion,
        syncStatus: 'synchronized',
        updatedAt: now,
      });
    }
  });
}

export async function getLocalActiveOrders(tenantId) {
  const db = await getTenantDatabase(tenantId);
  const activeStatuses = ['CREATED', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'DELIVERED', 'PICKED_UP'];
  const orders = (await db.orders.where('fulfilmentStatus').anyOf(activeStatuses).toArray())
    .filter((order) => order.tenantId === tenantId);
  const orderIds = orders.map((order) => order.id);
  const itemGroups = new Map();
  const items = orderIds.length > 0
    ? (await db.orderItems.where('orderId').anyOf(orderIds).toArray()).filter((item) => item.tenantId === tenantId)
    : [];
  items.forEach((item) => itemGroups.set(item.orderId, [...(itemGroups.get(item.orderId) || []), item]));
  return orders.map((order) => ({
    ...order,
    status: order.fulfilmentStatus || order.status,
    paymentStatus: order.paymentState || order.paymentStatus,
    branchId: order.locationId || order.branchId,
    source: 'POS',
    items: itemGroups.get(order.id) || order.items || [],
    offlinePending: order.syncStatus !== 'synchronized' || Boolean(order.edgePending),
  }));
}

export async function savePosDraft(context, draft) {
  const db = await getTenantDatabase(context.tenantId);
  await db.metadata.put(stampLocalRecord({
    id: `${context.tenantId}:pos-draft`,
    type: 'POS_DRAFT',
    value: draft,
  }, context, { syncStatus: 'local' }));
}

export async function loadPosDraft(tenantId) {
  const db = await getTenantDatabase(tenantId);
  return (await db.metadata.get(`${tenantId}:pos-draft`))?.value || null;
}

export async function clearPosDraft(tenantId) {
  const db = await getTenantDatabase(tenantId);
  await db.metadata.delete(`${tenantId}:pos-draft`);
}

export async function exportTenantOfflineData(tenantId) {
  const db = await getTenantDatabase(tenantId);
  const data = { tenantId, schemaVersion: OFFLINE_SCHEMA_VERSION, exportedAt: iso(), tables: {} };
  for (const table of db.tables) {
    data.tables[table.name] = await table.toArray();
  }
  return data;
}

export async function resetTenantOfflineData(tenantId, { allowPending = false } = {}) {
  const db = await getTenantDatabase(tenantId);
  const pending = await countPendingOperations(tenantId);
  if (pending > 0 && !allowPending) {
    const error = new Error(`${pending} unsynchronized operation${pending === 1 ? '' : 's'} must be synchronized or exported first`);
    error.code = 'PENDING_OPERATIONS';
    throw error;
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}
