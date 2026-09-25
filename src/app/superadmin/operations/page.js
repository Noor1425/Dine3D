'use client';

import { useEffect, useState } from 'react';
import saApi from '@/lib/saApi';
import StatusBadge from '@/components/superadmin/StatusBadge';

const TABS = ['failures', 'email', 'qr', 'inventory', 'jobs'];
const date = (value) => value ? new Date(value).toLocaleString() : '—';

export default function OperationsPage() {
  const [tab, setTab] = useState('failures');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restaurant, setRestaurant] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams();
      Object.entries({ restaurant, location, status, source, from, to }).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });
      setData(await saApi.getOperations(query.toString()));
    }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const requested = new URLSearchParams(window.location.search).get('tab');
      if (TABS.includes(requested)) setTab(requested);
    }
    load();
  }, []);

  return <div className="space-y-6"><div><h1 className="text-2xl font-black">QR &amp; inventory</h1><p className="mt-1 text-sm text-sa-500">Read-only cross-tenant failures, transactional email delivery, QR security events, low stock, jobs, and billing synchronization signals.</p></div>
    <form onSubmit={(event) => { event.preventDefault(); load(); }} className="grid gap-2 rounded-2xl border border-sa-800 bg-sa-900 p-4 sm:grid-cols-2 xl:grid-cols-7">
      <input value={restaurant} onChange={(event) => setRestaurant(event.target.value)} placeholder="Restaurant name or slug" aria-label="Restaurant" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
      <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location name" aria-label="Location" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Order status" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">Any order status</option><option>FAILED</option><option>CANCELLED</option></select>
      <select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Order source" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">Any order source</option><option>QR</option><option>POS</option></select>
      <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
      <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
      <button disabled={loading} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">Apply filters</button>
    </form>
    <div className="flex gap-1 overflow-x-auto border-b border-sa-800">{TABS.map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-sm font-bold capitalize ${tab === item ? 'border-orange-500 text-orange-400' : 'border-transparent text-sa-500'}`}>{item}</button>)}</div>
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-red-300">{error} <button onClick={load} className="font-black underline">Retry</button></div>}
    {loading ? <div className="h-48 animate-pulse rounded-2xl bg-sa-900" /> : data && <>
      {tab === 'failures' && <div className="grid gap-5 xl:grid-cols-2"><Panel title="Failed order submissions" empty="No failed order submissions were persisted.">{data.failedOrders.map((item) => <Row key={item.id} title={`${item.restaurant.name} · ${item.orderNumber || item.id.slice(0, 8)}`} detail={`${item.failureReason || item.status} · ${item.branch?.name || 'No location'} · ${date(item.createdAt)}`} status="FAILED" />)}</Panel><Panel title="Failed subscription billing events" empty="No failed billing events.">{data.failedBillingEvents.map((item) => <Row key={item.id} title={`${item.provider} · ${item.eventType}`} detail={`${item.error || 'No error detail'} · attempts ${item.attempts} · ${date(item.createdAt)}`} status="FAILED" />)}</Panel><Unavailable data={data.telemetry.integrationFailures} label="Integration failures" /><Unavailable data={data.telemetry.failedStockDeductions} label="Failed stock deductions" /></div>}
      {tab === 'email' && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Transport" value={data.telemetry.failedNotifications.provider.provider.toUpperCase()} /><Metric label="Configuration" value={data.telemetry.failedNotifications.provider.configured ? 'Ready' : 'Incomplete'} tone={data.telemetry.failedNotifications.provider.configured ? 'good' : 'warning'} /><Metric label="Suppressed recipients" value={data.telemetry.failedNotifications.activeSuppressions} tone={data.telemetry.failedNotifications.activeSuppressions ? 'warning' : 'good'} /></div><Panel title="Email delivery exceptions" empty="No failed, delayed, bounced, complained, or suppressed emails in this period.">{data.failedEmailDeliveries.map((item) => <Row key={item.id} title={`${item.templateKey.replaceAll('_', ' ')} · ${item.recipient}`} detail={`${item.failureMessage || item.failureCode || item.status} · attempts ${item.attemptCount}/${item.maxAttempts}${item.nextAttemptAt ? ` · retry ${date(item.nextAttemptAt)}` : ''} · ${date(item.createdAt)}`} status={item.status} />)}</Panel></div>}
      {tab === 'qr' && <Panel title="Invalid or revoked QR security activity" empty="No QR-related security events are recorded.">{data.qrSecurityEvents.map((item) => <Row key={item.id} title={item.type} detail={`${item.message} · ${date(item.createdAt)}`} status={item.severity === 'CRITICAL' ? 'FAILED' : item.severity} />)}</Panel>}
      {tab === 'inventory' && <Panel title="Unacknowledged low-stock alerts" empty="No unacknowledged low-stock alerts.">{data.lowStockAlerts.map((item) => <Row key={item.id} title={`${item.restaurant.name} · ${item.ingredient.name}`} detail={`${item.location.name} · stock ${Number(item.currentStock)} / threshold ${Number(item.threshold)} ${item.ingredient.unit} · ${date(item.createdAt)}`} status="PAST_DUE" />)}</Panel>}
      {tab === 'jobs' && <Panel title="Background job runs" empty="No tracked job runs yet.">{data.failedJobs.map((item) => <Row key={item.id} title={item.jobKey} detail={`${item.error || 'Completed without an error'} · ${date(item.createdAt)}`} status={item.status} />)}</Panel>}
    </>}
  </div>;
}

function Panel({ title, empty, children }) {
  const content = Array.isArray(children) ? children : [children];
  return <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900"><h2 className="border-b border-sa-800 p-5 font-black">{title}</h2>{content.filter(Boolean).length ? <div className="divide-y divide-sa-800">{children}</div> : <div className="p-10 text-center text-sm text-sa-500">{empty}</div>}</section>;
}
function Row({ title, detail, status }) { return <div className="flex items-start justify-between gap-4 p-4 text-sm"><div><div className="font-bold">{title}</div><div className="mt-1 text-xs text-sa-500">{detail}</div></div><StatusBadge status={status} /></div>; }
function Metric({ label, value, tone }) { return <div className="rounded-2xl border border-sa-800 bg-sa-900 p-4"><div className="text-xs font-bold uppercase tracking-wide text-sa-500">{label}</div><div className={`mt-2 text-xl font-black capitalize ${tone === 'good' ? 'text-emerald-400' : tone === 'warning' ? 'text-amber-400' : 'text-white'}`}>{String(value)}</div></div>; }
function Unavailable({ label, data }) { return <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">{label}</h2><p className="mt-3 text-sm text-sa-500">Unavailable: {data.message}</p></section>; }
