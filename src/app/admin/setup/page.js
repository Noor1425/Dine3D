'use client';
import { useInputDialog } from '@/components/ui/InputDialog';

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, ClipboardCheck, Cloud,
  HardDrive, Laptop, RefreshCw, ServerCog, Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';
import { getEdgeBrowserSupport } from '@/lib/offline/browserSupport';
import { useOffline } from '@/components/offline/OfflineProvider';

const BADGE = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  STALE: 'bg-red-100 text-red-800',
  INSTALL_REQUESTED: 'bg-amber-100 text-amber-900',
  SCHEDULED: 'bg-blue-100 text-blue-800',
  AWAITING_PAIRING: 'bg-violet-100 text-violet-800',
  REVOKED: 'bg-slate-200 text-slate-700',
};
const STATUS_TEXT = {
  INSTALL_REQUESTED: 'Request received', SCHEDULED: 'Visit scheduled',
  AWAITING_PAIRING: 'Technician pairing', ACTIVE: 'Installed and online',
  STALE: 'Needs attention', REVOKED: 'Closed',
};
const OPEN_REQUEST = new Set(['INSTALL_REQUESTED', 'SCHEDULED', 'AWAITING_PAIRING']);

function HealthMetric({ label, value, healthy = true }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-sm font-black ${healthy ? 'text-emerald-700' : 'text-amber-800'}`}>{value}</p></div>;
}

function ReadinessItem({ ready, label, detail }) {
  return <div className="flex items-start gap-3 py-3"><span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{ready ? '✓' : '!'}</span><div className="min-w-0"><p className="text-sm font-bold text-slate-900">{label}</p><p className="mt-0.5 break-words text-xs text-slate-500">{detail}</p></div></div>;
}

export default function SetupCenterPage() {
  // window.prompt() throws inside the Electron till, so a browser prompt is a
  // control that silently does nothing on the device staff actually use.
  const [inputDialog, askForInput] = useInputDialog();
  const access = useAdminAccess();
  const offline = useOffline();
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [devices, setDevices] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [managed, setManaged] = useState({ locationId: '', contactName: '', contactEmail: '', contactPhone: '', preferredVisitAt: '', siteNotes: '' });
  const [browserSupport, setBrowserSupport] = useState({ browser: 'Browser', version: null, minimum: null, certified: true });

  const canManageEdge = ['owner', 'manager'].includes(access.role)
    && access.can('sync.devices.register') && access.sessionType === 'normal';
  const branches = access.branches || [];

  useEffect(() => {
    setBrowserSupport(getEdgeBrowserSupport());
  }, []);

  useEffect(() => {
    const selected = access.currentBranch?.id && access.currentBranch.id !== 'all'
      ? access.currentBranch.id
      : branches.find((branch) => branch.isPrimary)?.id || branches[0]?.id || '';
    setManaged((current) => ({ ...current, locationId: current.locationId || selected }));
  }, [access.currentBranch?.id, branches]);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const refreshInstalled = () => setInstalled(media.matches || window.navigator.standalone === true);
    const capture = (event) => { event.preventDefault(); setInstallPrompt(event); };
    refreshInstalled();
    media.addEventListener?.('change', refreshInstalled);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', refreshInstalled);
    return () => {
      media.removeEventListener?.('change', refreshInstalled);
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', refreshInstalled);
    };
  }, []);

  const loadNodes = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingNodes(true);
    try {
      const [result, deviceResult, readinessResult] = await Promise.all([
        api.get('/edge/nodes'),
        ['owner', 'manager'].includes(access.role)
          ? api.get('/sync/devices').catch(() => ({ devices: [] }))
          : Promise.resolve({ devices: [] }),
        managed.locationId
          ? api.get(`/edge/readiness?locationId=${encodeURIComponent(managed.locationId)}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      setNodes(result.nodes || []);
      setDevices(deviceResult.devices || []);
      setReadiness(readinessResult);
    } catch (error) {
      if (!quiet && error.code !== 'NETWORK_UNAVAILABLE') toast.error(error.message || 'Installation status could not be loaded');
    } finally {
      if (!quiet) setLoadingNodes(false);
    }
  }, [access.role, managed.locationId]);

  useEffect(() => {
    loadNodes();
    const timer = setInterval(() => loadNodes({ quiet: true }), 15_000);
    return () => clearInterval(timer);
  }, [loadNodes]);

  const selectedNode = nodes.find((node) => node.locationId === managed.locationId && node.status !== 'REVOKED');
  const selectedPrimary = devices.find((device) => device.locationId === managed.locationId && device.isPrimaryPos && device.status === 'ACTIVE');
  const selectedDevices = devices.filter((device) => device.locationId === managed.locationId && device.status === 'ACTIVE');
  const edgeRecommended = selectedDevices.filter((device) => ['POS', 'PRIMARY_POS'].includes(device.deviceType)).length > 1
    || selectedDevices.filter((device) => device.deviceType === 'KDS').length > 1;

  const browserSecure = typeof window !== 'undefined'
    && (window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname));
  const checks = [
    { label: 'Secure connection', ready: browserSecure, detail: 'Protected browser connection verified.' },
    { label: 'Supported browser', ready: !offline.state.edgeConfigured || browserSupport.certified, detail: browserSupport.certified ? `${browserSupport.browser} ${browserSupport.version} is certified for Restaurant Network access.` : offline.state.edgeConfigured ? 'Use a current Google Chrome or Microsoft Edge browser on restaurant devices.' : 'Cloud operation remains available; Chrome or Edge is recommended for future local protection.' },
    { label: 'Local safety copy', ready: offline.ready, detail: offline.device?.name || 'Preparing this device.' },
    { label: 'Cloud synchronization', ready: offline.state.meaningfulOnline, detail: offline.state.message },
    { label: 'Correct branch', ready: Boolean(offline.context?.locationId), detail: offline.context?.locationId ? 'This device is restricted to its assigned branch.' : 'Select a branch before operating.' },
    {
      label: 'Emergency Primary POS',
      ready: Boolean(selectedPrimary) && Number(offline.context?.authorityPolicyVersion || 0) >= 1,
      detail: selectedPrimary && Number(offline.context?.authorityPolicyVersion || 0) >= 1
        ? `${selectedPrimary.name} is the only designated, cryptographically verified emergency authority for this branch.`
        : selectedPrimary
          ? `${selectedPrimary.name} is designated, but signed emergency authority is not enabled. Ask Dine3D support to complete the security configuration.`
        : ['owner', 'manager'].includes(access.role)
          ? 'Designate one trusted POS in Connection details before the opening-day outage test.'
          : 'Ask the branch manager to verify the designated Primary POS.',
    },
    {
      label: 'Automatic connection',
      ready: !offline.state.edgeConfigured || offline.state.edgeOnline,
      detail: offline.state.edgeOnline
        ? 'Local acceleration is connected automatically.'
        : offline.state.edgeConfigured
          ? 'A local service is installed; this browser may need one permission.'
          : 'Cloud is selected automatically. No local server is required.',
    },
  ];

  async function installApp() {
    if (!installPrompt) {
      toast.message(installed ? 'Dine3D is already installed on this device.' : 'Use your browser menu and choose “Install app” or “Add to Home Screen”.');
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  async function requestManagedInstall(event) {
    event.preventDefault();
    if (selectedNode) return toast.error('This branch already has an open request or Edge installation.');
    setBusy(true);
    try {
      await api.post('/edge/install-requests', {
        ...managed,
        contactPhone: managed.contactPhone || null,
        preferredVisitAt: managed.preferredVisitAt ? new Date(managed.preferredVisitAt).toISOString() : null,
        siteNotes: managed.siteNotes || null,
      });
      setShowRequest(false);
      await loadNodes({ quiet: true });
      toast.success('Managed setup requested. Your team will be contacted to schedule installation.');
    } catch (error) {
      toast.error(error.message || 'Managed setup could not be requested.');
    } finally {
      setBusy(false);
    }
  }

  async function connectLocal() {
    setBusy(true);
    try {
      const connected = await offline.connectLocal();
      if (connected) toast.success('This browser is connected to the local Dine3D service.');
      else toast.error('Local connection was not allowed or the service is unavailable. Cloud operation remains active.');
    } catch (error) {
      toast.error(error.message || 'Local connection could not be enabled.');
    } finally {
      setBusy(false);
    }
  }

  async function closeNode(node) {
    const cancelling = OPEN_REQUEST.has(node.status);
    const answer = await askForInput({
      title: cancelling ? `Cancel setup for ${node.name}` : `Revoke ${node.name}`,
      description: cancelling
        ? 'The managed setup request is withdrawn. Nothing on the device changes.'
        : 'This immediately invalidates the machine credential. The device stops syncing until it is set up again.',
      confirmLabel: cancelling ? 'Cancel setup' : 'Revoke device',
      destructive: true,
      fields: [{ name: 'reason', label: 'Reason', required: true, minLength: 5 }],
    });
    if (!answer) return;
    const { reason } = answer;
    setBusy(true);
    try {
      const path = OPEN_REQUEST.has(node.status) && node.installationMode === 'MANAGED'
        ? `/edge/install-requests/${node.id}/cancel`
        : `/edge/nodes/${node.id}/revoke`;
      await api.post(path, { reason });
      await loadNodes({ quiet: true });
      toast.success(OPEN_REQUEST.has(node.status) ? 'Installation request cancelled' : 'Edge access revoked');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="mx-auto max-w-6xl space-y-6 pb-12">
    {inputDialog}
    <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-xl sm:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">One app everywhere</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">Open Dine3D and start working</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Use the same web address and the same screens at home, in the restaurant, or on an installed device. Dine3D automatically chooses cloud or the faster local connection—staff never enter localhost addresses.</p></div><button onClick={() => offline.syncNow()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-950"><RefreshCw size={16} /> Check this device</button></div>
      <div className="mt-7 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid h-8 w-8 place-items-center rounded-full bg-blue-500 text-sm font-black">1</span><p className="mt-3 font-black">Open the normal website</p><p className="mt-1 text-xs text-slate-400">No separate local URL or local login.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid h-8 w-8 place-items-center rounded-full bg-blue-500 text-sm font-black">2</span><p className="mt-3 font-black">Sign in normally</p><p className="mt-1 text-xs text-slate-400">Your branch and permissions follow your account.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid h-8 w-8 place-items-center rounded-full bg-blue-500 text-sm font-black">3</span><p className="mt-3 font-black">Work automatically</p><p className="mt-1 text-xs text-slate-400">Cloud, offline storage, and Edge switch behind the scenes.</p></div></div>
    </header>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center"><article className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><Cloud className="text-blue-700" /><h2 className="mt-3 font-black text-slate-950">Cloud available everywhere</h2><p className="mt-2 text-sm leading-6 text-slate-600">Nothing extra to install. Open Dine3D, sign in, and use it. Each authorized browser also keeps a protected local safety copy.</p></article><div className="hidden text-center text-xs font-black uppercase tracking-widest text-slate-400 lg:block">Automatic</div><article className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><ServerCog className="text-violet-700" /><h2 className="mt-3 font-black text-slate-950">Local performance when installed</h2><p className="mt-2 text-sm leading-6 text-slate-600">For busy branches, your Dine3D team installs Edge once. The normal website finds it automatically; staff do not manage servers.</p>{canManageEdge && !selectedNode && <button onClick={() => setShowRequest(true)} className="mt-4 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white">Ask Dine3D to set up this branch</button>}</article></div>
    </section>

    {edgeRecommended && !selectedNode && <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><p className="text-xs font-black uppercase tracking-wide text-violet-700">Recommended for this branch</p><h2 className="mt-1 font-black text-violet-950">Add managed Offline Protection</h2><p className="mt-2 text-sm leading-6 text-violet-900">This branch uses multiple operational screens. Dine3D Edge is recommended so POS and kitchen devices stay coordinated during Internet outages.</p>{canManageEdge && <button onClick={() => setShowRequest(true)} className="mt-4 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white">Request Edge setup</button>}</section>}

    <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-blue-600">This device</p><h2 className="mt-1 font-black text-slate-950">Ready to use</h2></div><button onClick={installApp} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white"><Laptop size={16} /> {installed ? 'App installed' : 'Install Dine3D'}</button></div><div className="mt-4 divide-y divide-slate-100">{checks.map((check) => <ReadinessItem key={check.label} {...check} />)}</div>{offline.state.edgeConfigured && !offline.state.edgeOnline && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="flex items-start gap-3"><Wifi className="mt-0.5 shrink-0 text-violet-700" size={19} /><div><p className="text-sm font-black text-violet-950">Allow the faster restaurant connection</p><p className="mt-1 text-xs leading-5 text-violet-800">Your browser may show one standard local-network permission. Allow it once; Dine3D will connect automatically on future visits.</p><button onClick={connectLocal} disabled={busy} className="mt-3 rounded-xl bg-violet-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? 'Connecting…' : 'Connect this browser'}</button></div></div></div>}<div className="mt-4 flex flex-wrap gap-2"><button onClick={() => offline.syncNow()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800">Check now</button><a href="/admin/sync" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800">Connection details</a></div></article>
      <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Opening checklist</p><h2 className="mt-1 font-black text-slate-950">Before taking live orders</h2><div className="mt-4 space-y-3">{['Connect every operational device to secure Wi-Fi or Ethernet.', 'Sign in online once and confirm the correct branch.', 'Designate one trusted Primary POS for emergency operation.', 'Review menu, taxes, tables, staff permissions, printers, and KDS.', 'Create one training cash order and confirm it appears on another device.', 'Disconnect Internet briefly and confirm the Primary continues while secondary devices restrict checkout.', 'Restore connectivity and confirm recovery returns the pending count to zero.'].map((item, index) => <div key={item} className="flex gap-3 text-sm text-slate-700"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white font-black text-blue-700 shadow-sm">{index + 1}</span><p className="pt-0.5">{item}</p></div>)}</div></article>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Branch resilience</p><h2 className="mt-1 font-black text-slate-950">Installation status</h2><p className="mt-1 text-sm text-slate-600">Updates automatically every 15 seconds. Restaurant staff never need the Edge password or certificate files.</p></div><button onClick={() => loadNodes()} disabled={loadingNodes} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw size={14} className={loadingNodes ? 'animate-spin' : ''} /> Refresh</button></div>
      {loadingNodes ? <div className="mt-5 h-32 animate-pulse rounded-xl bg-slate-100" /> : nodes.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center"><HardDrive className="mx-auto text-slate-400" /><p className="mt-3 font-bold text-slate-800">No Edge installation requested</p><p className="mt-1 text-sm text-slate-500">That is normal for small restaurants; standard offline protection is already active.</p></div> : <div className="mt-5 grid gap-3 md:grid-cols-2">{nodes.map((node) => { const branch = branches.find((item) => item.id === node.locationId); const branchDevices = devices.filter((device) => device.locationId === node.locationId && device.status === 'ACTIVE'); const posCount = branchDevices.filter((device) => ['POS', 'PRIMARY_POS'].includes(device.deviceType)).length; const kdsCount = branchDevices.filter((device) => device.deviceType === 'KDS').length; const primary = branchDevices.find((device) => device.isPrimaryPos); const printerHealth = node.healthStatus?.printerRelay; return <article key={node.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{branch?.name || node.name}</p><p className="mt-0.5 text-xs text-slate-500">{node.installationMode === 'MANAGED' ? 'Managed by Dine3D' : 'Technician self-install'}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${BADGE[node.status] || BADGE.STALE}`}>{STATUS_TEXT[node.status] || node.status.replaceAll('_', ' ')}</span></div>
        {node.status === 'SCHEDULED' && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900"><CalendarClock size={15} className="mb-1" />Visit: <strong>{new Date(node.scheduledFor).toLocaleString()}</strong>{node.assignedInstallerName && <> · {node.assignedInstallerName}</>}</div>}
        {node.status === 'ACTIVE' || node.status === 'STALE' ? <><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"><HealthMetric label="Restaurant Network" value={node.status === 'ACTIVE' ? 'Connected ✓' : 'Needs attention'} healthy={node.status === 'ACTIVE'} /><HealthMetric label="Cloud Sync" value={node.healthStatus?.cloudSync?.status === 'HEALTHY' ? 'Healthy ✓' : `${node.pendingOperationCount || 0} waiting`} healthy={node.healthStatus?.cloudSync?.status === 'HEALTHY'} /><HealthMetric label="Offline Protection" value={node.healthStatus?.database?.status === 'HEALTHY' ? 'Active ✓' : 'Needs attention'} healthy={node.healthStatus?.database?.status === 'HEALTHY'} /><HealthMetric label="Primary POS" value={primary?.name || 'Not selected'} healthy={Boolean(primary)} /><HealthMetric label="POS / Kitchen" value={`${posCount} POS · ${kdsCount} KDS`} healthy={posCount > 0} /><HealthMetric label="Printers" value={printerHealth?.configured ? `${printerHealth.healthy} / ${printerHealth.configured} online` : 'Not configured'} healthy={!printerHealth?.configured || printerHealth.healthy === printerHealth.configured} /></div><p className="mt-3 text-xs text-slate-500">Last sync: {node.lastCloudSyncAt ? new Date(node.lastCloudSyncAt).toLocaleString() : 'Waiting for first sync'}</p></> : <div className="mt-3 flex items-center gap-2 text-xs text-slate-600"><ClipboardCheck size={15} className="text-violet-600" />Your team handles the remaining technical steps.</div>}
        {node.status !== 'REVOKED' && canManageEdge && <button disabled={busy} onClick={() => closeNode(node)} className="mt-3 text-xs font-bold text-red-700">{OPEN_REQUEST.has(node.status) ? 'Cancel request…' : 'Revoke installation…'}</button>}</article>; })}</div>}
    </section>

    {readiness && <section className={`rounded-2xl border p-5 shadow-sm ${readiness.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className={`text-xs font-black uppercase tracking-wide ${readiness.ready ? 'text-emerald-700' : 'text-amber-800'}`}>Go-live readiness</p><h2 className="mt-1 text-xl font-black text-slate-950">{readiness.ready ? 'Ready for go-live' : `${readiness.blockers.length} item${readiness.blockers.length === 1 ? '' : 's'} need attention`}</h2><p className="mt-1 text-sm text-slate-600">{readiness.deploymentProfile === 'EDGE' ? 'Managed Offline Protection profile' : 'Standard Cloud + device protection profile'} · checked {new Date(readiness.checkedAt).toLocaleTimeString()}</p></div><button onClick={() => loadNodes()} disabled={loadingNodes} className="rounded-xl border border-current px-3 py-2 text-xs font-black">Run readiness check</button></div><div className="mt-4 grid gap-2 md:grid-cols-2">{readiness.items.map((item) => <div key={item.key} className="rounded-xl bg-white/80 px-4 py-3"><div className="flex items-center gap-2"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${item.status === 'PASS' ? 'bg-emerald-100 text-emerald-700' : item.status === 'WARNING' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}`}>{item.status === 'PASS' ? '✓' : '!'}</span><p className="text-sm font-black text-slate-900">{item.label}</p></div><p className="mt-1 pl-7 text-xs text-slate-600">{item.detail}</p></div>)}</div></section>}

    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h2 className="font-black">Payment safety</h2><p className="mt-1">Cash orders may be captured inside the authorized offline window. Offline electronic payments follow the certified payment provider’s rules and are never treated as approved without provider confirmation.</p></section>

    {showRequest && <div className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-slate-950/75 p-4"><form onSubmit={requestManagedInstall} className="my-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-wide text-violet-700">Managed installation</p><h2 className="mt-1 text-xl font-black text-slate-950">Let Dine3D handle the technical setup</h2><p className="mt-2 text-sm text-slate-600">Provide only the details needed to contact the site and arrange access. Your team will configure networking, HTTPS, Edge service startup, and the final outage test.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">Branch<select required value={managed.locationId} onChange={(event) => setManaged({ ...managed, locationId: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm"><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="text-xs font-bold text-slate-700">On-site contact name<input required minLength={2} maxLength={120} value={managed.contactName} onChange={(event) => setManaged({ ...managed, contactName: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" /></label><label className="text-xs font-bold text-slate-700">Contact email<input required type="email" maxLength={254} value={managed.contactEmail} onChange={(event) => setManaged({ ...managed, contactEmail: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" /></label><label className="text-xs font-bold text-slate-700">Phone <span className="font-medium text-slate-400">(optional)</span><input maxLength={40} value={managed.contactPhone} onChange={(event) => setManaged({ ...managed, contactPhone: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" /></label><label className="text-xs font-bold text-slate-700 sm:col-span-2">Preferred visit time <span className="font-medium text-slate-400">(optional)</span><input type="datetime-local" value={managed.preferredVisitAt} onChange={(event) => setManaged({ ...managed, preferredVisitAt: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" /></label><label className="text-xs font-bold text-slate-700 sm:col-span-2">Site notes <span className="font-medium text-slate-400">(optional)</span><textarea rows={3} maxLength={1000} value={managed.siteNotes} onChange={(event) => setManaged({ ...managed, siteNotes: event.target.value })} className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Opening date, access hours, network contact, or anything the installer should know…" /></label></div>{selectedNode && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">This branch already has an open request or Edge installation.</div>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowRequest(false)} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={busy || Boolean(selectedNode)} className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? 'Sending request…' : 'Request managed installation'}</button></div></form></div>}
  </div>;
}
