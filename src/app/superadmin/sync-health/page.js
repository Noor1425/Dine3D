'use client';

import { useEffect, useState } from 'react';
import saApi from '@/lib/saApi';

const fmt = (value, suffix = '') => value === null || value === undefined ? 'Unavailable' : `${value}${suffix}`;

export default function SyncHealthPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try { setData(await saApi.getSyncHealth(days)); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [days]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">Sync health</h1>
          <p className="mt-1 max-w-3xl text-sm text-sa-500">Metadata-only queue, conflict, device, duplicate-replay, latency, and inventory-reconciliation monitoring. Tenant payloads are not exposed here.</p>
        </div>
        <div className="flex gap-2">
          <label className="text-xs font-bold text-sa-400">Range
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="ml-2 rounded-xl border border-sa-700 bg-sa-900 px-3 py-2 text-white">
              <option value={1}>24 hours</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
            </select>
          </label>
          <button type="button" disabled={loading} onClick={load} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold disabled:opacity-50">Refresh</button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-red-300">{error}</div>}
      {loading && !data ? <div className="h-56 animate-pulse rounded-2xl bg-sa-900" /> : data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Sync success rate" value={fmt(data.metrics.successRate, '%')} tone={data.metrics.successRate === null || data.metrics.successRate >= 98 ? 'good' : 'warn'} />
          <Metric label="Server-visible queue" value={data.metrics.serverVisibleQueueSize} tone={data.metrics.serverVisibleQueueSize ? 'warn' : 'good'} />
          <Metric label="Open conflicts" value={data.metrics.conflicts} tone={data.metrics.conflicts ? 'bad' : 'good'} />
          <Metric label="Stale devices" value={data.metrics.staleDevices} tone={data.metrics.staleDevices ? 'warn' : 'good'} />
          <Metric label="Duplicate retries deduplicated" value={data.metrics.duplicateOperationsRejected} />
          <Metric label="Average processing latency" value={fmt(data.metrics.averageProcessingLatencyMs, ' ms')} />
          <Metric label="Permanent failures" value={data.metrics.permanentFailures} tone={data.metrics.permanentFailures ? 'bad' : 'good'} />
          <Metric label="Inventory reconciliation" value={data.metrics.inventoryReconciliationIssues} tone={data.metrics.inventoryReconciliationIssues ? 'bad' : 'good'} />
        </div>

        {data.alerts.length > 0 && <section className="space-y-2" aria-label="Synchronization alerts">
          {data.alerts.map((alert) => <div key={`${alert.type}:${alert.message}`} className={`rounded-xl border p-4 text-sm font-bold ${alert.severity === 'critical' ? 'border-red-800 bg-red-500/10 text-red-300' : 'border-amber-800 bg-amber-500/10 text-amber-300'}`}>{alert.message}</div>)}
        </section>}

        <div className="rounded-xl border border-blue-900 bg-blue-500/10 p-4 text-sm text-blue-200">{data.visibilityNote}</div>

        <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
          <h2 className="border-b border-sa-800 p-5 font-black">Devices</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-sa-950 text-xs uppercase text-sa-500"><tr><th className="p-3">Restaurant / device</th><th className="p-3">Schema</th><th className="p-3">Last sync</th><th className="p-3">Processed</th><th className="p-3">Failures</th><th className="p-3">Signal</th></tr></thead><tbody className="divide-y divide-sa-800">{data.devices.map((device) => <tr key={device.id}><td className="p-3"><div className="font-bold">{device.restaurant.name}</div><div className="text-xs text-sa-500">{device.name} · {device.id.slice(0, 8)}</div></td><td className="p-3">v{device.localSchemaVersion}</td><td className="p-3 text-sa-400">{device.lastSuccessfulSyncAt ? new Date(device.lastSuccessfulSyncAt).toLocaleString() : 'Never'}</td><td className="p-3">{device.counts.PROCESSED || 0}</td><td className="p-3 text-red-300">{(device.counts.RETRYABLE_FAILED || 0) + (device.counts.PERMANENTLY_FAILED || 0) + (device.counts.CONFLICT || 0)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${device.stale || device.clockAnomaly ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{device.stale ? 'Stale' : device.clockAnomaly ? 'Clock anomaly' : 'Healthy'}</span></td></tr>)}</tbody></table></div>
          {data.devices.length === 0 && <p className="p-10 text-center text-sa-500">No synchronized devices registered.</p>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
          <h2 className="border-b border-sa-800 p-5 font-black">Recent failures</h2>
          <div className="divide-y divide-sa-800">{data.recentFailures.map((failure) => <div key={failure.operationId} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_auto]"><div><div className="font-bold">{failure.operationType} · {failure.entityType}</div><div className="mt-1 text-xs text-sa-500">{failure.errorCode || failure.status}: {failure.errorMessage || 'No detail'} · device {failure.deviceId.slice(0, 8)}</div></div><time className="text-xs text-sa-500">{new Date(failure.receivedAt).toLocaleString()}</time></div>)}</div>
          {data.recentFailures.length === 0 && <p className="p-10 text-center text-sa-500">No synchronization failures in this range.</p>}
        </section>
      </>}
    </div>
  );
}

function Metric({ label, value, tone = 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'bad' ? 'text-red-400' : 'text-white';
  return <div className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><div className={`text-2xl font-black ${color}`}>{value}</div><div className="mt-1 text-xs font-bold text-sa-500">{label}</div></div>;
}

