require('fake-indexeddb/auto');
global.window = global;
if (!global.crypto) global.crypto = require('crypto').webcrypto;
if (!global.addEventListener) global.addEventListener = () => {};
if (!global.removeEventListener) global.removeEventListener = () => {};
if (!global.dispatchEvent) global.dispatchEvent = () => true;
if (!global.CustomEvent) global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } };

const Dexie = require('dexie').default;
const { closeTenantDatabase } = require('../src/lib/offline/database');
const { SyncEngine } = require('../src/lib/offline/syncEngine');

/**
 * "Sync now" is the button an owner presses after an outage to find out whether
 * the evening's orders reached the server. It has to tell the truth.
 *
 * It did not. The same leader lock that stops ten open tabs polling on a timer
 * was applied to the button with `ifAvailable`, so a click in a tab that did
 * not hold the lock did no work at all — and the page then printed the previous
 * run's conclusion, "All saved changes are synchronized", without anything
 * having been sent. A run already in flight produced the same false report.
 *
 * The rule now: the timer may give up its turn, a person may not.
 */

const tenantId = '51515151-5151-4151-8151-515151515151';
const context = {
  tenantId,
  deviceId: '52525252-5252-4252-8252-525252525252',
  userId: '53535353-5353-4353-8353-535353535353',
};

/**
 * A Web Locks implementation with one queue, so a test can hold the lock the
 * way a second browser tab would.
 */
function installLocks() {
  const queues = new Map();
  global.navigator = {
    locks: {
      async request(name, options, callback) {
        const chain = queues.get(name) || Promise.resolve();
        if (options.ifAvailable) {
          let busy = true;
          // Busy when the previous holder has not settled yet.
          await Promise.race([chain.then(() => { busy = false; }), Promise.resolve()]);
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (busy) return callback(null);
          return callback({ name });
        }
        if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const turn = chain.then(() => callback({ name }));
        queues.set(name, turn.catch(() => {}));
        const aborted = options.signal
          ? new Promise((_, reject) => options.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
          : null;
        return aborted ? Promise.race([turn, aborted]) : turn;
      },
    },
  };
  return {
    /** Hold `name` the way another tab holds it, until the returned release is called. */
    hold(name) {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const chain = (queues.get(name) || Promise.resolve()).then(() => held);
      queues.set(name, chain.catch(() => {}));
      return release;
    },
  };
}

/** An engine that believes it is started, with the network stubbed. */
function engineWith({ cloudOnline = true, edgeOnline = false } = {}) {
  const engine = new SyncEngine().configure(context);
  engine.started = true;
  engine.healthCheck = async () => cloudOnline;
  engine.edgeHealthCheck = async () => edgeOnline;
  engine.refreshBootstrap = async () => {};
  engine.getReadyBatch = async () => [];
  engine.refreshCounts = async () => {};
  engine.schedule = () => {};
  return engine;
}

const lockName = `dine3d-sync:${context.tenantId}:${context.deviceId}`;

describe('Sync now', () => {
  let locks;

  beforeEach(async () => {
    closeTenantDatabase(tenantId);
    await Dexie.delete(`dine3d-offline-${tenantId}`);
    locks = installLocks();
  });

  afterAll(async () => {
    closeTenantDatabase(tenantId);
    await Dexie.delete(`dine3d-offline-${tenantId}`);
    delete global.navigator;
  });

  test('a click waits for another window instead of doing nothing', async () => {
    const engine = engineWith();
    const release = locks.hold(lockName);

    let settled = false;
    const clicked = engine.syncNow({ timeoutMs: 2_000 }).then((result) => { settled = true; return result; });

    // While the other window holds the turn, nothing has been reported yet.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);

    release();
    const result = await clicked;
    expect(result.ran).toBe(true);
    expect(result.status).toBe('synchronized');
  });

  test('and says so plainly when the wait runs out', async () => {
    const engine = engineWith();
    locks.hold(lockName); // never released

    const result = await engine.syncNow({ timeoutMs: 150 });

    expect(result.ran).toBe(false);
    // Crucially it must NOT claim success it never achieved.
    expect(result.status).not.toBe('synchronized');
  });

  test('a click never reports a stale "synchronized" from an earlier run', async () => {
    const engine = engineWith();
    engine.publish({ status: 'synchronized', message: 'Synchronized with server' });
    locks.hold(lockName);

    const result = await engine.syncNow({ timeoutMs: 150 });

    // The state may still read synchronized from before; `ran` is what tells
    // the screen this click achieved nothing.
    expect(result.ran).toBe(false);
  });

  test('the timer still yields its turn rather than queueing up behind other tabs', async () => {
    // The whole point of the lock: many tabs on a 20-second timer must not
    // each wait in line to hit the server.
    const engine = engineWith();
    const release = locks.hold(lockName);

    const ran = await engine.run();

    expect(ran).toBe(false);
    release();
  });
});

describe('Losing the connection is reported', () => {
  beforeEach(async () => {
    closeTenantDatabase(tenantId);
    await Dexie.delete(`dine3d-offline-${tenantId}`);
    installLocks();
  });

  afterAll(async () => {
    closeTenantDatabase(tenantId);
    await Dexie.delete(`dine3d-offline-${tenantId}`);
    delete global.navigator;
  });

  test('with nothing reachable the status becomes offline, not the last good result', async () => {
    // The `offline` presentation has always existed in the header. Nothing
    // ever set it, because the run returned early without publishing — so a
    // till with the cable out went on displaying "Online and synchronized".
    const engine = engineWith({ cloudOnline: false, edgeOnline: false });
    engine.publish({ status: 'synchronized', message: 'Synchronized with server' });

    await engine.run();

    expect(engine.state.status).toBe('offline');
    expect(engine.state.meaningfulOnline).toBe(false);
    expect(engine.state.message).toMatch(/saved on this device|stay on this device/i);
  });

  test('coming back online clears it', async () => {
    const engine = engineWith({ cloudOnline: false, edgeOnline: false });
    await engine.run();
    expect(engine.state.status).toBe('offline');

    engine.healthCheck = async () => true;
    await engine.run();

    expect(engine.state.status).toBe('synchronized');
  });
});
