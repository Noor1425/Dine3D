require('fake-indexeddb/auto');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;

const Dexie = require('dexie').default;
const {
  OFFLINE_SCHEMA_VERSION,
  applyEdgeInventoryProjection,
  applyEdgeOrderProjection,
  closeTenantDatabase,
  enqueueCashPayment,
  enqueueOrder,
  enqueueOrderTransition,
  getValidOfflineAccess,
  getLocalActiveOrders,
  getSyncDiagnostics,
  getTenantDatabase,
  setOfflineVaultLocked,
} = require('../src/lib/offline/database');

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const legacyTenantId = '33333333-3333-4333-8333-333333333339';
const context = {
  tenantId,
  restaurantId: tenantId,
  locationId: '33333333-3333-4333-8333-333333333333',
  deviceId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
  offlineAccessToken: 'signed-test-snapshot',
};

async function destroyTenant(id) {
  closeTenantDatabase(id);
  await Dexie.delete(`dine3d-offline-${id}`);
}

describe('versioned tenant-local database and transactional outbox', () => {
  beforeEach(async () => {
    await destroyTenant(tenantId);
    await destroyTenant(otherTenantId);
    await destroyTenant(legacyTenantId);
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await destroyTenant(otherTenantId);
    await destroyTenant(legacyTenantId);
  });

  test('order, items, cash payment, and outbox command survive database reopen', async () => {
    const saved = await enqueueOrder(context, {
      id: '66666666-6666-4666-8666-666666666666',
      fulfilmentStatus: 'CONFIRMED',
      currency: 'PKR',
      grandTotal: 125,
      items: [{ id: '77777777-7777-4777-8777-777777777777', menuItemId: '88888888-8888-4888-8888-888888888888', name: 'Meal', quantity: 1, basePrice: 125 }],
      cashPayment: { id: '99999999-9999-4999-8999-999999999999', amount: 125, amountTendered: 150 },
    });
    expect(saved.order.id).toBe('66666666-6666-4666-8666-666666666666');

    closeTenantDatabase(tenantId);
    const reopened = await getTenantDatabase(tenantId);
    const [order, payment, command] = await Promise.all([
      reopened.orders.get(saved.order.id),
      reopened.payments.get('99999999-9999-4999-8999-999999999999'),
      reopened.syncOutbox.get(saved.operationId),
    ]);
    expect(order.tenantId).toBe(tenantId);
    expect(payment.status).toBe('completed');
    expect(command.status).toBe('pending');
    expect(command.payload.order.id).toBe(order.id);
    expect(command.offlineAccessToken).toBe('signed-test-snapshot');
  });

  test('causal order transitions depend on the prior command and retain expected versions', async () => {
    const created = await enqueueOrder(context, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', menuItemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Meal', quantity: 1, basePrice: 10 }],
    });
    const first = await enqueueOrderTransition(context, created.order.id, 'PREPARING');
    const second = await enqueueOrderTransition(context, created.order.id, 'READY');
    const diagnostics = await getSyncDiagnostics(tenantId);
    const firstEntry = diagnostics.outbox.find((entry) => entry.operationId === first.operationId);
    const secondEntry = diagnostics.outbox.find((entry) => entry.operationId === second.operationId);
    expect(firstEntry.dependencyIds).toEqual([created.operationId]);
    expect(secondEntry.dependencyIds).toEqual([first.operationId]);
    expect(firstEntry.payload.baseVersion).toBe(1);
    expect(secondEntry.payload.baseVersion).toBe(2);
  });

  test('cash payment command depends on unsynchronized order creation', async () => {
    const created = await enqueueOrder(context, {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      items: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', menuItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Meal', quantity: 1, basePrice: 10 }],
    });
    const payment = await enqueueCashPayment(context, created.order.id, { id: '12121212-1212-4212-8212-121212121212', amount: 10 });
    const diagnostics = await getSyncDiagnostics(tenantId);
    const entry = diagnostics.outbox.find((item) => item.operationId === payment.operationId);
    expect(entry.dependencyIds).toEqual([created.operationId]);
  });

  test('branch Edge projections update kitchen state and reject cross-branch records', async () => {
    const projectedOrderId = 'abababab-abab-4bab-8bab-abababababab';
    const edgeOrder = {
      id: projectedOrderId,
      restaurantId: tenantId,
      locationId: context.locationId,
      branchId: context.locationId,
      orderNumber: 'LOCAL-EDGE-1',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      orderType: 'DINE_IN',
      items: [{ id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', orderId: projectedOrderId, menuItemId: 'efefefef-efef-4fef-8fef-efefefefefef', name: 'Local meal', quantity: 1 }],
      createdAt: '2026-09-07T12:00:00.000Z',
      edgeUpdatedAt: '2026-09-07T12:00:01.000Z',
      edgeRevision: 1,
      cloudPending: true,
      stateVersion: 1,
    };
    expect(await applyEdgeOrderProjection(context, [edgeOrder])).toHaveLength(1);
    expect((await getLocalActiveOrders(tenantId)).find((order) => order.id === projectedOrderId)).toMatchObject({
      status: 'CONFIRMED',
      offlinePending: true,
    });

    await applyEdgeOrderProjection(context, [{ ...edgeOrder, status: 'READY', edgeRevision: 2, stateVersion: 2 }]);
    expect((await getLocalActiveOrders(tenantId)).find((order) => order.id === projectedOrderId).status).toBe('READY');

    const foreignBranch = { ...edgeOrder, id: 'acacacac-acac-4cac-8cac-acacacacacac', locationId: otherTenantId };
    expect(await applyEdgeOrderProjection(context, [foreignBranch])).toEqual([]);
    expect(await (await getTenantDatabase(tenantId)).orders.get(foreignBranch.id)).toBeUndefined();
  });

  test('branch Edge inventory movements apply exactly once across devices', async () => {
    const db = await getTenantDatabase(tenantId);
    const inventoryItemId = 'adadadad-adad-4dad-8dad-adadadadadad';
    await db.inventorySnapshots.put({
      id: inventoryItemId,
      tenantId,
      restaurantId: tenantId,
      locationId: context.locationId,
      currentStock: 10,
      syncStatus: 'synchronized',
      updatedAt: new Date().toISOString(),
    });
    const movement = {
      id: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
      operationId: 'bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd',
      restaurantId: tenantId,
      locationId: context.locationId,
      inventoryItemId,
      quantityChange: -3,
      changeType: 'WASTE',
      reason: 'Damaged during preparation',
      businessTimestamp: new Date().toISOString(),
      edgeRevision: 3,
      cloudPending: true,
    };
    expect(await applyEdgeInventoryProjection(context, [movement])).toHaveLength(1);
    expect((await db.inventorySnapshots.get(inventoryItemId)).currentStock).toBe(7);
    expect(await applyEdgeInventoryProjection(context, [movement])).toEqual([]);
    expect((await db.inventorySnapshots.get(inventoryItemId)).currentStock).toBe(7);
  });

  test('physical databases and tenant predicates isolate restaurant records', async () => {
    await enqueueOrder(context, {
      id: '13131313-1313-4313-8313-131313131313',
      items: [{ id: '14141414-1414-4414-8414-141414141414', menuItemId: '15151515-1515-4515-8515-151515151515', name: 'Tenant one meal', quantity: 1, basePrice: 10 }],
    });
    expect(await getLocalActiveOrders(otherTenantId)).toEqual([]);
  });

  test('reused operation IDs roll back both the operational record and outbox write atomically', async () => {
    const operationId = '16161616-1616-4616-8616-161616161616';
    await enqueueOrder(context, {
      id: '17171717-1717-4717-8717-171717171717', operationId,
      items: [{ id: '18181818-1818-4818-8818-181818181818', menuItemId: '19191919-1919-4919-8919-191919191919', name: 'First', quantity: 1, basePrice: 10 }],
    });
    await expect(enqueueOrder(context, {
      id: '20202020-2020-4020-8020-202020202020', operationId,
      items: [{ id: '21212121-2121-4121-8121-212121212121', menuItemId: '22222222-2222-4222-8222-222222222229', name: 'Second', quantity: 1, basePrice: 10 }],
    })).rejects.toBeTruthy();
    const db = await getTenantDatabase(tenantId);
    expect(await db.orders.get('20202020-2020-4020-8020-202020202020')).toBeUndefined();
    expect(await db.syncOutbox.where('operationId').equals(operationId).count()).toBe(1);
  });

  test('a version-1 database upgrades to the current schema without clearing old records', async () => {
    const name = `dine3d-offline-${legacyTenantId}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      cachedRestaurant: '&id,tenantId,updatedAt',
      orders: '&id,tenantId,locationId,syncStatus,updatedAt',
      orderItems: '&id,tenantId,orderId,syncStatus',
      syncOutbox: '&operationId,[tenantId+status],[deviceId+localSequence],entityId,createdAt,nextRetryAt',
      syncCheckpoints: '&id,tenantId,deviceId,updatedAt',
      deviceIdentity: '&id,tenantId,deviceId,updatedAt',
    });
    await legacy.open();
    await legacy.orders.put({ id: '23232323-2323-4323-8323-232323232323', fulfilmentStatus: 'CONFIRMED' });
    legacy.close();

    const upgraded = await getTenantDatabase(legacyTenantId);
    expect(upgraded.verno).toBe(OFFLINE_SCHEMA_VERSION);
    const preserved = await upgraded.orders.get('23232323-2323-4323-8323-232323232323');
    expect(preserved.tenantId).toBe(legacyTenantId);
    expect(preserved.syncStatus).toBe('pending');
  });

  test('a version-3 cached table survives the reserved-name repair migration', async () => {
    const name = `dine3d-offline-${legacyTenantId}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores({ tables: '&id,tenantId,locationId,isActive,updatedAt' });
    await legacy.open();
    await legacy.table('tables').put({
      id: '24242424-2424-4424-8424-242424242424',
      tenantId: legacyTenantId,
      locationId: context.locationId,
      isActive: true,
      updatedAt: new Date().toISOString(),
    });
    legacy.close();

    const upgraded = await getTenantDatabase(legacyTenantId);
    expect(await upgraded.cachedTables.get('24242424-2424-4424-8424-242424242424')).toMatchObject({
      tenantId: legacyTenantId,
      isActive: true,
    });
  });

  /**
   * A deliberate tripwire. Raising this number is never a local decision: the
   * server validates it, and if a till starts reporting a version the server's
   * ceiling has not reached yet, every till is answered 409 and stops syncing.
   *
   * So if this test fails, the bump is either accidental — revert it — or
   * intended, in which case MAX_LOCAL_SCHEMA_VERSION in
   * backend/src/services/OfflineAccessService.js must already allow it, and
   * ship first.
   *
   * 6 added the cached delivery riders.
   */
  test('schema exposes the current compatible migration version', () => {
    expect(OFFLINE_SCHEMA_VERSION).toBe(6);
  });

  test('the server it talks to already accepts that version', () => {
    const fs = require('fs');
    const path = require('path');
    const serverSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'backend', 'src', 'services', 'OfflineAccessService.js'),
      'utf8',
    );
    const ceiling = Number(serverSource.match(/MAX_LOCAL_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
    expect(ceiling).toBeGreaterThanOrEqual(OFFLINE_SCHEMA_VERSION);
  });

  test('logout locks cached tenant data without erasing pending operations', async () => {
    const db = await getTenantDatabase(tenantId);
    const claims = Buffer.from(JSON.stringify({ restaurantId: tenantId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    await db.cachedRestaurant.put({
      id: tenantId,
      tenantId,
      restaurantId: tenantId,
      offlineAccessToken: `header.${claims}.signature`,
      updatedAt: new Date().toISOString(),
    });
    await enqueueOrder(context, {
      id: '25252525-2525-4525-8525-252525252525',
      items: [{ id: '26262626-2626-4626-8626-262626262626', menuItemId: '27272727-2727-4727-8727-272727272727', name: 'Protected meal', quantity: 1, basePrice: 10 }],
    });

    expect(await getValidOfflineAccess(tenantId)).not.toBeNull();
    await setOfflineVaultLocked(tenantId, true, { reason: 'Explicit logout' });
    expect(await getValidOfflineAccess(tenantId)).toBeNull();
    expect((await getSyncDiagnostics(tenantId)).outbox).toHaveLength(1);
  });
});
