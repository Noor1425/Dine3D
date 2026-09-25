'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import saApi from '@/lib/saApi';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';

const tone = (status) => ({ VERIFIED: 'bg-emerald-500/10 text-emerald-400', COMPLETED: 'bg-blue-500/10 text-blue-300', FAILED: 'bg-red-500/10 text-red-300', REQUESTED: 'bg-amber-500/10 text-amber-300', APPROVED: 'bg-blue-500/10 text-blue-300', REJECTED: 'bg-red-500/10 text-red-300', EXPIRED: 'bg-sa-800 text-sa-400' }[status] || 'bg-sa-800 text-sa-300');
const size = (bytes) => {
  const value = Number(bytes || 0); if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let index = 0; let current = value;
  while (current >= 1024 && index < units.length - 1) { current /= 1024; index += 1; }
  return `${current.toFixed(index ? 1 : 0)} ${units[index]}`;
};

export default function BackupsPage() {
  const { can } = useSuperAdminAccess();
  const canManage = can('backups.manage');
  const [config, setConfig] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('Disaster recovery readiness point requested by platform operations.');
  const [selectedBackup, setSelectedBackup] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [policy, snapshotResult, requestResult] = await Promise.all([saApi.getBackupConfig(), saApi.getBackupSnapshots(), saApi.getRestoreRequests()]);
      setConfig(policy); setSnapshots(snapshotResult.data || []); setRequests(requestResult.data || []);
    } catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!snapshots.some((item) => ['PENDING', 'RUNNING'].includes(item.status))) return undefined;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [snapshots, load]);
  const verified = useMemo(() => snapshots.filter((item) => item.status === 'VERIFIED'), [snapshots]);

  const act = async (key, action) => {
    setBusy(key); setError('');
    try { await action(); await load(); } catch (actionError) { setError(actionError.message); } finally { setBusy(''); }
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black">Backup & recovery</h1><p className="mt-1 text-sm text-sa-500">Encrypted recovery points, integrity evidence, retention, and approval-gated restoration.</p></div>{canManage && <button disabled={Boolean(busy) || !config?.encrypted} title={!config?.encrypted ? 'Configure BACKUP_ENCRYPTION_KEY first' : undefined} onClick={() => act('create', () => saApi.createBackup({ reason, includeUploads: true }))} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-black text-black disabled:opacity-50">{busy === 'create' ? 'Queuing…' : config?.encrypted ? 'Create recovery point' : 'Encryption key required'}</button>}</div>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-sm font-bold text-red-300">{error}</div>}
    {config && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Policy label="Scheduler" value={config.schedule.enabled ? `Daily after ${config.schedule.utcHour}:00 UTC` : 'Disabled'} good={config.schedule.enabled} />
      <Policy label="Encryption" value={config.encrypted ? 'AES-256-GCM ready' : 'Key not configured'} good={config.encrypted} />
      <Policy label="Storage" value={config.storage.replaceAll('_', ' ')} good={config.storage === 'S3_COMPATIBLE'} />
      <Policy label="Uploads" value={config.includesUploads ? 'Included' : 'Excluded'} good={config.includesUploads} />
      <Policy label="Point-in-time" value={config.pointInTimeRecovery ? 'Infrastructure enabled' : 'Not configured'} good={config.pointInTimeRecovery} />
    </div>}

    <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sa-800 p-5"><div><h2 className="font-black">Recovery-point catalog</h2><p className="mt-1 text-xs text-sa-500">Verification includes checksum, authenticated decryption, archive inspection, and PostgreSQL dump inspection.</p></div><button onClick={load} className="rounded-lg border border-sa-700 px-3 py-2 text-xs font-bold">Refresh</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-sa-950/40 text-xs uppercase tracking-wide text-sa-500"><tr><th className="p-4">Created</th><th>Tier</th><th>Status</th><th>Size</th><th>Verified</th><th>Expires</th><th>Integrity</th><th className="p-4 text-right">Action</th></tr></thead><tbody className="divide-y divide-sa-800">{snapshots.map((item) => <tr key={item.id}><td className="p-4"><div className="font-bold">{new Date(item.createdAt).toLocaleString()}</div><div className="mt-1 font-mono text-[10px] text-sa-600">{item.id}</div></td><td>{item.tier}</td><td><Badge status={item.status} /></td><td>{size(item.sizeBytes)}</td><td>{item.verifiedAt ? new Date(item.verifiedAt).toLocaleString() : '—'}</td><td>{item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : '—'}</td><td className="font-mono text-xs text-sa-500">{item.checksumSha256 ? `${item.checksumSha256.slice(0, 12)}…` : '—'}</td><td className="p-4 text-right">{canManage && ['COMPLETED', 'VERIFIED'].includes(item.status) && <button disabled={Boolean(busy)} onClick={() => act(`verify-${item.id}`, () => saApi.verifyBackup(item.id, { reason: 'Operator-initiated integrity validation' }))} className="rounded-lg border border-sa-700 px-3 py-2 text-xs font-bold disabled:opacity-50">{busy === `verify-${item.id}` ? 'Verifying…' : 'Verify'}</button>}</td></tr>)}</tbody></table>{!snapshots.length && <div className="p-12 text-center text-sa-500">No recovery points have been catalogued.</div>}</div>
    </section>

    {canManage && <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Request isolated recovery</h2><p className="mt-1 text-xs leading-5 text-sa-500">This creates a controlled request only. A different operator must approve it; production is never overwritten automatically.</p><div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(300px,1.3fr)_auto]"><select value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)} className="min-w-0 rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">Choose verified recovery point</option>{verified.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.tier}</option>)}</select><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="min-w-0 rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" placeholder="Business and incident reason"/><button disabled={!selectedBackup || reason.trim().length < 12 || Boolean(busy)} onClick={() => act('request', () => saApi.createRestoreRequest({ backupId: selectedBackup, scope: 'PLATFORM', reason }))} className="rounded-xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-400 disabled:opacity-40">Request recovery</button></div></section>}

    <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900"><h2 className="border-b border-sa-800 p-5 font-black">Recovery approvals</h2><div className="divide-y divide-sa-800">{requests.map((item) => <div key={item.id} className="grid gap-3 p-5 text-sm lg:grid-cols-[1fr_minmax(280px,420px)]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge status={item.status}/><span className="font-bold">{item.scope} recovery</span><span className="text-xs text-sa-500">{new Date(item.createdAt).toLocaleString()}</span></div><p className="mt-2 break-words text-sa-300">{item.reason}</p><div className="mt-2 text-xs text-sa-500">Recovery point: {item.backup ? new Date(item.backup.createdAt).toLocaleString() : item.targetTime ? new Date(item.targetTime).toLocaleString() : 'Unavailable'} · requester {item.requestedBy}</div>{item.reviewNote && <div className="mt-2 text-xs text-sa-400">Review: {item.reviewNote}</div>}</div>{canManage && item.status === 'REQUESTED' && <ReviewActions item={item} busy={busy} act={act} />}</div>)}{!requests.length && <div className="p-12 text-center text-sa-500">No recovery requests.</div>}</div></section>

    <div className="rounded-2xl border border-amber-900 bg-amber-500/5 p-5 text-sm leading-6 text-amber-200"><strong>Production guardrail:</strong> approval authorizes recovery into an isolated environment only. Cutover requires a separate incident procedure, reconciliation, and business approval.</div>
  </div>;
}

function Policy({ label, value, good }) { return <div className="min-w-0 rounded-2xl border border-sa-800 bg-sa-900 p-5"><div className="text-xs font-bold text-sa-500">{label}</div><div className={`mt-2 truncate font-black ${good ? 'text-emerald-400' : 'text-amber-400'}`} title={value}>{value}</div></div>; }
function Badge({ status }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${tone(status)}`}>{status}</span>; }

function ReviewActions({ item, busy, act }) {
  const [note, setNote] = useState('');
  const disabled = Boolean(busy) || note.trim().length < 8;
  return <div className="min-w-0"><label className="text-[10px] font-black uppercase tracking-wide text-sa-500">Independent review note<input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} className="mt-1 block w-full rounded-lg border border-sa-700 bg-sa-950 px-3 py-2 text-xs normal-case tracking-normal text-white" placeholder="Record evidence checked and decision rationale" /></label><div className="mt-2 flex justify-end gap-2"><button disabled={disabled} onClick={() => act(`reject-${item.id}`, () => saApi.reviewRestoreRequest(item.id, { decision: 'REJECTED', reviewNote: note.trim() }))} className="rounded-lg border border-sa-700 px-3 py-2 text-xs font-bold disabled:opacity-40">Reject</button><button disabled={disabled} onClick={() => act(`approve-${item.id}`, () => saApi.reviewRestoreRequest(item.id, { decision: 'APPROVED', reviewNote: note.trim() }))} className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-black text-black disabled:opacity-40">Approve</button></div></div>;
}
