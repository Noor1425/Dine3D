/* eslint-disable no-console */
// Real Chrome + production Next + Express + PostgreSQL acceptance scenario.
// The fixture is unique to each run and cleanup targets only that fixture.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const FRONTEND_DIR = path.resolve(__dirname, '../..');
const ROOT_DIR = path.resolve(FRONTEND_DIR, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
require(path.join(BACKEND_DIR, 'node_modules/dotenv')).config({ path: path.join(BACKEND_DIR, '.env') });
const { PrismaClient } = require(path.join(BACKEND_DIR, 'node_modules/@prisma/client'));
const bcrypt = require(path.join(BACKEND_DIR, 'node_modules/bcryptjs'));
const { seedEntitlements } = require(path.join(BACKEND_DIR, 'prisma/entitlementSeed'));

const prisma = new PrismaClient();
const frontendUrl = 'http://localhost:3000';
const backendUrl = 'http://localhost:4000';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const processes = [];
let restaurant;
let fixture;

function uniqueId() {
  return crypto.randomUUID();
}

function waitForUrl(url, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${url}`));
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function start(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
  child.on('exit', (code) => {
    if (code && !child.killed) console.error(`${command} exited ${code}: ${stderr}`);
  });
  processes.push(child);
  return child;
}

async function setupFixture() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const password = `Offline-${crypto.randomBytes(12).toString('base64url')}!`;
  await seedEntitlements(prisma, { assignExisting: false });
  const plan = await prisma.plan.findUnique({ where: { key: 'professional' } });
  assert(plan, 'professional plan must exist');

  restaurant = await prisma.restaurant.create({
    data: {
      name: `Offline acceptance ${suffix}`,
      slug: `offline-accept-${suffix}`,
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      plan: 'professional',
      taxPercent: 5,
      serviceChargePercent: 0,
      serviceFeeFixed: 0,
    },
  });
  const branch = await prisma.branch.create({
    data: { restaurantId: restaurant.id, code: 'MAIN', name: 'Main', isPrimary: true, timezone: 'Asia/Karachi' },
  });
  const staff = await prisma.staff.create({
    data: {
      restaurantId: restaurant.id,
      email: `offline-${suffix}@example.test`,
      password: await bcrypt.hash(password, 10),
      role: 'owner',
      name: 'Offline Acceptance Owner',
    },
  });
  const category = await prisma.category.create({
    data: { restaurantId: restaurant.id, name: 'Acceptance', sortOrder: 1 },
  });
  const menuItem = await prisma.menuItem.create({
    data: { restaurantId: restaurant.id, categoryId: category.id, name: 'Offline Acceptance Meal', basePrice: 100, sortOrder: 1 },
  });
  const ingredient = await prisma.ingredient.create({
    data: { restaurantId: restaurant.id, locationId: branch.id, name: 'Acceptance ingredient', unit: 'PIECE', currentStock: 100, lowStockThreshold: 5 },
  });
  await prisma.menuItemIngredient.create({
    data: { restaurantId: restaurant.id, menuItemId: menuItem.id, ingredientId: ingredient.id, quantityUsed: 2, unit: 'PIECE' },
  });
  const table = await prisma.table.create({
    data: { restaurantId: restaurant.id, locationId: branch.id, tableNumber: 'A1', qrToken: uniqueId() },
  });
  await prisma.subscription.create({
    data: {
      restaurantId: restaurant.id,
      planId: plan.id,
      status: 'ACTIVE',
      provider: 'manual',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  fixture = { suffix, password, branch, staff, menuItem, ingredient, table };
}

async function cleanupRestaurant(restaurantId) {
  await prisma.$transaction(async (tx) => {
    await tx.syncConflict.deleteMany({ where: { restaurantId } });
    await tx.inventoryReconciliationIssue.deleteMany({ where: { restaurantId } });
    await tx.operationalNote.deleteMany({ where: { restaurantId } });
    await tx.offlineOperation.deleteMany({ where: { restaurantId } });
    await tx.idempotencyRecord.deleteMany({ where: { restaurantId } });
    await tx.orderNumberSequence.deleteMany({ where: { restaurantId } });
    await tx.syncDevice.deleteMany({ where: { restaurantId } });
    await tx.stockLog.deleteMany({ where: { restaurantId } });
    await tx.refreshToken.deleteMany({ where: { restaurantId } });
    await tx.restaurant.delete({ where: { id: restaurantId } });
  });
}

async function cleanupFixture() {
  if (restaurant?.id) await cleanupRestaurant(restaurant.id);
}

async function cleanupOrphanedAcceptanceFixtures() {
  const fixtures = await prisma.restaurant.findMany({
    where: { slug: { startsWith: 'offline-accept-' } },
    select: { id: true },
  });
  for (const item of fixtures) await cleanupRestaurant(item.id);
}

async function loginAndOpenPos(context) {
  console.log('[acceptance] opening authenticated POS');
  const page = await context.newPage();
  await page.goto(`${frontendUrl}/admin/login`, { waitUntil: 'domcontentloaded' });
  const login = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    return { status: response.status, body: await response.json() };
  }, { email: fixture.staff.email, password: fixture.password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  await page.goto(`${frontendUrl}/admin/pos`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Offline Acceptance Meal/ }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.dine3dOffline));
  const registration = await page.evaluate(async () => {
    try {
      const [scriptResponse, offlineResponse] = await Promise.all([fetch('/sw.js'), fetch('/offline')]);
      const worker = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const installing = worker.installing;
      if (installing && !['installed', 'activated', 'redundant'].includes(installing.state)) {
        await Promise.race([
          new Promise((resolve) => installing.addEventListener('statechange', () => {
            if (['installed', 'activated', 'redundant'].includes(installing.state)) resolve();
          })),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
      return {
        ok: true,
        scriptStatus: scriptResponse.status,
        offlineStatus: offlineResponse.status,
        installing: worker.installing?.state,
        waiting: worker.waiting?.state,
        active: worker.active?.state,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  assert(registration.ok, `service worker registration failed: ${registration.error}`);
  console.log(`[acceptance] service worker registration ${JSON.stringify(registration)}`);
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('service worker readiness timeout')), 15_000)),
  ]));
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Offline Acceptance Meal/ }).waitFor({ timeout: 30_000 });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15_000 });
  console.log('[acceptance] POS, IndexedDB, and service worker ready');
  return page;
}

async function createOrderThroughPos(page, { cash = false } = {}) {
  const priorCreateCount = await page.evaluate(() => window.dine3dOffline.getDiagnostics()
    .then((result) => result.outbox.filter((entry) => entry.operationType === 'ORDER_CREATE').length));
  await page.getByRole('button', { name: /Offline Acceptance Meal/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const action = cash ? page.getByRole('button', { name: /Complete Payment/ }) : page.getByRole('button', { name: 'Save Order' });
  await action.click();
  await page.waitForFunction((count) => window.dine3dOffline.getDiagnostics()
    .then((result) => result.outbox.filter((entry) => entry.operationType === 'ORDER_CREATE').length > count), priorCreateCount);
  const diagnostics = await page.evaluate(() => window.dine3dOffline.getDiagnostics());
  return diagnostics.outbox.filter((entry) => entry.operationType === 'ORDER_CREATE').at(-1);
}

async function advanceOrderToCompleted(page, orderId) {
  await page.getByRole('button', { name: /^Active / }).click();
  for (const status of ['PREPARING', 'READY', 'COMPLETED']) {
    const article = page.locator('article').filter({ has: page.locator(`text=${orderId.slice(0, 6)}`) });
    const scoped = article.getByRole('button', { name: `Move to ${status}` });
    const fallback = page.getByRole('button', { name: `Move to ${status}` }).first();
    await (await scoped.count() ? scoped : fallback).click();
    if (status !== 'COMPLETED') await page.getByRole('button', { name: `Move to ${status === 'PREPARING' ? 'READY' : 'COMPLETED'}` }).first().waitFor();
  }
  await page.getByRole('button', { name: /^Active / }).click();
}

async function waitForSynchronized(page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => window.dine3dOffline.getDiagnostics().then((result) => result.outbox.every((entry) => entry.status === 'acknowledged')),
    null,
    { timeout: timeoutMs },
  );
}

async function runBrowserAcceptance() {
  assert(fs.existsSync(chromePath), 'Google Chrome is required for this acceptance test');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dine3d-offline-acceptance-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      viewport: { width: 1440, height: 1000 },
    });
    let page = await loginAndOpenPos(context);
    await context.setOffline(true);
    console.log('[acceptance] network disconnected');

    const first = await createOrderThroughPos(page);
    console.log('[acceptance] first order stored locally');
    await advanceOrderToCompleted(page, first.entityId);
    console.log('[acceptance] kitchen lifecycle stored locally');
    const cash = await createOrderThroughPos(page, { cash: true });
    console.log('[acceptance] cash order stored locally');
    const beforeRestart = await page.evaluate(() => window.dine3dOffline.getDiagnostics());
    assert(beforeRestart.outbox.length >= 5, 'order, transitions, and cash must be durable in the outbox');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.dine3dOffline));
    const afterRefresh = await page.evaluate(() => window.dine3dOffline.getDiagnostics());
    assert.equal(afterRefresh.outbox.length, beforeRestart.outbox.length, 'refresh must preserve the queue');
    console.log('[acceptance] refresh durability verified');

    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chromePath,
      headless: true,
      offline: true,
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    await page.goto(`${frontendUrl}/admin/pos`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.dine3dOffline));
    const afterRestart = await page.evaluate(() => window.dine3dOffline.getDiagnostics());
    assert.equal(afterRestart.outbox.length, beforeRestart.outbox.length, 'browser restart must preserve the queue');
    console.log('[acceptance] browser restart durability verified');

    let lostAcknowledgement = false;
    await page.route('**/api/sync/operations', async (route) => {
      if (lostAcknowledgement) return route.continue();
      lostAcknowledgement = true;
      const committed = await route.fetch();
      await committed.body();
      return route.abort('failed');
    });
    await context.setOffline(false);
    console.log('[acceptance] network restored; dropping first acknowledgement');
    await page.evaluate(() => window.dine3dOffline.syncNow()).catch(() => {});
    assert(lostAcknowledgement, 'the lost-acknowledgement interception must execute');
    await page.unroute('**/api/sync/operations');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await page.evaluate(() => window.dine3dOffline.syncNow());
    await waitForSynchronized(page);

    const [orders, firstCount, cashPayment, deductions, replays] = await Promise.all([
      prisma.order.findMany({ where: { id: { in: [first.entityId, cash.entityId] }, restaurantId: restaurant.id } }),
      prisma.order.count({ where: { id: first.entityId, restaurantId: restaurant.id } }),
      prisma.payment.findFirst({ where: { orderId: cash.entityId, restaurantId: restaurant.id } }),
      prisma.stockLog.findMany({ where: { orderId: first.entityId, restaurantId: restaurant.id, changeType: 'ORDER_DEDUCTION' } }),
      prisma.offlineOperation.count({ where: { restaurantId: restaurant.id, replayCount: { gt: 0 } } }),
    ]);
    assert.equal(orders.length, 2, 'both offline orders must reach the server');
    assert.equal(firstCount, 1, 'lost acknowledgement must not duplicate an order');
    assert.equal(cashPayment?.status, 'completed', 'offline cash payment must settle exactly once');
    assert.equal(deductions.length, 1, 'recipe inventory must be deducted exactly once');
    assert(replays > 0, 'the server must report a durable idempotent replay');

    console.log(JSON.stringify({
      scenario1: 'PASS',
      scenario2: 'PASS',
      scenario5Cash: 'PASS',
      scenario8QueueAcrossApplicationReload: 'PASS',
      orders: orders.length,
      duplicateOrders: firstCount - 1,
      inventoryDeductions: deductions.length,
      durableReplays: replays,
    }));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  await cleanupOrphanedAcceptanceFixtures();
  await setupFixture();
  start(process.execPath, ['src/server.js'], BACKEND_DIR, { NODE_ENV: 'development', HTTP_LOGS: 'false', PORT: '4000' });
  await waitForUrl(`${backendUrl}/api/health`);
  start('npm', ['start'], FRONTEND_DIR, { NODE_ENV: 'production', PORT: '3000' });
  await waitForUrl(frontendUrl);
  await runBrowserAcceptance();
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const child of processes) child.kill('SIGTERM');
    await cleanupFixture().catch((error) => console.error(`Fixture cleanup failed: ${error.message}`));
    await prisma.$disconnect();
  });
