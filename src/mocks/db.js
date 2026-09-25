import { createInitialDb } from './seed';

/**
 * Module-level singleton so the in-memory data survives across requests for
 * the life of this Node process (resets on server restart — this is a demo,
 * not a database).
 */
const globalKey = '__dine3d_mock_db__';

export function getDb() {
  if (!globalThis[globalKey]) {
    globalThis[globalKey] = createInitialDb();
  }
  return globalThis[globalKey];
}

export function resetDb() {
  globalThis[globalKey] = createInitialDb();
  return globalThis[globalKey];
}
