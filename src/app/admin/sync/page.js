'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useOffline } from '@/components/offline/OfflineProvider';
import { exportTenantOfflineData, resetTenantOfflineData } from '@/lib/offline/database';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

const BADGE = {
  acknowledged: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-blue-100 text-blue-800',
  edge_committed: 'bg-violet-100 text-violet-800',
  syncing: 'bg-blue-100 text-blue-800',
  retryable_failed: 'bg-amber-100 text-amber-800',
  blocked_by_auth: 'bg-red-100 text-red-800',
  permanently_failed: 'bg-red-100 text-red-800',
  conflict: 'bg-red-100 text-red-800',
};

export default function SynchronizationDiagnosticsPage() {
  const { can } = useAdminAccess();
  const canSynchronize = can('sync.operations');
  const canResolveConflicts = can('sync.conflicts.resolve');
  const canResetDevice = can('sync.devices.reset');
  const canManageDevices = can('sync.devices.manage');
  const offline = useOffline();
  const [diagnostics, setDiagnostics] = useState({ outbox: [], conflicts: [], devices: [], checkpoints: [] });
  const [serverDiagnostics, setServerDiagnostics] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [exportedAt, setExportedAt] = useState(null);
  const [showReset, setShowReset] = useState(false);
  const [reset, setReset] = useState({ reason: '', password: '', confirmation: '' });
  const [resolutionReasons, setResolutionReasons] = useState({});
  const [authorityAction, setAuthorityAction] = useState(null);
  const [deviceAction, setDeviceAction] = useState(null);

  const load = useCallback(async () => {
    const local = await offline.getDiagnostics();
    setDiagnostics(local);
    if (offline.isMeaningfullyOnline) {
      api.get('/sync/diagnostics').then(setServerDiagnostics).catch(() => setServerDiagnostics(null));
    }
  }, [offline]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const unresolved = useMemo(() => diagnostics.outbox.filter((item) => item.status !== 'acknowledged'), [diagnostics.outbox]);
  const oldest = unresolved[0]?.createdAt || null;

  const syncNow = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await offline.syncNow();
      // `ran: false` means the work never happened — another window held the
      // synchronization turn for longer than we waited. Reporting the previous
      // run's conclusion here is what made this button appear to lie.
      setMessage(
        result.ran === false
          ? 'Another Dine3D window is synchronizing. Your changes are saved and will be sent with it.'
          : result.status === 'synchronized'
            ? 'All saved changes are synchronized.'
            : result.message,
      );
      await load();
    } catch (error) {
      setMessage(error.message || 'Synchronization could not be completed. Records remain stored locally.');
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setBusy(true);
    try {
      await offline.saveOperationalNote(note);
      setNote('');
      setMessage(offline.isMeaningfullyOnline ? 'Operational note saved and queued.' : 'Operational note saved on this device.');
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    const data = await exportTenantOfflineData(offline.context.tenantId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dine3d-offline-recovery-${offline.context.tenantId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportedAt(new Date().toISOString());
    setMessage('Encrypted device storage was not modified. A diagnostic recovery export was downloaded; protect it as sensitive restaurant data.');
  };

  const resetDevice = async () => {
    if (reset.confirmation !== 'RESET') return setMessage('Type RESET exactly to continue.');
    if (unresolved.length > 0 && !exportedAt) return setMessage('Export the local recovery file before resetting a device with unsynchronized records.');
    setBusy(true);
    try {
      await api.post(`/sync/devices/${offline.device.deviceId}/reset-authorize`, {
        reason: reset.reason,
        password: reset.password,
      });
      await resetTenantOfflineData(offline.context.tenantId, { allowPending: true });
      window.location.href = '/admin/login';
    } catch (error) {
      setMessage(error.message || 'Device reset was not authorized.');
      setBusy(false);
    }
  };

  const resolveConflict = async (conflict, resolution) => {
    const reason = String(resolutionReasons[conflict.id] || '').trim();
    if (reason.length < 5) return setMessage('Provide a specific conflict-resolution reason (at least 5 characters).');
    setBusy(true);
    try {
      await offline.resolveConflict(conflict.id, resolution, reason);
      setMessage(resolution === 'ACCEPT_SERVER' ? 'Server version accepted; the preserved local command was retired.' : 'The order transition was reapplied against the latest server version.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Conflict could not be resolved. Both versions remain preserved.');
    } finally {
      setBusy(false);
    }
  };

  const updateDevice = async (device, patch) => {
    setBusy(true);
    setMessage('');
    try {
      await api.patch(`/sync/devices/${device.id}`, patch);
      setMessage(`${device.name} was updated.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'The device could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeviceAction = async () => {
    if (!deviceAction?.device) return;
    setBusy(true);
    setMessage('');
    try {
      if (deviceAction.kind === 'rename') {
        await api.patch(`/sync/devices/${deviceAction.device.id}`, { name: deviceAction.name.trim() });
        setMessage('Device name updated.');
      } else {
        await api.post(`/sync/devices/${deviceAction.device.id}/revoke`, {
          password: deviceAction.password,
          reason: deviceAction.reason,
          confirmation: deviceAction.confirmation,
        });
        setMessage(`${deviceAction.device.name} was revoked and can no longer use Cloud or restaurant-network authorization.`);
      }
      setDeviceAction(null);
      await load();
    } catch (error) {
      setMessage(error.message || 'The device action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmAuthorityAction = async () => {
    if (!authorityAction?.device) return;
    const takeover = authorityAction.kind === 'takeover';
    const expected = takeover ? 'EMERGENCY TAKEOVER' : 'SET PRIMARY';
    if (authorityAction.confirmation !== expected) return setMessage(`Type ${expected} exactly to continue.`);
    setBusy(true);
    setMessage('');
    try {
      await api.post(
        `/sync/devices/${authorityAction.device.id}/${takeover ? 'emergency-takeover' : 'designate-primary'}`,
        {
          password: authorityAction.password,
          reason: authorityAction.reason,
          confirmation: authorityAction.confirmation,
          ...(takeover ? { previousPrimaryDeviceId: authorityAction.previousPrimaryDeviceId || null } : {}),
        },
      );
      setMessage(takeover
        ? `${authorityAction.device.name} is now the coordinated emergency Primary POS.`
        : `${authorityAction.device.name} is now the branch Primary POS.`);
      setAuthorityAction(null);
      await load();
    } catch (error) {
      setMessage(error.message || 'Primary POS authority could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Device resilience</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Synchronization & offline diagnostics</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Operational records are written to this device before transmission. First-time public QR access and account, billing, permission, refund, and integration changes remain online-only.
          </p>
        </div>
        {canSynchronize && <button onClick={syncNow} disabled={busy} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
          {busy ? 'Working…' : 'Sync now'}
        </button>}
      </header>

      {message && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">{message}</div>}
      {offline.initializationError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>Offline storage needs attention:</strong> {offline.initializationError.message}. The database was not cleared; export/recovery remains available where the schema can be opened.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Operating mode', String(offline.state.operatingMode || 'INITIALIZING').replaceAll('_', ' ')],
          ['Dine3D Cloud', offline.state.cloudOnline ? 'Online' : 'Unavailable'],
          ['Dine3D Edge', offline.state.edgeConfigured ? (offline.state.edgeOnline ? 'Healthy' : 'Unavailable') : 'Not installed'],
          ['Waiting', String(offline.state.pendingCount)],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 break-words text-lg font-black text-slate-950">{value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
        <h2 className="font-black text-slate-950">Current restaurant connection</h2>
        <p className="mt-2 text-sm font-semibold text-slate-700">{offline.state.modeMessage || offline.state.message}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs font-bold uppercase text-slate-500">Browser → Cloud</dt><dd className="mt-1 font-semibold">{offline.state.connectivity?.browserToCloud === null ? 'Checking' : offline.state.connectivity?.browserToCloud ? 'Connected' : 'Unavailable'}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-slate-500">Browser → Edge</dt><dd className="mt-1 font-semibold">{offline.state.connectivity?.browserToEdge === null ? (offline.state.edgeConfigured ? 'Checking' : 'Not installed') : offline.state.connectivity?.browserToEdge ? 'Connected' : 'Unavailable'}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-slate-500">Edge → Cloud</dt><dd className="mt-1 font-semibold">{offline.state.connectivity?.edgeToCloud === null ? 'Unknown' : offline.state.connectivity?.edgeToCloud ? 'Connected' : 'Unavailable'}</dd></div>
          <div><dt className="text-xs font-bold uppercase text-slate-500">Local live events</dt><dd className="mt-1 font-semibold">{offline.state.edgeConfigured ? String(offline.state.edgeEventStream || 'disconnected').replaceAll('_', ' ') : 'Not installed'}</dd></div>
        </dl>
      </section>

      {offline.state.operatingMode === 'RECOVERY' && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5" aria-live="polite">
          <p className="text-xs font-black uppercase tracking-wide text-violet-700">Controlled recovery</p>
          <h2 className="mt-1 font-black text-violet-950">Reconciling emergency work before normal operation</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Authority restored', Boolean(offline.state.connectivity?.browserToEdge || offline.state.connectivity?.browserToCloud), 'A stable Edge or Cloud path is available.'],
              ['Operations replayed', offline.state.pendingCount === 0, `${offline.state.pendingCount} operation(s) still waiting.`],
              ['Conflicts reviewed', offline.state.conflictCount === 0, `${offline.state.conflictCount} conflict(s) require review.`],
              ['Failures cleared', offline.state.failedCount === 0, `${offline.state.failedCount} permanent failure(s) require action.`],
            ].map(([label, complete, detail]) => <div key={label} className="rounded-xl border border-violet-100 bg-white p-3"><p className={`text-xs font-black ${complete ? 'text-emerald-700' : 'text-violet-800'}`}>{complete ? '✓ ' : '… '}{label}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>)}
          </div>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[1fr_0.7fr]">
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-black text-slate-950">Local operation queue</h2>
            <p className="mt-1 text-xs text-slate-500">Acknowledged metadata is retained for diagnostics; business payloads are not displayed here.</p>
          </div>
          <div className="max-h-[420px] overflow-auto">
            {diagnostics.outbox.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No operations have been recorded on this device.</p>
            ) : diagnostics.outbox.slice().reverse().map((item) => (
              <div key={item.operationId} className="border-b border-slate-100 px-5 py-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.operationType.replaceAll('_', ' ')}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">{item.operationId}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${BADGE[item.status] || 'bg-slate-100 text-slate-700'}`}>{item.status.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">Saved {new Date(item.createdAt).toLocaleString()} · retries {item.retryCount || 0}</p>
                {item.statusDetail && <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">{item.statusDetail}</p>}
                {item.lastError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{item.lastError}</p>}
              </div>
            ))}
          </div>
        </article>

        <div className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">This device</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-xs font-bold uppercase text-slate-500">Name</dt><dd className="font-semibold text-slate-900">{offline.device?.name || 'Initializing'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-slate-500">Device ID</dt><dd className="break-all font-mono text-xs text-slate-700">{offline.device?.deviceId || '—'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-slate-500">Oldest waiting record</dt><dd className="font-semibold text-slate-900">{oldest ? new Date(oldest).toLocaleString() : 'None'}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-slate-500">Clock offset estimate</dt><dd className="font-semibold text-slate-900">{offline.state.clockOffsetMs === null ? 'Unknown' : `${offline.state.clockOffsetMs} ms`}</dd></div>
            </dl>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">Operational note</h2>
            <p className="mt-1 text-xs text-slate-500">Notes are durable and queued like other operational records.</p>
            <label className="mt-4 block text-xs font-bold text-slate-700">Note<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" /></label>
            <button onClick={saveNote} disabled={busy || !note.trim()} className="mt-3 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Save on this device</button>
          </article>
        </div>
      </section>

      {diagnostics.conflicts.filter((conflict) => conflict.status === 'open').length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-red-950">Conflicts requiring manager review</h2>
          <p className="mt-1 text-sm text-slate-600">No version is silently overwritten. Compare the preserved local command with the server value, record a reason, then choose a safe resolution.</p>
          <div className="mt-4 space-y-4">
            {diagnostics.conflicts.filter((conflict) => conflict.status === 'open').map((conflict) => {
              const operation = diagnostics.outbox.find((entry) => entry.operationId === conflict.operationId);
              const canRetry = operation?.operationType === 'ORDER_TRANSITION';
              return <article key={conflict.id} className="rounded-xl border border-red-100 bg-red-50/50 p-4">
                <div className="flex flex-wrap justify-between gap-2"><div><p className="font-bold text-slate-950">{conflict.entityType} version conflict</p><p className="font-mono text-[10px] text-slate-500">{conflict.entityId}</p></div><span className="text-xs font-bold text-red-700">Local v{conflict.baseVersion ?? '?'} · Server v{conflict.serverVersion ?? '?'}</span></div>
                <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs"><summary className="cursor-pointer font-bold text-slate-700">Compare preserved versions</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="font-bold">Local command</p><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-[10px] text-slate-200">{JSON.stringify(conflict.localValue, null, 2)}</pre></div><div><p className="font-bold">Server version</p><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-[10px] text-slate-200">{JSON.stringify(conflict.serverValue, null, 2)}</pre></div></div></details>
                {canResolveConflicts && <><label className="mt-3 block text-xs font-bold text-slate-700">Mandatory reason<input value={resolutionReasons[conflict.id] || ''} onChange={(event) => setResolutionReasons((current) => ({ ...current, [conflict.id]: event.target.value }))} maxLength={500} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => resolveConflict(conflict, 'ACCEPT_SERVER')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:opacity-50">Accept server version</button>{canRetry && <button type="button" disabled={busy} onClick={() => resolveConflict(conflict, 'RETRY_LOCAL_ORDER_TRANSITION')} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Reapply local transition</button>}</div></>}
                {!canRetry && <p className="mt-2 text-xs text-amber-800">This operation cannot be replayed safely. Accept the server version, refresh, then record a new corrective movement if needed.</p>}
              </article>;
            })}
          </div>
        </section>
      )}

      {serverDiagnostics && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-950">Restaurant synchronization health</h2>
          <p className="mt-2 text-sm text-slate-600">{serverDiagnostics.devices.length} registered device(s), {serverDiagnostics.conflicts.filter((item) => item.status === 'OPEN').length} open server conflict(s), and {serverDiagnostics.reconciliationIssues.length} inventory reconciliation issue(s).</p>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {serverDiagnostics.devices.map((device) => {
              const stale = !device.lastSeenAt || Date.now() - new Date(device.lastSeenAt).getTime() > 90_000;
              const primary = serverDiagnostics.devices.find((candidate) => candidate.locationId === device.locationId && candidate.isPrimaryPos);
              return <article key={device.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-bold text-slate-950">{device.name}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{device.id}</p></div>
                  <div className="flex flex-wrap gap-1.5">
                    {device.isPrimaryPos && <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-black uppercase text-red-800">Primary POS</span>}
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${device.status === 'ACTIVE' && !stale ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{device.status === 'ACTIVE' && stale ? 'Offline' : device.status}</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <span>Type: <strong>{String(device.deviceType || 'POS').replaceAll('_', ' ')}</strong></span>
                  <span>Version: <strong>{device.appVersion || 'Unknown'}</strong></span>
                  <span>Last seen: <strong>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'Never'}</strong></span>
                  <span>Branch: <strong className="break-all">{device.locationId || 'Unassigned'}</strong></span>
                </div>
                {canManageDevices && device.status === 'ACTIVE' && <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setDeviceAction({ kind: 'rename', device, name: device.name })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800">Rename</button>
                  {!device.isPrimaryPos && <select value={device.deviceType || 'POS'} onChange={(event) => updateDevice(device, { deviceType: event.target.value })} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-bold">
                    {['POS', 'KDS', 'WAITER', 'MANAGER', 'INVENTORY'].map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
                  </select>}
                  {!device.isPrimaryPos && ['POS', 'PRIMARY_POS'].includes(device.deviceType) && <button type="button" onClick={() => setAuthorityAction({ kind: 'designate', device, password: '', reason: '', confirmation: '' })} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">Set Primary POS</button>}
                  {!device.isPrimaryPos && primary && ['POS', 'PRIMARY_POS'].includes(device.deviceType) && <button type="button" onClick={() => setAuthorityAction({ kind: 'takeover', device, previousPrimaryDeviceId: primary.id, password: '', reason: '', confirmation: '' })} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-800">Emergency takeover…</button>}
                  {!device.isPrimaryPos && <button type="button" onClick={() => setDeviceAction({ kind: 'revoke', device, password: '', reason: '', confirmation: '' })} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-800">Revoke</button>}
                </div>}
              </article>;
            })}
          </div>
        </section>
      )}

      {authorityAction && canManageDevices && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="authority-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">Device authority change</p>
            <h2 id="authority-title" className="mt-1 text-xl font-black text-slate-950">{authorityAction.kind === 'takeover' ? 'Emergency Primary POS takeover' : 'Designate Primary POS'}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">{authorityAction.kind === 'takeover'
              ? 'Only continue if the original Primary POS is genuinely unavailable. A mistaken takeover can require reconciliation if the original terminal is still operating.'
              : 'Only this terminal will be allowed to commit critical operations if both Dine3D Edge and Cloud become unreachable.'}</p>
            <div className="mt-5 space-y-3">
              <label className="block text-xs font-bold text-slate-700">Reason<input value={authorityAction.reason} maxLength={500} onChange={(event) => setAuthorityAction({ ...authorityAction, reason: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="block text-xs font-bold text-slate-700">Manager password<input type="password" value={authorityAction.password} onChange={(event) => setAuthorityAction({ ...authorityAction, password: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="block text-xs font-bold text-slate-700">Type {authorityAction.kind === 'takeover' ? 'EMERGENCY TAKEOVER' : 'SET PRIMARY'}<input value={authorityAction.confirmation} onChange={(event) => setAuthorityAction({ ...authorityAction, confirmation: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setAuthorityAction(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Cancel</button><button type="button" disabled={busy || authorityAction.reason.trim().length < 10 || !authorityAction.password} onClick={confirmAuthorityAction} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Confirm authority change</button></div>
          </div>
        </div>
      )}

      {deviceAction && canManageDevices && (
        <div className="fixed inset-0 z-[225] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="device-action-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Device management</p>
            <h2 id="device-action-title" className="mt-1 text-xl font-black text-slate-950">{deviceAction.kind === 'rename' ? 'Rename device' : `Revoke ${deviceAction.device.name}`}</h2>
            {deviceAction.kind === 'rename' ? (
              <label className="mt-5 block text-xs font-bold text-slate-700">Friendly name<input autoFocus minLength={2} maxLength={120} value={deviceAction.name} onChange={(event) => setDeviceAction({ ...deviceAction, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Counter 1" /></label>
            ) : (
              <div className="mt-5 space-y-3"><p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">Revocation immediately removes future Cloud and Edge authorization. Historical audit records remain.</p><label className="block text-xs font-bold text-slate-700">Reason<input maxLength={500} value={deviceAction.reason} onChange={(event) => setDeviceAction({ ...deviceAction, reason: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="block text-xs font-bold text-slate-700">Manager password<input type="password" value={deviceAction.password} onChange={(event) => setDeviceAction({ ...deviceAction, password: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="block text-xs font-bold text-slate-700">Type REVOKE DEVICE<input value={deviceAction.confirmation} onChange={(event) => setDeviceAction({ ...deviceAction, confirmation: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label></div>
            )}
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDeviceAction(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Cancel</button><button type="button" disabled={busy || (deviceAction.kind === 'rename' ? deviceAction.name.trim().length < 2 : deviceAction.reason.trim().length < 10 || !deviceAction.password || deviceAction.confirmation !== 'REVOKE DEVICE')} onClick={confirmDeviceAction} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${deviceAction.kind === 'revoke' ? 'bg-red-700' : 'bg-slate-950'}`}>{deviceAction.kind === 'rename' ? 'Save name' : 'Revoke device'}</button></div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="font-black text-amber-950">Recovery & protected device reset</h2>
        <p className="mt-2 text-sm text-amber-900">Export creates a support/recovery copy. It contains restaurant business data and must be stored securely. Normal logout never clears this database.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={exportData} className="rounded-xl border border-amber-400 bg-white px-4 py-2.5 text-sm font-bold text-amber-950">Export recovery file</button>
          {canResetDevice && <button onClick={() => setShowReset((value) => !value)} className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white">Reset this device…</button>}
        </div>
        {showReset && canResetDevice && (
          <div className="mt-5 space-y-3 rounded-xl border border-red-200 bg-white p-4">
            <p className="text-sm font-bold text-red-900">This removes every cached and unsynchronized local record after online manager authorization. It cannot be undone.</p>
            {unresolved.length > 0 && <p className="text-sm text-red-800">{unresolved.length} unsynchronized record(s) remain. A recovery export is required before reset.</p>}
            <label className="block text-xs font-bold text-slate-700">Reason<input value={reset.reason} onChange={(event) => setReset({ ...reset, reason: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="block text-xs font-bold text-slate-700">Manager password<input type="password" value={reset.password} onChange={(event) => setReset({ ...reset, password: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="block text-xs font-bold text-slate-700">Type RESET<input value={reset.confirmation} onChange={(event) => setReset({ ...reset, confirmation: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <button onClick={resetDevice} disabled={busy || reset.confirmation !== 'RESET'} className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Authorize and erase local device data</button>
          </div>
        )}
      </section>
    </div>
  );
}
