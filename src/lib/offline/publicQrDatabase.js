'use client';

import Dexie from 'dexie';

const db = new Dexie('dine3d-public-qr-v1');
db.version(1).stores({
  carts: '&scopeKey, restaurantId, tableId, updatedAt',
  submissions: '&operationId, orderId, [restaurantId+tableId], status, createdAt, updatedAt',
});
db.version(2).stores({
  carts: '&scopeKey, restaurantId, tableId, updatedAt',
  submissions: '&operationId, orderId, [restaurantId+tableId], status, createdAt, updatedAt',
  orderHistory: '&scopeKey, restaurantId, tableId, updatedAt',
});

export function qrScopeKey(restaurantId, tableId) {
  return `${String(restaurantId || 'unknown')}:${String(tableId || 'no-table')}`;
}

export async function loadPublicCart(restaurantId, tableId) {
  const row = await db.carts.get(qrScopeKey(restaurantId, tableId));
  if (!row || row.restaurantId !== restaurantId || row.tableId !== (tableId || null)) return [];
  return Array.isArray(row.items) ? row.items : [];
}

export async function savePublicCart(restaurantId, tableId, items) {
  if (!restaurantId) return;
  await db.carts.put({
    scopeKey: qrScopeKey(restaurantId, tableId),
    restaurantId,
    tableId: tableId || null,
    items: Array.isArray(items) ? items : [],
    updatedAt: new Date().toISOString(),
  });
}

export async function clearPublicCart(restaurantId, tableId) {
  if (!restaurantId) return;
  await db.carts.delete(qrScopeKey(restaurantId, tableId));
}

export async function getOrCreatePendingQrSubmission({ restaurantId, tableId, qrToken, payload }) {
  const scopeKey = qrScopeKey(restaurantId, tableId);
  const existing = await db.submissions.where('[restaurantId+tableId]')
    .equals([restaurantId, tableId || null])
    .filter((entry) => entry.status === 'pending' && entry.payloadFingerprint === JSON.stringify(payload))
    .first();
  if (existing) return existing;

  const operationId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry = {
    operationId,
    orderId,
    scopeKey,
    restaurantId,
    tableId: tableId || null,
    qrToken,
    payload: { ...payload, operationId, clientOrderId: orderId },
    payloadFingerprint: JSON.stringify(payload),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.submissions.put(entry);
  return entry;
}

export async function markQrSubmissionAttempt(operationId, error = null) {
  const current = await db.submissions.get(operationId);
  if (!current) return;
  await db.submissions.update(operationId, {
    status: error ? 'pending' : current.status,
    retryCount: Number(current.retryCount || 0) + 1,
    lastError: error ? String(error).slice(0, 500) : null,
    updatedAt: new Date().toISOString(),
  });
}

export async function acknowledgeQrSubmission(operationId, response) {
  await db.submissions.update(operationId, {
    status: 'acknowledged',
    response: {
      orderId: response?.order?.id,
      orderNumber: response?.order?.orderNumber,
      status: response?.order?.status,
      trackingToken: response?.trackingToken,
    },
    acknowledgedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null,
  });
}

export async function getPendingQrSubmissions(restaurantId, tableId) {
  return db.submissions.where('[restaurantId+tableId]').equals([restaurantId, tableId || null])
    .filter((entry) => entry.status === 'pending')
    .sortBy('createdAt');
}

export async function loadPublicOrderHistory(restaurantId, tableId) {
  const row = await db.orderHistory.get(qrScopeKey(restaurantId, tableId));
  return row?.restaurantId === restaurantId && row?.tableId === (tableId || null) && Array.isArray(row.orders) ? row.orders : [];
}

export async function savePublicOrderHistory(restaurantId, tableId, orders) {
  await db.orderHistory.put({
    scopeKey: qrScopeKey(restaurantId, tableId), restaurantId, tableId: tableId || null,
    orders: Array.isArray(orders) ? orders.slice(0, 20) : [], updatedAt: new Date().toISOString(),
  });
}

export async function clearPublicOrderHistory(restaurantId, tableId) {
  await db.orderHistory.delete(qrScopeKey(restaurantId, tableId));
}
