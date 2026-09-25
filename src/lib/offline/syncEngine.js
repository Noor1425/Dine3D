'use client';

import Dexie from 'dexie';

import {
  ACTIVE_OUTBOX_STATUSES,
  OFFLINE_SCHEMA_VERSION,
  OUTBOX_STATUS,
  applyEdgeInventoryProjection,
  applyEdgeOrderProjection,
  cacheBootstrap,
  countPendingOperations,
  getTenantDatabase,
  saveDeviceSyncConfiguration,
} from './database';
import {
  OPERATING_MODE,
  OPERATING_MODE_PRESENTATION,
  OperatingModeController,
} from './operatingMode';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const DEFAULT_INTERVAL_MS = 20_000;
const MAX_BATCH = 20;
const MAX_BATCH_BYTES = 1_500_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const LEASE_MS = 15_000;
/**
 * How long an explicit "Sync now" waits for another tab to finish before it
 * gives up and says so. Long enough to cover a real batch, short enough that
 * nobody stands at a till wondering whether the button worked.
 */
const LEADER_WAIT_MS = 20_000;
const EDGE_RETRY_MS = 5_000;
const EDGE_PROJECTION_SAFETY_POLL_MS = 15_000;
const EDGE_CIRCUIT_FAILURE_THRESHOLD = 3;
const EDGE_CIRCUIT_COOLDOWN_MS = 15_000;
const BOOTSTRAP_REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

function csrfToken() {
  if (typeof document === 'undefined') return null;
  const item = document.cookie.split('; ').find((value) => value.startsWith('dine3d_csrf='));
  return item ? decodeURIComponent(item.slice('dine3d_csrf='.length)) : null;
}

function jitteredBackoff(retryCount) {
  const exponential = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(8, retryCount)));
  return exponential + Math.floor(Math.random() * Math.max(250, exponential * 0.25));
}

async function parseResponse(response) {
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    const error = new Error(data.error || `Synchronization request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code;
    error.retryAfter = Number(response.headers.get('retry-after') || 0);
    throw error;
  }
  return data;
}

async function request(path, options = {}) {
  const { timeoutMs = 8_000, ...fetchOptions } = options;
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    const csrf = csrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      method,
      headers,
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
    });
    return parseResponse(response);
  } finally {
    clearTimeout(timer);
  }
}

async function edgeRequest(edge, path, token, deviceId, options = {}, timeoutMs = 10_000) {
  if (!edge?.lanUrl || !token) throw new Error('Edge is not configured for this device');
  const base = new URL(edge.lanUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) {
    const error = new Error('Edge requires a trusted HTTPS connection');
    error.code = 'EDGE_TLS_REQUIRED';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base.toString().replace(/\/$/, '')}${path}`, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      // Chromium uses this annotation to show its one-time Local Network
      // Access permission instead of treating the request as an unexplained
      // cross-address-space fetch. Other browsers safely ignore the option.
      targetAddressSpace: 'local',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        'X-Dine3D-Device-ID': deviceId,
        ...(options.headers || {}),
      },
    });
    return parseResponse(response);
  } finally {
    clearTimeout(timer);
  }
}

export class SyncEngine {
  constructor() {
    this.context = null;
    this.timer = null;
    this.edgeProjectionTimer = null;
    this.edgeProjectionRunning = false;
    this.edgeSocket = null;
    this.edgeSocketRetry = null;
    this.edgeOperatorToken = null;
    this.edgeRevision = 0;
    this.edgeFailureCount = 0;
    this.edgeCircuitOpenUntil = 0;
    this.lastBootstrapAt = 0;
    this.lastEdgeProjectionAt = 0;
    this.modeController = new OperatingModeController();
    this.running = false;
    this.started = false;
    this.tabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    this.listeners = new Set();
    this.state = {
      status: 'initializing',
      meaningfulOnline: false,
      pendingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      lastSuccessfulSyncAt: null,
      lastHealthCheckAt: null,
      message: 'Preparing offline storage',
      clockOffsetMs: null,
      updateAvailable: false,
      edgeOnline: false,
      edgeConfigured: false,
      edgeConnection: 'not_configured',
      edgeEventStream: 'disconnected',
      cloudOnline: false,
      edgeCloudOnline: null,
      transport: 'cloud',
      operatingMode: OPERATING_MODE.INITIALIZING,
      operatingModeSince: new Date().toISOString(),
      modeMessage: OPERATING_MODE_PRESENTATION[OPERATING_MODE.INITIALIZING].label,
      connectivity: { browserToCloud: null, browserToEdge: null, edgeToCloud: null },
    };
    this.handleOnline = () => this.schedule(0);
    this.handleVisibility = () => {
      if (document.visibilityState === 'visible') this.schedule(0);
    };
    this.handleUpdateRequired = () => this.publish({ updateAvailable: true });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  publish(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dine3d-sync-state', { detail: this.state }));
    }
  }

  configure(context) {
    if (!context?.tenantId || !context?.deviceId || !context?.userId) {
      throw new Error('Tenant, device and user context are required for synchronization');
    }
    const changed = this.context && (
      this.context.tenantId !== context.tenantId || this.context.deviceId !== context.deviceId
    );
    if (changed) this.stop();
    if (changed) {
      this.edgeRevision = 0;
      this.edgeFailureCount = 0;
      this.edgeCircuitOpenUntil = 0;
      this.lastBootstrapAt = 0;
      this.edgeOperatorToken = null;
      this.modeController.reset();
    }
    this.context = { ...context };
    return this;
  }

  async start() {
    if (this.started || !this.context) return;
    this.started = true;
    const db = await getTenantDatabase(this.context.tenantId);
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    await db.syncOutbox
      .where('[tenantId+status]')
      .equals([this.context.tenantId, OUTBOX_STATUS.SYNCING])
      .filter((entry) => entry.updatedAt < staleBefore)
      .modify({ status: OUTBOX_STATUS.RETRYABLE_FAILED, lastError: 'Recovered after interrupted synchronization' });
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('focus', this.handleOnline);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('dine3d-offline-update-required', this.handleUpdateRequired);
    await this.refreshCounts();
    this.edgeProjectionTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.refreshEdgeProjection().catch(() => {});
    }, EDGE_PROJECTION_SAFETY_POLL_MS);
    this.schedule(0);
  }

  stop() {
    this.started = false;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.edgeProjectionTimer) clearInterval(this.edgeProjectionTimer);
    if (this.edgeSocketRetry) clearTimeout(this.edgeSocketRetry);
    this.edgeSocketRetry = null;
    if (this.edgeSocket) {
      this.edgeSocket.onclose = null;
      this.edgeSocket.close();
      this.edgeSocket = null;
    }
    this.timer = null;
    this.edgeProjectionTimer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('focus', this.handleOnline);
      window.removeEventListener('dine3d-offline-update-required', this.handleUpdateRequired);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  }

  schedule(delay = DEFAULT_INTERVAL_MS) {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run().catch(() => {}), Math.max(0, delay));
  }

  async refreshCounts() {
    if (!this.context) return;
    const db = await getTenantDatabase(this.context.tenantId);
    const [pendingCount, conflicts, failedCount] = await Promise.all([
      db.syncOutbox.where('[tenantId+status]')
        .anyOf(ACTIVE_OUTBOX_STATUSES.map((status) => [this.context.tenantId, status])).count(),
      db.syncConflicts.where('[tenantId+status]').equals([this.context.tenantId, 'open']).count(),
      db.syncOutbox.where('[tenantId+status]')
        .equals([this.context.tenantId, OUTBOX_STATUS.PERMANENTLY_FAILED]).count(),
    ]);
    this.publish({ pendingCount, conflictCount: conflicts, failedCount });
  }

  edgeCircuitOpen() {
    return this.edgeCircuitOpenUntil > Date.now();
  }

  recordEdgeSuccess() {
    this.edgeFailureCount = 0;
    this.edgeCircuitOpenUntil = 0;
  }

  recordEdgeFailure() {
    this.edgeFailureCount += 1;
    if (this.edgeFailureCount >= EDGE_CIRCUIT_FAILURE_THRESHOLD) {
      this.edgeCircuitOpenUntil = Date.now() + EDGE_CIRCUIT_COOLDOWN_MS;
    }
  }

  updateOperatingMode({ cloudReachable, edgeReachable, reconciliationComplete = false }) {
    const observation = this.modeController.observe({
      cloudReachable,
      edgeReachable,
      edgeConfigured: Boolean(this.context?.edge?.lanUrl),
      isPrimaryPos: this.context?.isPrimaryPos === true,
      reconciliationComplete,
      compatible: this.state.updateAvailable !== true,
    });
    const messages = {
      [OPERATING_MODE.INITIALIZING]: 'Checking Dine3D Cloud and the restaurant network.',
      [OPERATING_MODE.ONLINE]: edgeReachable
        ? 'Online. Operations commit through Dine3D Edge and synchronize to Cloud.'
        : 'Online with Dine3D Cloud.',
      [OPERATING_MODE.EDGE_MODE]: 'Operating locally through Dine3D Edge. Restaurant service may continue normally.',
      [OPERATING_MODE.CLOUD_FALLBACK]: 'Dine3D Edge is unavailable. This device is using Cloud fallback.',
      [OPERATING_MODE.EMERGENCY_PRIMARY]: 'Emergency offline mode. This designated Primary POS may continue safely.',
      [OPERATING_MODE.RECOVERY]: 'Connectivity restored. Replaying and reconciling saved restaurant operations.',
      [OPERATING_MODE.ISOLATED_RESTRICTED]: 'Restaurant network unavailable. Ordering is restricted on this device; use the Primary POS.',
      [OPERATING_MODE.UPDATE_REQUIRED]: 'This device must be updated before it can safely process operations.',
    };
    this.publish({
      operatingMode: observation.mode,
      operatingModeSince: observation.modeSince,
      modeMessage: messages[observation.mode],
      connectivity: {
        ...observation.health,
        edgeToCloud: this.state.edgeCloudOnline,
      },
    });
    return observation.mode;
  }

  async healthCheck() {
    const startedAt = Date.now();
    try {
      const health = await request(`/sync/health?deviceId=${encodeURIComponent(this.context.deviceId)}`);
      const completedAt = Date.now();
      if (health.minimumLocalSchemaVersion > OFFLINE_SCHEMA_VERSION || health.maximumLocalSchemaVersion < OFFLINE_SCHEMA_VERSION) {
        const error = new Error('This application version is not compatible with the server synchronization schema');
        error.code = 'SYNC_SCHEMA_INCOMPATIBLE';
        throw error;
      }
      const midpoint = startedAt + ((completedAt - startedAt) / 2);
      const clockOffsetMs = new Date(health.serverTime).getTime() - midpoint;
      this.publish({
        meaningfulOnline: health.database === 'connected',
        cloudOnline: health.database === 'connected',
        lastHealthCheckAt: new Date().toISOString(),
        clockOffsetMs: Math.round(clockOffsetMs),
      });
      const discoveredEdge = health.edge || null;
      if (JSON.stringify(discoveredEdge) !== JSON.stringify(this.context.edge || null)) {
        this.context.edge = discoveredEdge;
        await saveDeviceSyncConfiguration(this.context.tenantId, { edge: discoveredEdge });
      }
      this.publish({
        edgeConfigured: Boolean(discoveredEdge?.lanUrl),
        ...(!discoveredEdge?.lanUrl ? { edgeOnline: false, edgeConnection: 'not_configured' } : {}),
      });
      return health.database === 'connected';
    } catch (error) {
      if (error.status === 401 || error.code === 'SESSION_REVOKED') {
        this.publish({
          status: 'authentication_required',
          meaningfulOnline: true,
          message: 'Authentication is required before pending changes can synchronize',
        });
        await this.blockPendingByAuth();
        return false;
      }
      this.publish({
        status: error.code === 'SYNC_SCHEMA_INCOMPATIBLE' ? 'action_required' : 'offline',
        meaningfulOnline: false,
        cloudOnline: false,
        lastHealthCheckAt: new Date().toISOString(),
        message: error.code === 'SYNC_SCHEMA_INCOMPATIBLE'
          ? error.message
          : 'Offline—changes are safely stored on this device',
      });
      return false;
    }
  }

  async edgeHealthCheck({ force = false } = {}) {
    if (!this.context?.edge?.lanUrl || !this.context?.edgeAccessToken
      || this.context.edge?.capabilities?.encryptedJournal !== true) {
      this.publish({ edgeOnline: false, edgeConfigured: false, edgeConnection: 'not_configured', edgeCloudOnline: null });
      if (this.edgeSocket) { this.edgeSocket.close(); this.edgeSocket = null; }
      return false;
    }
    if (!force && this.edgeCircuitOpen()) {
      this.publish({ edgeOnline: false, edgeConfigured: true, edgeConnection: 'circuit_open' });
      return false;
    }
    this.publish({ edgeConfigured: true, edgeConnection: 'checking' });
    try {
      const edge = await edgeRequest(
        this.context.edge,
        '/health',
        this.context.edgeAccessToken,
        this.context.deviceId,
        {},
        2_500,
      );
      const valid = edge.service === 'dine3d-edge'
        && edge.restaurantId === this.context.tenantId
        && edge.locationId === this.context.locationId
        && edge.capabilities?.encryptedJournal === true;
      if (valid) this.recordEdgeSuccess();
      else this.recordEdgeFailure();
      this.publish({
        edgeOnline: valid,
        edgeConfigured: true,
        edgeConnection: valid ? 'connected' : 'unavailable',
        edgeCloudOnline: valid ? edge.cloud === 'online' : null,
      });
      if (valid && edge.capabilities?.secureEventStream === true) this.connectEdgeEvents();
      return valid;
    } catch (error) {
      this.recordEdgeFailure();
      let permission = 'unknown';
      try {
        permission = (await navigator.permissions?.query?.({ name: 'local-network-access' }))?.state || 'unknown';
      } catch {
        // The permission name is not implemented in every browser. The
        // connection can still work through the normal fetch permission flow.
      }
      this.publish({
        edgeOnline: false,
        edgeConfigured: true,
        edgeCloudOnline: null,
        edgeConnection: permission === 'denied' || error?.name === 'NotAllowedError'
          ? 'permission_denied'
          : permission === 'prompt'
            ? 'permission_required'
            : 'unavailable',
      });
      if (this.edgeSocket) { this.edgeSocket.close(); this.edgeSocket = null; }
      return false;
    }
  }

  connectEdgeEvents() {
    if (typeof WebSocket === 'undefined' || !this.context?.edge?.lanUrl || !this.context.edgeAccessToken) return;
    if (this.edgeSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.edgeSocket.readyState)) return;
    if (this.edgeSocketRetry) clearTimeout(this.edgeSocketRetry);
    const endpoint = new URL('/v1/events', this.context.edge.lanUrl);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(endpoint.toString(), [
      'dine3d.v1',
      `dine3d.device.${this.context.deviceId}`,
      `dine3d.token.${this.context.edgeAccessToken}`,
    ]);
    this.edgeSocket = socket;
    this.publish({ edgeEventStream: 'connecting' });
    socket.onopen = () => {
      this.recordEdgeSuccess();
      this.publish({ edgeEventStream: 'connected' });
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.restaurantId !== this.context.tenantId || message.locationId !== this.context.locationId) return;
        if (['branch.changed', 'sync.status', 'edge.connected'].includes(message.type)) {
          this.refreshEdgeProjection({ force: true }).catch(() => {});
        }
      } catch {
        // Ignore malformed event frames. The authenticated change-feed pull is
        // still the source of projection data.
      }
    };
    socket.onerror = () => this.publish({ edgeEventStream: 'unavailable' });
    socket.onclose = () => {
      if (this.edgeSocket === socket) this.edgeSocket = null;
      this.publish({ edgeEventStream: 'disconnected' });
      if (this.started && this.state.edgeOnline) {
        this.edgeSocketRetry = setTimeout(() => this.connectEdgeEvents(), 2_000);
      }
    };
  }

  async refreshEdgeProjection({ force = false } = {}) {
    if (this.edgeProjectionRunning || !this.context?.edge?.lanUrl
      || !this.context?.edgeAccessToken || (!force && !this.state.edgeOnline)
      || (!force && this.edgeCircuitOpen())) return [];
    this.edgeProjectionRunning = true;
    try {
      const response = await edgeRequest(
        this.context.edge,
        `/v1/branch/changes?after=${encodeURIComponent(this.edgeRevision)}`,
        this.context.edgeAccessToken,
        this.context.deviceId,
        {},
        2_500,
      );
      const nextRevision = Number(response.revision || this.edgeRevision || 0);
      this.recordEdgeSuccess();
      this.lastEdgeProjectionAt = Date.now();
      if (response.unchanged) {
        this.edgeRevision = nextRevision;
        return [];
      }
      const [orders, inventoryMovements] = await Promise.all([
        applyEdgeOrderProjection(this.context, response.orders || []),
        applyEdgeInventoryProjection(this.context, response.inventoryMovements || []),
      ]);
      this.edgeRevision = nextRevision;
      if (orders.length && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dine3d-edge-orders', {
          detail: { orders, revision: this.edgeRevision, receivedAt: new Date().toISOString() },
        }));
      }
      if (inventoryMovements.length && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dine3d-edge-inventory', {
          detail: { movements: inventoryMovements, revision: this.edgeRevision, receivedAt: new Date().toISOString() },
        }));
      }
      return orders;
    } catch (error) {
      this.recordEdgeFailure();
      throw error;
    } finally {
      this.edgeProjectionRunning = false;
    }
  }

  async connectLocal() {
    if (!this.context) return false;
    const cloudOnline = await this.healthCheck();
    const connected = await this.edgeHealthCheck();
    this.updateOperatingMode({ cloudReachable: cloudOnline, edgeReachable: connected });
    if (connected) {
      await this.refreshEdgeProjection({ force: true }).catch(() => {});
      this.schedule(0);
    }
    return connected;
  }

  async offlinePinLogin(pin) {
    if (!this.context?.edge?.lanUrl || !this.context?.edgeAccessToken) {
      const error = new Error('This branch does not have an available Dine3D Edge service.');
      error.code = 'EDGE_NOT_CONFIGURED';
      throw error;
    }
    const result = await edgeRequest(
      this.context.edge,
      '/v1/auth/pin',
      this.context.edgeAccessToken,
      this.context.deviceId,
      { method: 'POST', body: JSON.stringify({ pin: String(pin) }) },
      5_000,
    );
    this.edgeOperatorToken = result.token;
    this.context.operatorId = result.operator?.id || null;
    this.context.operatorSessionId = result.sessionId || null;
    return { ...result, offline: true };
  }

  async offlinePinLogout() {
    const token = this.edgeOperatorToken;
    this.edgeOperatorToken = null;
    if (this.context) {
      this.context.operatorId = null;
      this.context.operatorSessionId = null;
    }
    if (!token || !this.context?.edge?.lanUrl) return { success: true };
    return edgeRequest(
      this.context.edge,
      '/v1/auth/logout',
      this.context.edgeAccessToken,
      this.context.deviceId,
      { method: 'POST', headers: { 'X-Dine3D-Operator-Token': token }, body: '{}' },
      2_500,
    ).catch(() => ({ success: true }));
  }

  async queuePrint(jobType, payload, options = {}) {
    if (!this.state.edgeOnline || !this.context?.edge?.lanUrl) {
      const error = new Error('Edge printing is not available on this device.');
      error.code = 'EDGE_PRINT_UNAVAILABLE';
      throw error;
    }
    return edgeRequest(
      this.context.edge,
      '/v1/print/jobs',
      this.context.edgeAccessToken,
      this.context.deviceId,
      {
        method: 'POST',
        body: JSON.stringify({
          printJobId: options.printJobId || globalThis.crypto.randomUUID(),
          orderId: options.orderId || null,
          printerId: options.printerId || undefined,
          jobType,
          copies: options.copies || 1,
          payload,
        }),
      },
      5_000,
    );
  }

  async refreshBootstrap() {
    const bootstrap = await request(`/sync/bootstrap?deviceId=${encodeURIComponent(this.context.deviceId)}&localSchemaVersion=${OFFLINE_SCHEMA_VERSION}`);
    const locationId = this.context.locationId || bootstrap.locations?.find((item) => item.isPrimary)?.id || bootstrap.locations?.[0]?.id || null;
    this.context.locationId = locationId;
    this.context.offlineAccessToken = bootstrap.offlineAccessToken;
    this.context.deviceType = bootstrap.device?.deviceType || this.context.deviceType || 'POS';
    this.context.isPrimaryPos = bootstrap.device?.isPrimaryPos === true;
    this.context.emergencyEpoch = Number(bootstrap.device?.emergencyEpoch || 0);
    this.context.authorityPolicyVersion = Number(bootstrap.offlineAuthority?.policyVersion || 0);
    this.context.offlineAuthorityTrusted = this.context.authorityPolicyVersion >= 1;
    await saveDeviceSyncConfiguration(this.context.tenantId, {
      locationId,
      name: bootstrap.device?.name,
      deviceType: this.context.deviceType,
      isPrimaryPos: this.context.isPrimaryPos,
      emergencyEpoch: this.context.emergencyEpoch,
      capabilities: bootstrap.device?.capabilities || null,
    });
    await cacheBootstrap(bootstrap, { ...this.context, locationId });
    this.lastBootstrapAt = Date.now();
    return bootstrap;
  }

  async registerDevice() {
    const response = await request('/sync/devices/register', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: this.context.deviceId,
        locationId: this.context.locationId || null,
        name: this.context.deviceName || `Browser ${this.context.deviceId.slice(0, 8)}`,
        platform: typeof navigator !== 'undefined' ? navigator.platform || 'browser' : 'browser',
        appVersion: this.context.appVersion || 'web-1',
        localSchemaVersion: OFFLINE_SCHEMA_VERSION,
        deviceType: this.context.deviceType || 'POS',
        capabilities: this.context.capabilities || null,
        edgeAccessToken: this.context.edgeAccessToken || null,
      }),
    });
    this.context.locationId = response.device?.locationId || this.context.locationId || null;
    this.context.edgeAccessToken = response.edgeAccessToken;
    this.context.edge = response.edge || null;
    this.context.deviceType = response.device?.deviceType || this.context.deviceType || 'POS';
    this.context.isPrimaryPos = response.device?.isPrimaryPos === true;
    this.context.emergencyEpoch = Number(response.device?.emergencyEpoch || 0);
    await saveDeviceSyncConfiguration(this.context.tenantId, {
      locationId: this.context.locationId,
      edgeAccessToken: response.edgeAccessToken,
      edge: response.edge || null,
      name: response.device?.name,
      deviceType: this.context.deviceType,
      isPrimaryPos: this.context.isPrimaryPos,
      emergencyEpoch: this.context.emergencyEpoch,
      capabilities: response.device?.capabilities || null,
    });
    return response.device;
  }

  async blockPendingByAuth() {
    const db = await getTenantDatabase(this.context.tenantId);
    await db.syncOutbox.where('tenantId').equals(this.context.tenantId)
      .filter((entry) => ACTIVE_OUTBOX_STATUSES.includes(entry.status))
      .modify({ status: OUTBOX_STATUS.BLOCKED_BY_AUTH, updatedAt: new Date().toISOString() });
    await this.refreshCounts();
  }

  async getReadyBatch() {
    const db = await getTenantDatabase(this.context.tenantId);
    const now = Date.now();
    const readyStatuses = [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.EDGE_COMMITTED, OUTBOX_STATUS.RETRYABLE_FAILED, OUTBOX_STATUS.BLOCKED_BY_AUTH];
    // Read a bounded window from each indexed status partition. A terminal
    // with a large retained outbox must never materialize its entire history
    // just to assemble the next synchronization batch.
    const windows = await Promise.all(readyStatuses.map((status) => db.syncOutbox
      .where('[tenantId+status+localSequence]')
      .between(
        [this.context.tenantId, status, Dexie.minKey],
        [this.context.tenantId, status, Dexie.maxKey],
      )
      .filter((entry) => new Date(entry.nextRetryAt || 0).getTime() <= now)
      .limit(MAX_BATCH * readyStatuses.length)
      .toArray()));
    const candidates = windows.flat()
      .sort((a, b) => Number(a.localSequence || 0) - Number(b.localSequence || 0));
    const ready = [];
    let estimatedBytes = 0;
    for (const entry of candidates) {
      if (ready.length >= MAX_BATCH) break;
      const dependencies = await db.syncOutbox.bulkGet(entry.dependencyIds || []);
      if (dependencies.some((dependency) => !dependency || dependency.status !== OUTBOX_STATUS.ACKNOWLEDGED)) continue;
      const entryBytes = new Blob([JSON.stringify(entry)]).size;
      if (entryBytes > 900_000) {
        await db.syncOutbox.update(entry.operationId, {
          status: OUTBOX_STATUS.PERMANENTLY_FAILED,
          lastError: 'Operation exceeds the safe synchronization payload limit',
          updatedAt: new Date().toISOString(),
        });
        continue;
      }
      if (ready.length > 0 && estimatedBytes + entryBytes > MAX_BATCH_BYTES) break;
      ready.push(entry);
      estimatedBytes += entryBytes;
    }
    return ready;
  }

  async applyResult(entry, result) {
    const db = await getTenantDatabase(this.context.tenantId);
    const now = new Date().toISOString();
    if (result.status === 'acknowledged') {
      await db.syncOutbox.update(entry.operationId, {
        status: OUTBOX_STATUS.ACKNOWLEDGED,
        result: result.result || null,
        acknowledgedAt: now,
        updatedAt: now,
        lastError: null,
        statusDetail: null,
      });
      if (entry.entityType === 'Order') {
        const otherPending = await db.syncOutbox.where('entityId').equals(entry.entityId)
          .filter((candidate) => candidate.operationId !== entry.operationId && candidate.status !== OUTBOX_STATUS.ACKNOWLEDGED)
          .count();
        const acceptedVersion = result.result?.order?.stateVersion ?? result.result?.stateVersion ?? null;
        await db.orders.update(entry.entityId, {
          syncStatus: otherPending > 0 ? OUTBOX_STATUS.PENDING : 'synchronized',
          serverVersion: acceptedVersion,
          expectedServerVersion: acceptedVersion === null
            ? undefined
            : Math.max(Number(acceptedVersion), Number((await db.orders.get(entry.entityId))?.expectedServerVersion || acceptedVersion)),
          fulfilmentStatus: result.result?.order?.status || undefined,
          paymentState: result.result?.order?.paymentStatus || undefined,
          orderNumber: result.result?.order?.orderNumber || result.result?.orderNumber || undefined,
          serverAcceptedAt: result.result?.order?.serverAcceptedAt || now,
          updatedAt: now,
        });
        if (result.result?.payment?.id) {
          await db.payments.update(result.result.payment.id, { syncStatus: 'synchronized', serverVersion: 1, updatedAt: now });
        }
      }
      if (entry.entityType === 'Payment') {
        await db.payments.update(entry.entityId, { syncStatus: 'synchronized', serverVersion: 1, updatedAt: now });
        if (entry.payload?.payment?.orderId) {
          await db.orders.update(entry.payload.payment.orderId, { paymentState: 'PAID', paymentStatus: 'PAID', updatedAt: now });
        }
      }
      if (entry.entityType === 'InventoryMovement') {
        await db.inventoryMovements.update(entry.entityId, { syncStatus: 'synchronized', updatedAt: now });
        const itemId = entry.payload?.inventoryItemId;
        if (itemId && result.result?.currentStock !== undefined) {
          await db.inventorySnapshots.update(itemId, {
            currentStock: result.result.currentStock,
            estimated: false,
            serverVersion: result.result.stateVersion || null,
            syncStatus: 'synchronized',
            updatedAt: now,
          });
        }
      }
      if (entry.entityType === 'PurchaseReceipt') {
        await db.purchaseReceipts.update(entry.entityId, { syncStatus: 'synchronized', serverVersion: 1, updatedAt: now });
        const movements = await db.inventoryMovements.where('tenantId').equals(this.context.tenantId)
          .filter((movement) => movement.operationId === entry.operationId).toArray();
        await Promise.all(movements.map((movement) => db.inventoryMovements.update(movement.id, { syncStatus: 'synchronized', updatedAt: now })));
        const po = result.result?.purchaseOrder;
        if (po?.id) await db.cachedPurchaseOrders.put({ ...po, tenantId: this.context.tenantId, restaurantId: this.context.tenantId, syncStatus: 'synchronized', updatedAt: now });
      }
      if (entry.entityType === 'OperationalNote') {
        await db.operationalNotes.update(entry.entityId, { syncStatus: 'synchronized', serverVersion: 1, updatedAt: now });
      }
      return;
    }

    if (result.status === 'conflict') {
      await db.syncOutbox.update(entry.operationId, {
        status: OUTBOX_STATUS.CONFLICT,
        lastError: result.error || 'Conflict requires review',
        statusDetail: null,
        updatedAt: now,
      });
      await db.syncConflicts.put({
        id: result.conflict?.id || entry.operationId,
        operationId: entry.operationId,
        tenantId: this.context.tenantId,
        restaurantId: this.context.tenantId,
        locationId: entry.locationId,
        deviceId: this.context.deviceId,
        entityId: entry.entityId,
        entityType: entry.entityType,
        status: 'open',
        localValue: entry.payload,
        serverValue: result.conflict?.serverValue || null,
        baseVersion: result.conflict?.baseVersion || null,
        serverVersion: result.conflict?.serverVersion || null,
        conflictType: result.conflict?.conflictType || 'VERSION_MISMATCH',
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    if (result.status === 'blocked_by_auth') {
      await db.syncOutbox.update(entry.operationId, {
        status: OUTBOX_STATUS.BLOCKED_BY_AUTH,
        lastError: result.error || 'Authentication or offline authorization requires attention',
        statusDetail: null,
        updatedAt: now,
      });
      return;
    }

    if (result.status === 'edge_accepted') {
      await db.syncOutbox.update(entry.operationId, {
        status: OUTBOX_STATUS.EDGE_COMMITTED,
        nextRetryAt: new Date(Date.now() + EDGE_RETRY_MS).toISOString(),
        lastError: null,
        statusDetail: 'Committed to this restaurant through Dine3D Edge; Cloud delivery is pending',
        edgeAcceptedAt: entry.edgeAcceptedAt || now,
        updatedAt: now,
      });
      return;
    }

    const retryable = result.status === 'retryable_failed';
    const retryCount = Number(entry.retryCount || 0) + 1;
    await db.syncOutbox.update(entry.operationId, {
      status: retryable ? OUTBOX_STATUS.RETRYABLE_FAILED : OUTBOX_STATUS.PERMANENTLY_FAILED,
      retryCount,
      nextRetryAt: new Date(Date.now() + jitteredBackoff(retryCount)).toISOString(),
      lastError: result.error || result.code || 'Synchronization failed',
      statusDetail: null,
      updatedAt: now,
    });
  }

  batchPayload(batch, now) {
    return {
      deviceId: this.context.deviceId,
      localSchemaVersion: OFFLINE_SCHEMA_VERSION,
      clientTimestamp: now,
      operations: batch.map((entry) => ({
        operationId: entry.operationId,
        entityId: entry.entityId,
        entityType: entry.entityType,
        operationType: entry.operationType,
        tenantId: entry.tenantId,
        locationId: entry.locationId,
        deviceId: entry.deviceId,
        userId: entry.userId,
        operatorId: entry.operatorId || null,
        operatorSessionId: entry.operatorSessionId || null,
        payload: entry.payload,
        localSequence: entry.localSequence,
        dependencyIds: entry.dependencyIds || [],
        clientCreatedAt: entry.createdAt,
        deviceTimezone: entry.deviceTimezone,
        clockOffsetMs: this.state.clockOffsetMs,
        offlineAccessToken: entry.offlineAccessToken || this.context.offlineAccessToken,
        operatingMode: entry.operatingMode || null,
        emergencyEpoch: Number.isSafeInteger(entry.emergencyEpoch) ? entry.emergencyEpoch : null,
      })),
    };
  }

  async processBatch(batch, cloudOnline = true) {
    const db = await getTenantDatabase(this.context.tenantId);
    const now = new Date().toISOString();
    await db.transaction('rw', db.syncOutbox, async () => {
      for (const entry of batch) {
        await db.syncOutbox.update(entry.operationId, { status: OUTBOX_STATUS.SYNCING, updatedAt: now });
      }
    });

    try {
      const payload = this.batchPayload(batch, now);
      let response;
      let transport = 'cloud';
      if (this.state.edgeOnline && !this.edgeCircuitOpen()) {
        try {
          response = await edgeRequest(
            this.context.edge,
            '/v1/sync/operations',
            this.context.edgeAccessToken,
            this.context.deviceId,
            {
              method: 'POST',
              body: JSON.stringify(payload),
              headers: this.edgeOperatorToken ? { 'X-Dine3D-Operator-Token': this.edgeOperatorToken } : {},
            },
          );
          transport = 'edge';
        } catch (edgeError) {
          this.recordEdgeFailure();
          this.publish({ edgeOnline: false });
          // An Edge-issued operator session is intentionally not transferable
          // to Cloud. Falling through here would execute under the broader
          // parent browser session and could bypass the PIN operator's RBAC.
          if (this.edgeOperatorToken) throw edgeError;
          if (!cloudOnline) throw edgeError;
        }
      }
      if (!response) {
        if (!cloudOnline) throw new Error('Cloud and Edge are both unavailable; changes remain stored on this device');
        response = await request('/sync/operations', { method: 'POST', body: JSON.stringify(payload) });
      }
      const byId = new Map((response.results || []).map((result) => [result.operationId, result]));
      for (const entry of batch) {
        await this.applyResult(entry, byId.get(entry.operationId) || {
          status: 'retryable_failed', error: 'Server omitted an operation result',
        });
      }
      this.publish({
        ...(response.results?.some((result) => result.status === 'acknowledged')
          ? { lastSuccessfulSyncAt: response.serverTime || new Date().toISOString() }
          : {}),
        transport,
      });
    } catch (error) {
      const authFailure = error.status === 401 || error.status === 403;
      for (const entry of batch) {
        const retryCount = Number(entry.retryCount || 0) + 1;
        await db.syncOutbox.update(entry.operationId, {
          status: authFailure ? OUTBOX_STATUS.BLOCKED_BY_AUTH : OUTBOX_STATUS.RETRYABLE_FAILED,
          retryCount,
          nextRetryAt: new Date(Date.now() + jitteredBackoff(retryCount)).toISOString(),
          lastError: error.message,
          statusDetail: null,
          updatedAt: new Date().toISOString(),
        });
      }
      if (authFailure) {
        this.publish({ status: 'authentication_required', message: 'Authentication is required to synchronize saved changes' });
      } else {
        this.publish({ status: 'sync_delayed', meaningfulOnline: false, message: 'Synchronization is delayed; changes remain stored on this device' });
      }
    }
  }

  leaseKey() {
    return `dine3d-sync-lease:${this.context.tenantId}:${this.context.deviceId}`;
  }

  async withFallbackLease(work) {
    const key = this.leaseKey();
    const db = await getTenantDatabase(this.context.tenantId);
    const acquired = await db.transaction('rw', db.metadata, async () => {
      const now = Date.now();
      const lease = await db.metadata.get(key);
      if (lease && lease.owner !== this.tabId && Number(lease.expiresAt || 0) > now) return false;
      await db.metadata.put({
        id: key,
        tenantId: this.context.tenantId,
        owner: this.tabId,
        expiresAt: now + LEASE_MS,
        updatedAt: new Date(now).toISOString(),
      });
      return true;
    });
    if (!acquired) return false;

    const renew = setInterval(() => {
      db.transaction('rw', db.metadata, async () => {
        const lease = await db.metadata.get(key);
        if (lease?.owner !== this.tabId) return;
        const now = Date.now();
        await db.metadata.put({ ...lease, expiresAt: now + LEASE_MS, updatedAt: new Date(now).toISOString() });
      }).catch(() => {});
    }, Math.floor(LEASE_MS / 3));
    try {
      await work();
      return true;
    } finally {
      clearInterval(renew);
      await db.transaction('rw', db.metadata, async () => {
        const current = await db.metadata.get(key);
        if (current?.owner === this.tabId) await db.metadata.delete(key);
      }).catch(() => {});
    }
  }

  /**
   * One tab at a time talks to the server.
   *
   * On the timer that is exactly right: ten open tabs must not each poll. But
   * a person pressing "Sync now" is not the timer, and giving up silently
   * because a background tab held the lock is how the button came to do
   * nothing at all. `wait` is what an explicit action passes: take a turn in
   * the queue rather than walking away.
   */
  async withLeader(work, { wait = false, timeoutMs = LEADER_WAIT_MS } = {}) {
    const name = `dine3d-sync:${this.context.tenantId}:${this.context.deviceId}`;
    if (navigator.locks?.request) {
      let acquired = false;
      const controller = wait && typeof AbortController !== 'undefined' ? new AbortController() : null;
      const expiry = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        await navigator.locks.request(
          name,
          controller ? { mode: 'exclusive', signal: controller.signal } : { ifAvailable: true, mode: 'exclusive' },
          async (lock) => {
            if (!lock) return;
            acquired = true;
            await work();
          },
        );
      } catch (error) {
        // Waiting too long for another tab is not a synchronisation failure:
        // the work is still queued locally and the other tab is doing it.
        if (error?.name === 'AbortError') return false;
        throw error;
      } finally {
        if (expiry) clearTimeout(expiry);
      }
      return acquired;
    }
    return this.withFallbackLease(work);
  }

  /** Wait for a run already in flight, so a click reports that run's outcome. */
  async waitForIdle(timeoutMs = LEADER_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return !this.running;
  }

  async run({ waitForLeader = false, timeoutMs = LEADER_WAIT_MS } = {}) {
    if (!this.started || this.running || !this.context) return false;
    this.running = true;
    let ledWork = false;
    try {
      ledWork = await this.withLeader(async () => {
        const priorCloudOnline = this.state.cloudOnline;
        const edgeCheck = this.context?.edge?.lanUrl ? this.edgeHealthCheck() : null;
        const cloudOnline = await this.healthCheck();
        const edgeOnline = edgeCheck ? await edgeCheck : await this.edgeHealthCheck();
        this.updateOperatingMode({ cloudReachable: cloudOnline, edgeReachable: edgeOnline });
        if (!cloudOnline && !edgeOnline) {
          // Returning quietly here left `status` at whatever the last
          // successful run concluded, so the header went on saying "Online and
          // synchronized" with the cable out. The `offline` presentation has
          // always existed; nothing ever set it.
          this.publish({
            status: 'offline',
            meaningfulOnline: false,
            cloudOnline: false,
            edgeOnline: false,
            lastHealthCheckAt: new Date().toISOString(),
            message: this.state.pendingCount > 0
              ? 'No connection. Saved changes stay on this device until it returns.'
              : 'No connection to Dine3D. Orders you take are saved on this device.',
          });
          return;
        }
        this.publish({ status: 'syncing', message: edgeOnline ? 'Synchronizing through Dine3D Edge' : 'Synchronizing with cloud' });
        const recoveredCloud = priorCloudOnline === false && cloudOnline;
        if (cloudOnline && (recoveredCloud || !this.lastBootstrapAt
          || Date.now() - this.lastBootstrapAt >= BOOTSTRAP_REFRESH_INTERVAL_MS)) {
          await this.refreshBootstrap().catch((error) => {
            if (error.status === 401) throw error;
          });
        }
        let batch = await this.getReadyBatch();
        let batches = 0;
        while (batch.length && batches < 5) {
          await this.processBatch(batch, cloudOnline);
          batches += 1;
          batch = await this.getReadyBatch();
        }
        this.updateOperatingMode({
          cloudReachable: cloudOnline,
          edgeReachable: edgeOnline,
          reconciliationComplete: this.state.pendingCount === 0
            && this.state.conflictCount === 0
            && this.state.failedCount === 0,
        });
        if (this.state.conflictCount > 0 || this.state.failedCount > 0) {
          this.publish({ status: 'action_required', message: 'Synchronization needs attention' });
        } else if (this.state.pendingCount > 0) {
          this.publish({
            status: edgeOnline && !cloudOnline ? 'edge_buffered' : 'sync_delayed',
            message: edgeOnline && !cloudOnline
              ? 'Changes are encrypted on Edge and will upload automatically'
              : 'Some changes are waiting to synchronize',
          });
        } else if (edgeOnline && !cloudOnline) {
          this.publish({ status: 'edge_ready', message: 'Edge is online; cloud delivery is automatic', transport: 'edge' });
        } else {
          this.publish({ status: 'synchronized', message: 'Synchronized with server', lastSuccessfulSyncAt: new Date().toISOString() });
        }
      }, { wait: waitForLeader, timeoutMs });
    } catch (error) {
      this.publish({
        status: error.status === 401 ? 'authentication_required' : 'sync_delayed',
        message: error.message || 'Synchronization is delayed',
      });
    } finally {
      this.running = false;
      await this.refreshCounts().catch(() => {});
      this.schedule(this.state.operatingMode === OPERATING_MODE.INITIALIZING ? 2_000 : DEFAULT_INTERVAL_MS);
    }
    return ledWork;
  }

  /**
   * The button, as opposed to the timer.
   *
   * Two things made this silently do nothing. A run already in flight made it
   * return the previous run's conclusion immediately, and a lock held by
   * another tab made it skip the work entirely — in both cases the page then
   * announced "All saved changes are synchronized" without anything having
   * been sent. Now it waits its turn and reports what actually happened.
   *
   * `ran` tells the caller whether this call did the work, so the screen can
   * distinguish "synchronized" from "still waiting for another window".
   */
  async syncNow({ timeoutMs = LEADER_WAIT_MS } = {}) {
    if (!this.started) await this.start();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    if (this.running) {
      // Another run is mid-flight in this tab; it is doing the same work.
      const settled = await this.waitForIdle(timeoutMs);
      return { ...this.state, ran: settled };
    }

    const ran = await this.run({ waitForLeader: true, timeoutMs });
    return { ...this.state, ran };
  }

  async pendingCount() {
    return this.context ? countPendingOperations(this.context.tenantId) : 0;
  }
}

export const syncEngine = new SyncEngine();
