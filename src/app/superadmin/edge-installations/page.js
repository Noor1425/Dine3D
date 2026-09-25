'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, CheckCircle2, ClipboardCheck, Copy, ExternalLink, Mail,
  MapPin, Plus, Printer, RefreshCw, RotateCcw, ServerCog, ShieldCheck, Trash2, UserRound, Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';
import PrinterRouteEditor, { blankPrinter, normalizePrinterForSave } from '@/components/superadmin/PrinterRouteEditor';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';

const FILTERS = ['OPEN', 'INSTALL_REQUESTED', 'SCHEDULED', 'AWAITING_PAIRING', 'ACTIVE', 'STALE', 'REVOKED', 'ALL'];
const LABELS = {
  OPEN: 'Open', INSTALL_REQUESTED: 'New requests', SCHEDULED: 'Scheduled',
  AWAITING_PAIRING: 'Pairing', ACTIVE: 'Active', STALE: 'Needs attention', REVOKED: 'Closed', ALL: 'All',
};
const STATUS_STYLE = {
  INSTALL_REQUESTED: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  SCHEDULED: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  AWAITING_PAIRING: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  ACTIVE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  STALE: 'border-red-500/30 bg-red-500/10 text-red-300',
  REVOKED: 'border-sa-700 bg-sa-800 text-sa-400',
};

const title = (value) => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const localInput = (date = new Date(Date.now() + 24 * 60 * 60_000)) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const ACCEPTANCE_CHECKS = [
  ['internetLoss', 'Internet loss', 'POS, KDS, and local printing continued through Edge.'],
  ['internetRestoration', 'Internet restoration', 'Queued work synchronized exactly once after recovery.'],
  ['cloudFallback', 'Edge failure', 'Devices reached Cloud automatically without changing URL.'],
  ['edgeRestart', 'Edge restart', 'Service, journal, KDS state, and pending work recovered.'],
  ['completeIsolation', 'Complete isolation', 'Only the signed Primary POS could commit; secondary devices stayed draft-only.'],
  ['browserRestart', 'Browser restart', 'Authorized local drafts and outbox reopened correctly.'],
  ['printerRecovery', 'Printer recovery', 'Configured printers recovered without uncontrolled duplicate tickets.'],
  ['powerCycle', 'Power cycle', 'The Edge service started automatically after a real computer restart.'],
];
const hasEnabledPrinters = (installation) => Array.isArray(installation?.printerConfiguration)
  && installation.printerConfiguration.some((printer) => printer?.enabled !== false);

function Status({ value }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${STATUS_STYLE[value] || STATUS_STYLE.REVOKED}`}>{title(value)}</span>;
}

function Detail({ icon: Icon, label, children }) {
  return <div className="flex gap-2.5"><Icon size={15} className="mt-0.5 shrink-0 text-sa-600" /><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wider text-sa-600">{label}</p><div className="mt-0.5 break-words text-sm text-sa-300">{children}</div></div></div>;
}


/**
 * Build the one-paste setup code the appliance wizard accepts.
 * Must stay byte-compatible with edge-agent/src/pairingToken.js.
 */
function encodeSetupCode({ cloudUrl, restaurantId, nodeId, pairingCode }) {
  const json = JSON.stringify({
    c: String(cloudUrl).replace(/\/$/, ''),
    r: restaurantId,
    n: nodeId,
    p: pairingCode,
  });
  const base64url = (bytes) => btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const payload = base64url(new TextEncoder().encode(json));
  return { payload, format: (checksum) => `D3D1.${payload}.${checksum}` };
}

async function setupCodeFor(pairing) {
  if (!pairing) return '';
  const { payload, format } = encodeSetupCode({
    cloudUrl: pairing.cloudUrl,
    restaurantId: pairing.installation.restaurantId,
    nodeId: pairing.installation.id,
    pairingCode: pairing.pairingCode,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const checksum = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    .slice(0, 8);
  return format(checksum);
}

export default function ManagedEdgeInstallationsPage() {
  const { can } = useSuperAdminAccess();
  const canManage = can('restaurants.update');
  const [filter, setFilter] = useState('OPEN');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [printerSetup, setPrinterSetup] = useState(null);
  const [acceptanceSetup, setAcceptanceSetup] = useState(null);
  const [form, setForm] = useState({
    scheduledFor: localInput(), installerName: '', installerEmail: '',
    installationNote: '', nodeName: '', platform: 'win32', acknowledgePendingOperations: false,
  });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await saApi.getEdgeInstallations(filter);
      setItems(response.installations || []);
    } catch (requestError) {
      setError(requestError.message || 'Managed installations could not be loaded.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load({ quiet: true }), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {}), [items]);

  function openAction(type, installation) {
    setAction({ type, installation });
    setForm({
      scheduledFor: installation.scheduledFor ? localInput(new Date(installation.scheduledFor)) : localInput(),
      installerName: installation.assignedInstallerName || '',
      installerEmail: installation.assignedInstallerEmail || '',
      installationNote: installation.installationNote || '',
      nodeName: installation.name || `${installation.location?.name || 'Restaurant'} Edge`,
      platform: installation.platform || 'win32',
      acknowledgePendingOperations: false,
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (!action) return;
    setSaving(true);
    try {
      if (action.type === 'schedule') {
        await saApi.scheduleEdgeInstallation(action.installation.id, {
          scheduledFor: new Date(form.scheduledFor).toISOString(),
          installerName: form.installerName,
          installerEmail: form.installerEmail,
          installationNote: form.installationNote,
          platform: form.platform,
        });
        toast.success('Visit scheduled and customer notified');
      } else if (action.type === 'prepare') {
        const response = await saApi.prepareEdgeInstallation(action.installation.id, {
          nodeName: form.nodeName,
          installationNote: form.installationNote,
        });
        const apiBase = process.env.NEXT_PUBLIC_API_URL || `${window.location.origin}/api`;
        const cloudUrl = new URL(apiBase, window.location.origin).origin;
        setPairing({ ...response, cloudUrl });
        toast.success('One-time installer pairing generated');
      } else if (action.type === 'replace') {
        await saApi.replaceEdgeInstallation(action.installation.id, { reason: form.installationNote, platform: form.platform, nodeName: form.nodeName, acknowledgePendingOperations: form.acknowledgePendingOperations });
        toast.success('Old identity revoked and replacement installation created');
      } else {
        await saApi.cancelEdgeInstallation(action.installation.id, { reason: form.installationNote });
        toast.success('Installation closed');
      }
      setAction(null);
      await load({ quiet: true });
    } catch (requestError) {
      toast.error(requestError.message || 'Installation could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function savePrinters(event) {
    event.preventDefault();
    if (!printerSetup) return;
    setSaving(true);
    try {
      await saApi.configureEdgePrinters(printerSetup.installation.id, { printers: printerSetup.printers.map(normalizePrinterForSave), reason: printerSetup.reason });
      toast.success('Printer routes saved; appliance verification will update shortly');
      setPrinterSetup(null);
      await load({ quiet: true });
    } catch (requestError) {
      toast.error(requestError.message || 'Printer routes could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAcceptance(event) {
    event.preventDefault();
    if (!acceptanceSetup) return;
    setSaving(true);
    try {
      await saApi.acceptEdgeInstallation(acceptanceSetup.installation.id, { checks: acceptanceSetup.checks, notes: acceptanceSetup.notes });
      toast.success('Branch passed the final go-live gate');
      setAcceptanceSetup(null);
      await load({ quiet: true });
    } catch (requestError) {
      const blockers = Array.isArray(requestError.data?.blockers) ? ` ${requestError.data.blockers.map(title).join(', ')}.` : '';
      toast.error(`${requestError.message || 'Acceptance could not be completed.'}${blockers}`);
    } finally {
      setSaving(false);
    }
  }

  const setupCommand = pairing
    ? `${pairing.installation.platform === 'win32' ? '' : 'sudo '}dine3d-edge pair --cloud ${pairing.cloudUrl} --restaurant ${pairing.installation.restaurantId} --node ${pairing.installation.id} --code ${pairing.pairingCode}`
    : '';

  // The setup code is what an installer actually uses: one paste into the
  // "Connect to Dine3D" wizard on the appliance. The command above stays for
  // scripted installs and for support sessions already at a shell.
  useEffect(() => {
    let cancelled = false;
    if (!pairing) { setSetupCode(''); return undefined; }
    setupCodeFor(pairing).then((code) => { if (!cancelled) setSetupCode(code); });
    return () => { cancelled = true; };
  }, [pairing]);

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">Deployment operations</p><h1 className="mt-1 text-2xl font-black">Managed installations</h1><p className="mt-1 max-w-3xl text-sm text-sa-500">Schedule restaurant visits, hand work to an accountable installer, issue pairing only while on site, and verify activation from live heartbeats.</p></div>
      <button onClick={() => load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-sa-700 px-4 py-2.5 text-sm font-black hover:bg-sa-800 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh queue</button>
    </header>

    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-sa-800 bg-sa-900 p-4"><p className="text-xs font-black uppercase tracking-wide text-sa-500">Visible work</p><p className="mt-2 text-3xl font-black">{items.length}</p></div>
      <div className="rounded-2xl border border-sa-800 bg-sa-900 p-4"><p className="text-xs font-black uppercase tracking-wide text-sa-500">Awaiting schedule</p><p className="mt-2 text-3xl font-black text-amber-300">{counts.INSTALL_REQUESTED || 0}</p></div>
      <div className="rounded-2xl border border-sa-800 bg-sa-900 p-4"><p className="text-xs font-black uppercase tracking-wide text-sa-500">Ready to pair</p><p className="mt-2 text-3xl font-black text-violet-300">{counts.AWAITING_PAIRING || 0}</p></div>
    </section>

    <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-sa-800 bg-sa-900 p-2">{FILTERS.map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-black ${filter === item ? 'bg-orange-500 text-white' : 'text-sa-400 hover:bg-sa-800 hover:text-white'}`}>{LABELS[item]}</button>)}</nav>
    {error && <div className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-sm font-bold text-red-300">{error}</div>}

    <section className="grid gap-4 xl:grid-cols-2">
      {loading ? [1, 2, 3, 4].map((item) => <div key={item} className="h-72 animate-pulse rounded-2xl border border-sa-800 bg-sa-900" />) : items.map((item) => <article key={item.id} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 shadow-xl shadow-black/10">
        <div className="flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-500/10 text-orange-400"><ServerCog size={22} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-black">{item.location?.name || item.name}</h2><Status value={item.status} /></div><p className="mt-1 text-xs font-bold text-sa-500">{item.restaurant?.name} · {item.restaurant?.restaurantCode}</p></div></div>
        <div className="mt-5 grid gap-4 rounded-xl bg-sa-950 p-4 sm:grid-cols-2">
          <Detail icon={MapPin} label="Site">{[item.location?.address, item.location?.city].filter(Boolean).join(', ') || item.location?.code || 'Address not recorded'}</Detail>
          <Detail icon={UserRound} label="On-site contact"><span className="font-bold text-sa-200">{item.contactName}</span><span className="block text-xs text-sa-500">{item.contactPhone || 'No phone supplied'}</span></Detail>
          <Detail icon={Mail} label="Contact email">{item.contactEmail}</Detail>
          <Detail icon={CalendarClock} label="Appointment">{item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : item.preferredVisitAt ? `Preferred ${new Date(item.preferredVisitAt).toLocaleString()}` : 'Not scheduled'}</Detail>
          <Detail icon={ClipboardCheck} label="Assigned installer">{item.assignedInstallerName || 'Unassigned'}{item.assignedInstallerEmail && <span className="block text-xs text-sa-500">{item.assignedInstallerEmail}</span>}</Detail>
          <Detail icon={Wifi} label="Live verification">{item.lastSeenAt ? `Last heartbeat ${new Date(item.lastSeenAt).toLocaleString()}` : 'Not paired yet'}{item.pendingOperationCount > 0 && <span className="block text-xs text-amber-400">{item.pendingOperationCount} operations awaiting cloud</span>}</Detail>
          <Detail icon={ShieldCheck} label="Appliance">{item.softwareVersion ? `Version ${item.softwareVersion} · schema ${item.localSchemaVersion ?? 'unknown'}` : 'Waiting for first heartbeat'}{item.softwareVersion && !item.versionCompatible && <span className="block text-xs font-black text-red-400">Update required · minimum {item.minimumSoftwareVersion}</span>}{item.agentStartedAt && <span className="block text-xs text-sa-500">Started {new Date(item.agentStartedAt).toLocaleString()}</span>}</Detail>
          <Detail icon={ServerCog} label="Platform">{item.platform === 'win32' ? 'Windows 11 x64' : item.platform === 'linux' ? `Ubuntu 24.04 ${item.architecture || ''}` : 'Select during scheduling'}{item.hostname && <span className="block text-xs text-sa-500">Managed address active</span>}</Detail>
          <Detail icon={CheckCircle2} label="Go-live gate"><span className={item.acceptanceStatus?.status === 'READY_FOR_GO_LIVE' ? 'font-black text-emerald-300' : 'text-amber-300'}>{item.acceptanceStatus?.status === 'READY_FOR_GO_LIVE' ? 'Ready for go-live' : 'Acceptance required'}</span></Detail>
        </div>
        {['ACTIVE', 'STALE'].includes(item.status) && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Database', item.healthStatus?.database?.status], ['TLS', item.healthStatus?.tls?.status], ['Disk', item.healthStatus?.disk?.status], ['Clock', item.healthStatus?.clock?.status], ['Cloud sync', item.healthStatus?.cloudSync?.status], ['Offline staff', item.healthStatus?.offlineStaffAuth?.status], ['Printers', item.healthStatus?.printerRelay?.status], ['Overall', item.healthStatus?.overall]].map(([label, health]) => <div key={label} className="rounded-lg border border-sa-800 bg-sa-950 p-2.5"><p className="text-[9px] font-black uppercase tracking-wide text-sa-600">{label}</p><p className={`mt-1 text-xs font-black ${health === 'HEALTHY' ? 'text-emerald-300' : health === 'WARNING' || health === 'NOT_CONFIGURED' ? 'text-amber-300' : 'text-red-300'}`}>{health ? title(health) : 'Not reported'}</p></div>)}</div>}
        {item.siteNotes && <p className="mt-4 rounded-xl border border-sa-800 p-3 text-sm text-sa-400"><span className="font-black text-sa-300">Site note:</span> {item.siteNotes}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-sa-800 pt-4">
          {canManage && ['INSTALL_REQUESTED', 'SCHEDULED'].includes(item.status) && <button onClick={() => openAction('schedule', item)} className="rounded-xl border border-blue-800 px-3.5 py-2 text-xs font-black text-blue-300 hover:bg-blue-500/10">{item.status === 'SCHEDULED' ? 'Reschedule' : 'Schedule visit'}</button>}
          {canManage && ['INSTALL_REQUESTED', 'SCHEDULED', 'AWAITING_PAIRING'].includes(item.status) && <button onClick={() => openAction('prepare', item)} className="rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-black text-sa-950 hover:bg-brand-400">Generate installer pairing</button>}
          {canManage && ['ACTIVE', 'STALE'].includes(item.status) && <button onClick={() => setPrinterSetup({ installation: item, printers: Array.isArray(item.printerConfiguration) ? item.printerConfiguration : [], reason: '' })} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-800 px-3.5 py-2 text-xs font-black text-violet-300 hover:bg-violet-500/10"><Printer size={14} /> Configure printers</button>}
          {canManage && item.status === 'ACTIVE' && <button onClick={() => setAcceptanceSetup({ installation: item, checks: Object.fromEntries(ACCEPTANCE_CHECKS.map(([key]) => [key, key === 'printerRecovery' && !hasEnabledPrinters(item)])), notes: '' })} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-600"><ClipboardCheck size={14} /> Go-live check</button>}
          {canManage && ['ACTIVE', 'STALE'].includes(item.status) && <button onClick={() => openAction('replace', item)} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-800 px-3.5 py-2 text-xs font-black text-amber-300 hover:bg-amber-500/10"><RotateCcw size={14} /> Replace Edge</button>}
          {canManage && item.status !== 'REVOKED' && <button onClick={() => openAction('cancel', item)} className="rounded-xl border border-red-900 px-3.5 py-2 text-xs font-black text-red-400 hover:bg-red-500/10">{['ACTIVE', 'STALE'].includes(item.status) ? 'Revoke Edge' : 'Close request'}</button>}
        </div>
      </article>)}
    </section>
    {!loading && !items.length && <div className="rounded-2xl border border-dashed border-sa-700 py-16 text-center"><CheckCircle2 size={34} className="mx-auto text-sa-600" /><h2 className="mt-3 font-black">No installations in this queue</h2><p className="mt-1 text-sm text-sa-500">There is no action required for this status.</p></div>}

    {action && <div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/80 p-4"><form onSubmit={submit} className="my-6 w-full max-w-xl rounded-2xl border border-sa-700 bg-sa-900 p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-widest text-orange-400">{action.type === 'schedule' ? 'Customer appointment' : action.type === 'prepare' ? 'Secure pairing' : action.type === 'replace' ? 'Secure replacement' : 'Recorded closure'}</p><h2 className="mt-1 text-xl font-black">{action.installation.location?.name}</h2>
      {action.type === 'schedule' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-sa-400">Visit date and time<input required type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white" /></label><label className="text-xs font-bold text-sa-400">Installer name<input required minLength={2} value={form.installerName} onChange={(event) => setForm({ ...form, installerName: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white" /></label><label className="text-xs font-bold text-sa-400 sm:col-span-2">Installer email<input required type="email" value={form.installerEmail} onChange={(event) => setForm({ ...form, installerEmail: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white" /></label></div>}
      {['schedule', 'replace'].includes(action.type) && <label className="mt-4 block text-xs font-bold text-sa-400">Edge computer<select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white"><option value="win32">Windows 11 Pro / Enterprise x64</option><option value="linux">Ubuntu 24.04 LTS</option></select></label>}
      {action.type === 'prepare' && <div className="mt-5 grid gap-4"><div className="rounded-xl border border-violet-800 bg-violet-500/10 p-3 text-xs text-violet-200"><ShieldCheck size={16} className="mb-2" />Generate this only while the technician controls the selected computer. The code expires in 15 minutes and is displayed once. Dine3D assigns the network address and provisions HTTPS automatically.</div><label className="text-xs font-bold text-sa-400">Computer name<input required minLength={2} value={form.nodeName} onChange={(event) => setForm({ ...form, nodeName: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white" /></label></div>}
      {action.type === 'replace' && <div className="mt-4 rounded-xl border border-amber-800 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">This immediately revokes the old machine credential. Its history remains available for audit, and the replacement receives a completely new identity.</div>}
      {action.type === 'replace' && action.installation.pendingOperationCount > 0 && <label className="mt-4 flex gap-3 rounded-xl border border-red-900 bg-red-500/10 p-3 text-xs leading-5 text-red-200"><input type="checkbox" checked={form.acknowledgePendingOperations} onChange={(event) => setForm({ ...form, acknowledgePendingOperations: event.target.checked })} className="mt-1" /><span>I understand that {action.installation.pendingOperationCount} operation(s) were last reported as pending. I have recovered them from the old computer or explicitly accept that they cannot be recovered.</span></label>}
      <label className="mt-4 block text-xs font-bold text-sa-400">{action.type === 'cancel' ? 'Cancellation reason' : action.type === 'replace' ? 'Replacement reason' : 'Internal handoff note'}<textarea required minLength={action.type === 'replace' ? 10 : 5} maxLength={1000} rows={4} value={form.installationNote} onChange={(event) => setForm({ ...form, installationNote: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white" placeholder="Record what was checked and the next responsible action…" /></label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAction(null)} disabled={saving} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold">Cancel</button><button disabled={saving || form.installationNote.trim().length < (action.type === 'replace' ? 10 : 5) || (action.type === 'replace' && action.installation.pendingOperationCount > 0 && !form.acknowledgePendingOperations)} className={`rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-50 ${action.type === 'cancel' ? 'bg-red-600' : action.type === 'replace' ? 'bg-amber-600' : 'bg-orange-500'}`}>{saving ? 'Saving…' : action.type === 'schedule' ? 'Schedule and notify' : action.type === 'prepare' ? 'Generate 15-minute pairing' : action.type === 'replace' ? 'Revoke and replace' : 'Close installation'}</button></div>
    </form></div>}

    {printerSetup && (
      <div className="fixed inset-0 z-[125] grid place-items-center overflow-y-auto bg-black/85 p-4">
        <form onSubmit={savePrinters} className="my-6 w-full max-w-4xl rounded-2xl border border-sa-700 bg-sa-900 p-6 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-widest text-violet-300">Installer configuration</p>
          <div className="mt-3">
            <PrinterRouteEditor
              printers={printerSetup.printers}
              disabled={saving}
              onChange={(printers) => setPrinterSetup({ ...printerSetup, printers })}
            />
          </div>
          <label className="mt-4 block text-xs font-bold text-sa-400">
            Installation note
            <textarea
              required
              minLength={5}
              maxLength={500}
              rows={3}
              value={printerSetup.reason}
              onChange={(event) => setPrinterSetup({ ...printerSetup, reason: event.target.value })}
              className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white"
              placeholder="Record the physical printer and route verification performed on site."
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setPrinterSetup(null)} disabled={saving} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold">Cancel</button>
            <button disabled={saving || printerSetup.reason.trim().length < 5} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save printer routes'}</button>
          </div>
        </form>
      </div>
    )}

    {acceptanceSetup && <div className="fixed inset-0 z-[128] grid place-items-center overflow-y-auto bg-black/85 p-4"><form onSubmit={saveAcceptance} className="my-6 w-full max-w-2xl rounded-2xl border border-emerald-800 bg-sa-900 p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-widest text-emerald-300">Final production gate</p><h2 className="mt-1 text-xl font-black">Go-live acceptance · {acceptanceSetup.installation.location?.name}</h2><p className="mt-2 text-sm leading-6 text-sa-400">Confirm only tests actually performed. Cloud also verifies the live heartbeat, Doctor, software version, queue health, and exactly one Primary POS before accepting this branch.</p><div className="mt-5 space-y-2">{ACCEPTANCE_CHECKS.filter(([key]) => key !== 'printerRecovery' || hasEnabledPrinters(acceptanceSetup.installation)).map(([key, label, detail]) => <label key={key} className="flex cursor-pointer gap-3 rounded-xl border border-sa-800 bg-sa-950 p-3"><input type="checkbox" checked={acceptanceSetup.checks[key]} onChange={(event) => setAcceptanceSetup({ ...acceptanceSetup, checks: { ...acceptanceSetup.checks, [key]: event.target.checked } })} className="mt-1" /><span><span className="block text-sm font-black text-sa-200">{label}</span><span className="block text-xs leading-5 text-sa-500">{detail}</span></span></label>)}</div><label className="mt-4 block text-xs font-bold text-sa-400">Acceptance record<textarea required minLength={10} maxLength={1000} rows={3} value={acceptanceSetup.notes} onChange={(event) => setAcceptanceSetup({ ...acceptanceSetup, notes: event.target.value })} className="mt-2 block w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white" placeholder="Record devices, printer models, and recovery test outcome." /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAcceptanceSetup(null)} disabled={saving} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold">Cancel</button><button disabled={saving || acceptanceSetup.notes.trim().length < 10 || ACCEPTANCE_CHECKS.some(([key]) => key !== 'printerRecovery' && !acceptanceSetup.checks[key]) || (hasEnabledPrinters(acceptanceSetup.installation) && !acceptanceSetup.checks.printerRecovery)} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{saving ? 'Verifying…' : 'Verify and mark ready'}</button></div></form></div>}

    {pairing && <div className="fixed inset-0 z-[130] grid place-items-center overflow-y-auto bg-black/85 p-4"><div className="my-6 w-full max-w-2xl rounded-2xl border border-violet-700 bg-sa-900 p-6 shadow-2xl"><div className="grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-violet-300"><ShieldCheck size={24} /></div><p className="mt-4 text-xs font-black uppercase tracking-widest text-violet-300">One-time installer handoff</p><h2 className="mt-1 text-xl font-black">Pair {pairing.installation.location?.name}</h2><p className="mt-2 text-sm text-sa-400">Valid until {new Date(pairing.pairingExpiresAt).toLocaleTimeString()}. Do not email it or save it in a ticket.</p>
      <p className="mt-4 text-xs font-black uppercase tracking-widest text-sa-500">Setup code — paste into &ldquo;Connect to Dine3D&rdquo; on the restaurant computer</p>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black p-4 text-xs text-emerald-300">{setupCode || 'Generating…'}</pre>
      <p className="mt-2 text-xs text-sa-500">On the appliance, open <span className="font-bold text-sa-300">Connect to Dine3D</span> (desktop or Start menu) and paste this code. Nothing else is asked for.</p>
      <details className="mt-3"><summary className="cursor-pointer text-xs font-black text-sa-500">Scripted install instead</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black p-4 text-xs text-sa-400">{setupCommand}</pre></details>
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={!setupCode} onClick={() => navigator.clipboard.writeText(setupCode).then(() => toast.success('Setup code copied'))} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"><Copy size={15} /> Copy setup code</button><button onClick={() => window.open('/superadmin/sync-health', '_blank')} className="inline-flex items-center gap-2 rounded-xl border border-sa-700 px-4 py-2 text-sm font-black"><ExternalLink size={15} /> Open verification</button><button onClick={() => setPairing(null)} className="ml-auto rounded-xl border border-sa-700 px-4 py-2 text-sm font-black">Done</button></div></div></div>}
  </div>;
}
