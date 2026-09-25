'use client';

import { useEffect, useState } from 'react';
import saApi from '@/lib/saApi';
import StatusBadge from '@/components/superadmin/StatusBadge';

export default function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await saApi.getSystemHealth());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black">System health</h1><p className="mt-1 text-sm text-sa-500">Live probes and durable maintenance-job history. Process uptime is not platform SLA uptime.</p></div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold disabled:opacity-50">Refresh</button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-red-300">{error}</div>}
      {loading && !data ? <div className="h-48 animate-pulse rounded-2xl bg-sa-900" /> : data && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Health label="Database" value={`${data.database.status} · ${data.database.latencyMs} ms`} ok={data.database.status === 'available'} />
            <Health label="API process" value={`${Math.floor(data.apiProcess.uptimeSeconds / 60)} minutes uptime`} ok={data.apiProcess.status === 'available'} />
            <Health label="Cache" value={data.cache.status} ok={data.cache.available} />
            <Health label="Billing provider" value={data.billingProvider.provider} ok={data.billingProvider.configured} />
            <Health label="Email transport" value={`${data.emailProvider.provider.toUpperCase()} · ${data.emailProvider.connectionVerified ? 'connected' : data.emailProvider.errorCode || 'not checked'}`} ok={data.emailProvider.configured && data.emailProvider.connectionVerified} />
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Signal label="Failed jobs · 24h" value={data.signals.failedJobs24h} />
            <Signal label="Failed billing events · 24h" value={data.signals.failedBilling24h} />
            <Signal label="Email exceptions · 24h" value={data.signals.failedEmail24h} />
            <Signal label="Critical security events · 24h" value={data.signals.criticalSecurity24h} />
            <Signal label="Failed backups · 24h" value={data.signals.failedBackups24h} />
            <Signal label="Stale backup policy" value={data.signals.staleBackups} />
          </div>
          <div className={`rounded-2xl border p-5 text-sm ${data.backup.stale ? 'border-red-800 bg-red-500/10 text-red-300' : 'border-sa-800 bg-sa-900 text-sa-300'}`}><strong>Recovery readiness:</strong> {data.backup.schedulerEnabled ? (data.backup.latestVerifiedAt ? `latest verified backup ${data.backup.latestBackupAgeHours} hours ago` : 'no verified backup has been recorded') : 'automatic backups are not enabled on this deployment'}.</div>
          <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
            <h2 className="border-b border-sa-800 p-5 font-black">Background job runs</h2>
            {data.jobRuns.length ? <div className="divide-y divide-sa-800">{data.jobRuns.map((run) => (
              <div key={run.id} className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_auto_auto]">
                <div><div className="font-bold">{run.jobKey}</div><div className="text-xs text-sa-500">{run.error || 'No error'} · correlation {run.correlationId || 'unavailable'}</div></div>
                <StatusBadge status={run.status} />
                <span className="text-xs text-sa-500">{new Date(run.createdAt).toLocaleString()}</span>
              </div>
            ))}</div> : <div className="p-12 text-center text-sa-500">No job runs recorded yet.</div>}
          </section>
        </>
      )}
    </div>
  );
}

function Health({ label, value, ok }) {
  return <div className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><div className="text-xs font-bold text-sa-500">{label}</div><div className={`mt-2 font-black ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{value}</div></div>;
}

function Signal({ label, value }) {
  return <div className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><div className={value ? 'text-3xl font-black text-red-400' : 'text-3xl font-black text-emerald-400'}>{value}</div><div className="mt-1 text-sm text-sa-500">{label}</div></div>;
}
