'use client';

// Small, dependency-free server-state cache for stable tenant reference data.
// It deduplicates concurrent requests and serves stale data while one
// background revalidation is in flight. Dynamic orders/payments never use it.
class ServerStateCache {
  constructor() {
    this.entries = new Map();
  }

  async read(key, loader, { staleMs = 30_000, maxAgeMs = 5 * 60_000 } = {}) {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing?.data !== undefined && now - existing.updatedAt <= staleMs) return existing.data;
    if (existing?.promise) {
      if (existing.data !== undefined && now - existing.updatedAt <= maxAgeMs) return existing.data;
      return existing.promise;
    }

    const promise = Promise.resolve().then(loader).then((data) => {
      this.entries.set(key, { data, updatedAt: Date.now(), promise: null });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dine3d:server-state-updated', { detail: { key } }));
      }
      return data;
    }).catch((error) => {
      if (existing?.data !== undefined) this.entries.set(key, { ...existing, promise: null });
      else this.entries.delete(key);
      throw error;
    });

    this.entries.set(key, { data: existing?.data, updatedAt: existing?.updatedAt || 0, promise });
    if (existing?.data !== undefined && now - existing.updatedAt <= maxAgeMs) {
      promise.catch(() => {});
      return existing.data;
    }
    return promise;
  }

  invalidate(prefix = '') {
    for (const key of this.entries.keys()) {
      if (!prefix || key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}

export const serverStateCache = new ServerStateCache();

export function currentServerStateScope() {
  if (typeof window === 'undefined') return 'server';
  let restaurantId = 'anonymous';
  let branchId = 'all';
  try { restaurantId = JSON.parse(localStorage.getItem('dine3d_restaurant') || 'null')?.id || restaurantId; } catch {}
  try { branchId = JSON.parse(localStorage.getItem('selected_branch') || 'null')?.id || branchId; } catch {}
  return `${restaurantId}:${branchId}`;
}
