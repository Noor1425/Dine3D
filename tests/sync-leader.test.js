require('fake-indexeddb/auto');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;

const Dexie = require('dexie').default;
const { closeTenantDatabase, getTenantDatabase, OUTBOX_STATUS } = require('../src/lib/offline/database');
const { SyncEngine } = require('../src/lib/offline/syncEngine');

const tenantId = '41414141-4141-4141-8141-414141414141';
const context = {
  tenantId,
  deviceId: '42424242-4242-4242-8242-424242424242',
  userId: '43434343-4343-4343-8343-434343434343',
};

describe('cross-tab synchronization leadership', () => {
  beforeEach(async () => {
    closeTenantDatabase(tenantId);
    await Dexie.delete(`dine3d-offline-${tenantId}`);
  });

  afterAll(async () => {
    closeTenantDatabase(tenantId);
    await Dexie.delete(`dine3d-offline-${tenantId}`);
  });

  test('the IndexedDB fallback admits only one tab for the same tenant/device', async () => {
    const first = new SyncEngine().configure(context);
    const second = new SyncEngine().configure(context);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered = false;

    const firstRun = first.withFallbackLease(async () => {
      entered = true;
      await held;
    });
    while (!entered) await new Promise((resolve) => setTimeout(resolve, 0));

    const secondAcquired = await second.withFallbackLease(async () => {
      throw new Error('a second tab must not enter the critical section');
    });
    expect(secondAcquired).toBe(false);

    release();
    expect(await firstRun).toBe(true);
  });

  test('the outbox scheduler returns an ordered bounded batch from a large queue', async () => {
    const db = await getTenantDatabase(tenantId);
    const now = new Date().toISOString();
    await db.syncOutbox.bulkPut(Array.from({ length: 1000 }, (_, index) => ({
      operationId: `operation-${String(index + 1).padStart(4, '0')}`,
      tenantId,
      deviceId: context.deviceId,
      localSequence: index + 1,
      status: index % 2 ? OUTBOX_STATUS.RETRYABLE_FAILED : OUTBOX_STATUS.PENDING,
      entityId: `entity-${index + 1}`,
      dependencyIds: [],
      nextRetryAt: now,
      createdAt: now,
      updatedAt: now,
    })));

    const batch = await new SyncEngine().configure(context).getReadyBatch();
    expect(batch).toHaveLength(20);
    expect(batch.map((entry) => entry.localSequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });
});
