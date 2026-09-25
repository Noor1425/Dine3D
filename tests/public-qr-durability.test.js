require('fake-indexeddb/auto');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;

const {
  acknowledgeQrSubmission,
  getOrCreatePendingQrSubmission,
  getPendingQrSubmissions,
} = require('../src/lib/offline/publicQrDatabase');

describe('public QR retry durability', () => {
  test('a retry of the same pending payload reuses its order and operation IDs', async () => {
    const restaurantId = '31313131-3131-4131-8131-313131313131';
    const tableId = '32323232-3232-4232-8232-323232323232';
    const payload = { restaurantId, tableId, qrToken: 'opaque-token', items: [{ menuItemId: 'item', quantity: 1 }] };
    const first = await getOrCreatePendingQrSubmission({ restaurantId, tableId, qrToken: payload.qrToken, payload });
    const retry = await getOrCreatePendingQrSubmission({ restaurantId, tableId, qrToken: payload.qrToken, payload });
    expect(retry.operationId).toBe(first.operationId);
    expect(retry.orderId).toBe(first.orderId);
    expect(retry.payload.clientOrderId).toBe(first.orderId);
  });

  test('server acknowledgement retires the pending submission but retains diagnostic metadata', async () => {
    const restaurantId = '33333333-3333-4333-8333-333333333333';
    const tableId = '34343434-3434-4434-8434-343434343434';
    const payload = { restaurantId, tableId, qrToken: 'opaque-token', items: [{ menuItemId: 'item', quantity: 1 }] };
    const pending = await getOrCreatePendingQrSubmission({ restaurantId, tableId, qrToken: payload.qrToken, payload });
    await acknowledgeQrSubmission(pending.operationId, { order: { id: pending.orderId, orderNumber: 'OFFICIAL-1', status: 'PENDING' }, trackingToken: 'tracking' });
    expect(await getPendingQrSubmissions(restaurantId, tableId)).toEqual([]);
  });
});

