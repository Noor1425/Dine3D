'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  OFFLINE_SCHEMA_VERSION,
  countPendingOperations,
  cacheServerOrders,
  enqueueCashPayment,
  enqueueInventoryAdjustment,
  enqueueOperationalNote,
  enqueueOrder,
  enqueueOrderTransition,
  enqueuePurchaseReceipt,
  ensureDeviceIdentity,
  getCachedBootstrap,
  getSyncDiagnostics,
  getValidOfflineAccess,
  applyConflictResolution,
  readOfflineTokenClaims,
  setOfflineVaultLocked,
} from '@/lib/offline/database';
import { syncEngine } from '@/lib/offline/syncEngine';
import { OPERATING_MODE, OPERATING_MODE_PRESENTATION, operationPolicy } from '@/lib/offline/operatingMode';

const OfflineContext = createContext(null);

const PRESENTATION = {
  synchronized: { dot: 'bg-emerald-500', label: 'Online and synchronized' },
  syncing: { dot: 'bg-blue-500 animate-pulse', label: 'Online and syncing' },
  offline: { dot: 'bg-slate-500', label: 'Offline—changes stored on this device' },
  sync_delayed: { dot: 'bg-amber-500', label: 'Sync delayed' },
  action_required: { dot: 'bg-red-500', label: 'Action required' },
  edge_buffered: { dot: 'bg-violet-500 animate-pulse', label: 'Saved on Edge—cloud upload pending' },
  edge_ready: { dot: 'bg-violet-500', label: 'Edge online—cloud managed' },
  authentication_required: { dot: 'bg-red-500', label: 'Authentication required' },
  initializing: { dot: 'bg-slate-400 animate-pulse', label: 'Preparing offline access' },
};

export function OfflineProvider({ restaurant, user, children }) {
  const [state, setState] = useState(syncEngine.state);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [initializationError, setInitializationError] = useState(null);
  const contextRef = useRef(null);

  useEffect(() => syncEngine.subscribe(setState), []);

  useEffect(() => {
    if (!restaurant?.id || !user?.id) return undefined;
    let cancelled = false;
    const initialize = async () => {
      try {
        const identity = await ensureDeviceIdentity(restaurant.id, user.id, {
          name: `${restaurant.name || 'Restaurant'} POS`,
        });
        if (cancelled) return;
        setDevice(identity);
        const baseContext = {
          tenantId: restaurant.id,
          restaurantId: restaurant.id,
          locationId: identity.locationId || null,
          deviceId: identity.deviceId,
          deviceName: identity.name,
          userId: user.id,
          role: user.role,
          appVersion: 'web-1',
          localSchemaVersion: OFFLINE_SCHEMA_VERSION,
          edgeAccessToken: identity.edgeAccessToken || null,
          edge: identity.edge || null,
          deviceType: identity.deviceType || 'POS',
          isPrimaryPos: identity.isPrimaryPos === true,
          emergencyEpoch: Number(identity.emergencyEpoch || 0),
          capabilities: identity.capabilities || null,
        };
        syncEngine.configure(baseContext);
        contextRef.current = baseContext;
        try {
          const registered = await syncEngine.registerDevice();
          baseContext.locationId = registered?.locationId || baseContext.locationId;
          if (!cancelled) setDevice((current) => ({ ...current, ...registered }));
          const fresh = await syncEngine.refreshBootstrap();
          baseContext.locationId = syncEngine.context.locationId;
          baseContext.offlineAccessToken = fresh.offlineAccessToken;
          baseContext.deviceType = syncEngine.context.deviceType;
          baseContext.isPrimaryPos = syncEngine.context.isPrimaryPos;
          baseContext.emergencyEpoch = syncEngine.context.emergencyEpoch;
          baseContext.authorityPolicyVersion = Number(fresh.offlineAuthority?.policyVersion || readOfflineTokenClaims(fresh.offlineAccessToken)?.authorityPolicyVersion || 0);
          // This snapshot arrived through the authenticated cloud session. A
          // later cold offline start must independently verify the cached JWT.
          baseContext.offlineAuthorityTrusted = baseContext.authorityPolicyVersion >= 1;
          contextRef.current = { ...baseContext };
          setBootstrap(fresh);
          await setOfflineVaultLocked(restaurant.id, false, { userId: user.id, reason: 'Authenticated online session verified' });
        } catch (networkError) {
          const cached = await getValidOfflineAccess(restaurant.id);
          if (!cached) throw networkError;
          baseContext.locationId = cached.claims.locationId || identity.locationId || null;
          baseContext.offlineAccessToken = cached.token;
          baseContext.deviceType = cached.claims.deviceType || identity.deviceType || 'POS';
          baseContext.isPrimaryPos = cached.claims.isPrimaryPos === true;
          baseContext.emergencyEpoch = Number(cached.claims.emergencyEpoch || 0);
          baseContext.authorityPolicyVersion = Number(cached.claims.authorityPolicyVersion || 0);
          baseContext.offlineAuthorityTrusted = cached.trustedAuthority === true;
          syncEngine.configure(baseContext);
          contextRef.current = { ...baseContext };
          setBootstrap(cached);
        }
        await syncEngine.start();
        if (!cancelled) setReady(true);
      } catch (error) {
        if (cancelled) return;
        setInitializationError({
          code: error.code || 'OFFLINE_INITIALIZATION_FAILED',
          message: error.message || 'Offline storage could not be initialized',
        });
        syncEngine.publish({ status: 'action_required', message: error.message || 'Offline storage needs attention' });
      }
    };
    initialize();
    return () => {
      cancelled = true;
      syncEngine.stop();
    };
  }, [restaurant?.id, restaurant?.name, user?.id, user?.role]);

  const afterMutation = useCallback(async () => {
    await syncEngine.refreshCounts();
    syncEngine.schedule(0);
  }, []);

  const assertCanCapture = useCallback((featureKey = null) => {
    if (!contextRef.current) throw new Error('Offline storage is not ready');
    const latestToken = syncEngine.context?.offlineAccessToken || contextRef.current.offlineAccessToken;
    const claims = readOfflineTokenClaims(latestToken);
    // "No claims at all" and "claims that have expired" are different faults
    // with different fixes, and reporting both as an expired window sends
    // staff to re-authenticate when the real problem is that this terminal was
    // never authorized for a branch.
    if (!claims) {
      const error = new Error('This terminal is not authorized for a branch yet. Select a branch, then reload the page.');
      error.code = 'OFFLINE_DEVICE_NOT_AUTHORIZED';
      throw error;
    }
    if (Number(claims.exp || 0) * 1000 <= Date.now()) {
      const error = new Error('The authorized offline access window has ended. Reconnect and sign in again; saved records remain on this device.');
      error.code = 'OFFLINE_ACCESS_EXPIRED';
      throw error;
    }
    if (claims.entitlements?.operational !== true) {
      throw new Error('The last verified subscription state does not allow new operational records. Existing saved records remain protected.');
    }
    if (featureKey && claims.entitlements?.features?.[featureKey]?.allowed !== true) {
      throw new Error('This operation is not included in the last verified feature access snapshot.');
    }
    const mode = syncEngine.state.operatingMode || OPERATING_MODE.INITIALIZING;
    const authorityPolicyVersion = Number(claims.authorityPolicyVersion || 0);
    const deviceType = claims.deviceType || syncEngine.context?.deviceType || contextRef.current.deviceType || 'POS';
    const policy = operationPolicy(mode, deviceType);
    if (mode === OPERATING_MODE.EMERGENCY_PRIMARY && authorityPolicyVersion < 1) {
      const error = new Error('This terminal needs a new signed Primary POS authorization before emergency operation. Reconnect to Dine3D Cloud.');
      error.code = 'OFFLINE_AUTHORITY_UPGRADE_REQUIRED';
      throw error;
    }
    if (authorityPolicyVersion >= 1 && contextRef.current.offlineAuthorityTrusted !== true) {
      const error = new Error('Offline Primary POS authority could not be cryptographically verified on this device. Reconnect before committing operations.');
      error.code = 'OFFLINE_AUTHORITY_UNVERIFIED';
      throw error;
    }
    if (!policy.canCommit) {
      const error = new Error(policy.reason || 'This device cannot commit operations in the current restaurant mode.');
      error.code = 'DEVICE_AUTHORITY_RESTRICTED';
      throw error;
    }
    contextRef.current = {
      ...contextRef.current,
      locationId: syncEngine.context?.locationId || contextRef.current.locationId,
      offlineAccessToken: latestToken,
      deviceType,
      isPrimaryPos: claims.isPrimaryPos === true,
      emergencyEpoch: Number(claims.emergencyEpoch || 0),
      authorityPolicyVersion,
      operatingMode: mode,
    };
    return contextRef.current;
  }, []);

  const readDiagnostics = useCallback(() => {
    if (!restaurant?.id) return Promise.resolve({ outbox: [], conflicts: [], devices: [], checkpoints: [] });
    return getSyncDiagnostics(restaurant.id);
  }, [restaurant?.id, user?.id]);
  const readCachedBootstrap = useCallback(() => restaurant?.id ? getCachedBootstrap(restaurant.id) : Promise.resolve(null), [restaurant?.id]);

  const saveOrder = useCallback(async (draft) => {
    const context = assertCanCapture('pos_orders');
    const result = await enqueueOrder(context, draft);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  const transitionOrder = useCallback(async (orderId, toStatus, options) => {
    const context = assertCanCapture('pos_orders');
    const result = await enqueueOrderTransition(context, orderId, toStatus, options);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  const adjustInventory = useCallback(async (adjustment) => {
    const context = assertCanCapture('inventory_management');
    const result = await enqueueInventoryAdjustment(context, adjustment);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  /** Name the rider for a delivery taken while the connection was down. */
  const assignDeliveryRider = useCallback(async (assignment) => {
    const context = assertCanCapture('pos_orders');
    const { enqueueDeliveryAssignment } = await import('@/lib/offline/database');
    const result = await enqueueDeliveryAssignment(context, assignment);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  /** Riders cached on this device, so the till's selector is never empty. */
  const getCachedRiders = useCallback(async (branchId = null) => {
    if (!syncEngine.context?.tenantId) return [];
    const { getCachedRiders: read } = await import('@/lib/offline/database');
    return read(syncEngine.context.tenantId, branchId).catch(() => []);
  }, []);

  const recordCashPayment = useCallback(async (orderId, payment) => {
    const context = assertCanCapture('pos_orders');
    const result = await enqueueCashPayment(context, orderId, payment);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  const cacheOrders = useCallback(async (orders) => {
    if (!contextRef.current) return;
    await cacheServerOrders(contextRef.current, orders);
  }, []);

  const saveOperationalNote = useCallback(async (body) => {
    const context = assertCanCapture();
    const result = await enqueueOperationalNote(context, body);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  const receivePurchaseOrder = useCallback(async (receipt) => {
    assertCanCapture('inventory_management');
    const context = assertCanCapture('purchase_orders');
    const result = await enqueuePurchaseReceipt(context, receipt);
    await afterMutation();
    return result;
  }, [afterMutation, assertCanCapture]);

  const resolveConflict = useCallback(async (conflictId, resolution, reason) => {
    if (!contextRef.current) throw new Error('Offline storage is not ready');
    if (!syncEngine.state.meaningfulOnline) throw new Error('Conflict resolution requires an online connection');
    const result = await apiRequestConflict(conflictId, resolution, reason);
    await applyConflictResolution(contextRef.current.tenantId, result);
    await syncEngine.refreshBootstrap();
    await syncEngine.refreshCounts();
    return result;
  }, []);

  const offlinePinLogin = useCallback(async (pin) => {
    const result = await syncEngine.offlinePinLogin(pin);
    contextRef.current = {
      ...contextRef.current,
      operatorId: result.operator?.id || null,
      operatorSessionId: result.sessionId || null,
    };
    return result;
  }, []);

  const offlinePinLogout = useCallback(async () => {
    const result = await syncEngine.offlinePinLogout();
    contextRef.current = { ...contextRef.current, operatorId: null, operatorSessionId: null };
    return result;
  }, []);

  useEffect(() => {
    if (!restaurant?.id) return undefined;
    window.dine3dOffline = {
      syncNow: () => syncEngine.syncNow(),
      getDiagnostics: () => getSyncDiagnostics(restaurant.id),
      getCachedBootstrap: () => getCachedBootstrap(restaurant.id),
      prepareLogout: async () => {
        let pending = await countPendingOperations(restaurant.id);
        if (pending > 0 && syncEngine.state.meaningfulOnline) {
          await syncEngine.syncNow().catch(() => {});
          pending = await countPendingOperations(restaurant.id);
        }
        if (pending > 0) {
          const confirmed = window.confirm(
            `${pending} operation${pending === 1 ? '' : 's'} are still stored on this device and have not reached the server. `
            + 'Logging out will preserve them, but another user cannot synchronize them until this account signs in again. Continue?'
          );
          if (!confirmed) return false;
        }
        await setOfflineVaultLocked(restaurant.id, true, { userId: user.id, reason: 'Explicit logout' });
        return true;
      },
      lockVault: () => setOfflineVaultLocked(restaurant.id, true, { userId: user.id, reason: 'Session invalidated' }),
    };
    return () => {
      delete window.dine3dOffline;
    };
  }, [restaurant?.id]);

  const value = useMemo(() => ({
    state,
    ready,
    device,
    bootstrap,
    initializationError,
    context: contextRef.current,
    syncNow: () => syncEngine.syncNow(),
    connectLocal: () => syncEngine.connectLocal(),
    offlinePinLogin,
    offlinePinLogout,
    queuePrint: (jobType, payload, options) => syncEngine.queuePrint(jobType, payload, options),
    refreshEdgeOrders: () => syncEngine.refreshEdgeProjection({ force: true }),
    getDiagnostics: readDiagnostics,
    getCachedBootstrap: readCachedBootstrap,
    saveOrder,
    transitionOrder,
    recordCashPayment,
    cacheOrders,
    adjustInventory,
    assignDeliveryRider,
    getCachedRiders,
    saveOperationalNote,
    receivePurchaseOrder,
    resolveConflict,
    isMeaningfullyOnline: state.meaningfulOnline,
  }), [state, ready, device, bootstrap, initializationError, restaurant?.id, readDiagnostics, readCachedBootstrap, saveOrder, transitionOrder, recordCashPayment, cacheOrders, adjustInventory, saveOperationalNote, receivePurchaseOrder, resolveConflict, offlinePinLogin, offlinePinLogout]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

async function apiRequestConflict(conflictId, resolution, reason) {
  const { default: api } = await import('@/lib/api');
  return api.post(`/sync/conflicts/${conflictId}/resolve`, { resolution, reason });
}

export function useOffline() {
  const context = useContext(OfflineContext);
  if (!context) throw new Error('useOffline must be used inside OfflineProvider');
  return context;
}

export function SyncStatusIndicator({ compact = false }) {
  const offline = useOffline();
  const meta = PRESENTATION[offline.state.status] || PRESENTATION.initializing;
  const modeMeta = OPERATING_MODE_PRESENTATION[offline.state.operatingMode]
    || OPERATING_MODE_PRESENTATION[OPERATING_MODE.INITIALIZING];
  const modeDots = {
    green: 'bg-emerald-500', yellow: 'bg-amber-500', blue: 'bg-blue-500',
    red: 'bg-red-500', purple: 'bg-violet-500 animate-pulse', slate: 'bg-slate-400 animate-pulse',
  };
  const modeIsAuthoritative = offline.state.operatingMode && offline.state.operatingMode !== OPERATING_MODE.INITIALIZING;
  const label = modeIsAuthoritative ? modeMeta.label : meta.label;
  const dot = modeIsAuthoritative ? modeDots[modeMeta.tone] : meta.dot;
  return (
    <Link
      href="/admin/sync"
      className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      aria-label={`${label}. ${offline.state.pendingCount} pending operations. Open synchronization details.`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold text-slate-800">{label}</span>
          <span className="block text-[10px] text-slate-500">
            {offline.state.pendingCount > 0
              ? `${offline.state.pendingCount} waiting`
              : offline.state.lastSuccessfulSyncAt
                ? `Last sync ${new Date(offline.state.lastSuccessfulSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'No pending changes'}
          </span>
        </span>
      )}
    </Link>
  );
}

export function OperatingModeBanner() {
  const offline = useOffline();
  const mode = offline.state.operatingMode;
  if (!mode || [OPERATING_MODE.INITIALIZING, OPERATING_MODE.ONLINE].includes(mode)) return null;
  const styles = {
    [OPERATING_MODE.EDGE_MODE]: 'border-amber-300 bg-amber-50 text-amber-950',
    [OPERATING_MODE.CLOUD_FALLBACK]: 'border-blue-300 bg-blue-50 text-blue-950',
    [OPERATING_MODE.EMERGENCY_PRIMARY]: 'border-red-400 bg-red-700 text-white',
    [OPERATING_MODE.RECOVERY]: 'border-violet-300 bg-violet-50 text-violet-950',
    [OPERATING_MODE.ISOLATED_RESTRICTED]: 'border-red-300 bg-red-50 text-red-950',
    [OPERATING_MODE.UPDATE_REQUIRED]: 'border-red-300 bg-red-50 text-red-950',
  };
  return (
    <div role={mode === OPERATING_MODE.EMERGENCY_PRIMARY || mode === OPERATING_MODE.ISOLATED_RESTRICTED ? 'alert' : 'status'} className={`border-b px-4 py-2.5 text-center text-xs font-bold ${styles[mode] || styles[OPERATING_MODE.CLOUD_FALLBACK]}`}>
      <span className="uppercase tracking-[0.14em]">{String(mode).replaceAll('_', ' ')}</span>
      <span className="mx-2 opacity-50">·</span>
      <span>{offline.state.modeMessage}</span>
      {offline.state.pendingCount > 0 && <span className="ml-2">{offline.state.pendingCount} operation{offline.state.pendingCount === 1 ? '' : 's'} waiting.</span>}
    </div>
  );
}
