'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import saApi from '@/lib/saApi';
import { AlertTriangle, Building2, CircleCheck, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: 'Last 7 days', days: 6 },
  { key: '30d', label: 'Last 30 days', days: 29 },
  { key: 'month', label: 'Current month', month: true },
  { key: 'custom', label: 'Custom' }
];
const CHART_COLORS = ['#f97316', '#3b82f6', '#10b981', '#a855f7', '#eab308', '#ef4444'];

const isoDate = (value) => new Date(value).toISOString().slice(0, 10);
const presetRange = (preset) => {
  const to = new Date();
  const from = new Date(to);
  if (preset.month) from.setDate(1);
  else from.setDate(from.getDate() - (preset.days || 0));
  from.setHours(0, 0, 0, 0);
  return { from: isoDate(from), to: isoDate(to) };
};

function MetricCard({ label, value, detail, href, tone = 'neutral' }) {
  const tones = {
    green: 'text-emerald-400',
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    neutral: 'text-white'
  };
  return (
    <Link href={href} className="rounded-2xl border border-sa-800 bg-sa-900 p-4 transition hover:border-sa-600 focus:outline-none focus:ring-2 focus:ring-orange-500">
      <div className={`text-2xl font-black ${tones[tone]}`}>{value ?? '—'}</div>
      <div className="mt-1 text-sm font-bold text-sa-300">{label}</div>
      {detail && <div className="mt-1 text-xs text-sa-500">{detail}</div>}
    </Link>
  );
}

function EmptyChart({ children }) {
  return <div className="flex h-64 items-center justify-center text-center text-sm text-sa-500">{children}</div>;
}

function PostureCard({ icon: Icon, label, value, detail, href, status = 'neutral' }) {
  const styles = {
    good: 'border-emerald-900/70 bg-emerald-500/5 text-emerald-400',
    warning: 'border-amber-900/70 bg-amber-500/5 text-amber-300',
    critical: 'border-red-900/70 bg-red-500/5 text-red-300',
    neutral: 'border-sa-800 bg-sa-900 text-blue-400'
  };
  return <Link href={href} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 ${styles[status]}`}><div className="flex items-start gap-3"><span className="rounded-xl bg-black/20 p-2"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-sa-500">{label}</span><span className="mt-1 block text-lg font-black text-white">{value}</span><span className="mt-1 block text-xs text-sa-500">{detail}</span></span></div></Link>;
}

const changeDetail = (current, previous, noun) => {
  if (!previous) return `${Number(current || 0).toLocaleString()} ${noun}; no activity in the prior period`;
  const change = Math.round(((Number(current || 0) - previous) / previous) * 100);
  return `${change >= 0 ? '+' : ''}${change}% from the previous equivalent period`;
};

export default function SuperAdminOverview() {
  const defaultRange = useMemo(() => presetRange(PRESETS[2]), []);
  const [preset, setPreset] = useState('30d');
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const load = async (nextRange = range) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        from: new Date(`${nextRange.from}T00:00:00`).toISOString(),
        to: new Date(`${nextRange.to}T23:59:59.999`).toISOString()
      });
      setData(await saApi.getOverview(query.toString()));
      setLastRefreshedAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Dashboard data could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(defaultRange); }, []);

  const selectPreset = (item) => {
    setPreset(item.key);
    if (item.key === 'custom') return;
    const nextRange = presetRange(item);
    setRange(nextRange);
    load(nextRange);
  };

  const stats = data?.stats || {};
  const charts = data?.charts || {};
  const integer = (value) => Number(value || 0).toLocaleString();
  const money = (value, currency = 'PKR') => {
    const amount = Number(value || 0);
    try {
      return new Intl.NumberFormat('en-PK', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString()}`;
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Command center</h1>
          <p className="mt-1 text-sm text-sa-500">Operate customers, revenue, trust, and infrastructure from one accountable control plane.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastRefreshedAt && <span className="hidden text-[10px] text-sa-600 sm:block">Updated {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          <button onClick={() => load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-sa-700 px-3 py-2 text-xs font-bold text-sa-300 hover:bg-sa-900 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <div className="flex flex-wrap gap-1 rounded-xl border border-sa-800 bg-sa-900 p-1" aria-label="Dashboard date range">
            {PRESETS.map((item) => (
              <button key={item.key} onClick={() => selectPreset(item)} className={`rounded-lg px-3 py-2 text-xs font-bold ${preset === item.key ? 'bg-orange-500 text-white' : 'text-sa-400 hover:text-white'}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {preset === 'custom' && (
        <form onSubmit={(event) => { event.preventDefault(); load(); }} className="flex flex-wrap items-end gap-3 rounded-2xl border border-sa-800 bg-sa-900 p-4">
          <label className="text-xs font-bold text-sa-400">From<input required type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="mt-1 block rounded-lg border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label>
          <label className="text-xs font-bold text-sa-400">To<input required type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="mt-1 block rounded-lg border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label>
          <button disabled={loading} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">Apply range</button>
        </form>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-800 bg-red-500/10 p-5 text-sm text-red-300">
          {error} <button onClick={() => load()} className="ml-2 font-black underline">Retry</button>
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 12 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-sa-900" />)}</div>
      ) : data && (
        <>
          <section aria-labelledby="attention-heading">
            <div className="mb-3 flex items-center justify-between"><div><h2 id="attention-heading" className="text-sm font-black">Platform posture</h2><p className="text-xs text-sa-600">Actionable risk and customer-health signals for the selected period.</p></div><Link href="/superadmin/audit-logs" className="text-xs font-bold text-orange-400">Review operator activity</Link></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PostureCard icon={data.system.alerts.length ? AlertTriangle : CircleCheck} label="Operations" value={data.system.alerts.length ? `${data.system.alerts.length} alert types` : 'No active alerts'} detail={data.system.alerts.length ? `${data.system.alerts.reduce((sum, alert) => sum + alert.count, 0)} events require review` : 'Database, jobs, and billing show no current failures'} href="/superadmin/system-health" status={data.system.alerts.some((alert) => alert.severity === 'critical') ? 'critical' : data.system.alerts.length ? 'warning' : 'good'} />
              <PostureCard icon={Building2} label="Customer activation" value={`${integer(stats.onboardingBacklog)} in onboarding`} detail={`${Math.round((Number(stats.activeRestaurants || 0) / Math.max(Number(stats.totalRestaurants || 0), 1)) * 100)}% of restaurants are active`} href="/superadmin/restaurants" status={stats.onboardingBacklog ? 'warning' : 'good'} />
              <PostureCard icon={ShieldCheck} label="Trust posture" value={stats.criticalSecurityEvents ? `${integer(stats.criticalSecurityEvents)} critical events` : 'No critical events'} detail={stats.platformAdminsWithoutMfa ? `${integer(stats.platformAdminsWithoutMfa)} active platform admins need MFA` : 'Every active platform admin has MFA enabled'} href="/superadmin/security-logs?severity=CRITICAL" status={stats.criticalSecurityEvents ? 'critical' : stats.platformAdminsWithoutMfa ? 'warning' : 'good'} />
              <PostureCard icon={CreditCard} label="Payment reliability" value={stats.totalPayments ? `${Math.max(0, 100 - Math.round((stats.failedPayments / stats.totalPayments) * 1000) / 10)}% successful` : 'No payment attempts'} detail={`${integer(stats.failedPayments)} failed of ${integer(stats.totalPayments)} payment attempts`} href="/superadmin/orders?paymentStatus=failed" status={stats.failedPayments ? 'warning' : 'good'} />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <MetricCard label="Total restaurants" value={integer(stats.totalRestaurants)} href="/superadmin/restaurants" />
            <MetricCard label="Active restaurants" value={integer(stats.activeRestaurants)} href="/superadmin/restaurants?status=active" tone="green" />
            <MetricCard label="Trial restaurants" value={integer(stats.trialRestaurants)} href="/superadmin/subscriptions?status=TRIALING" tone="blue" />
            <MetricCard label="Suspended restaurants" value={integer(stats.suspendedRestaurants)} href="/superadmin/restaurants?status=suspended" tone="red" />
            <MetricCard label="Active subscriptions" value={integer(stats.activeSubscriptions)} href="/superadmin/subscriptions?status=ACTIVE" tone="green" />
            <MetricCard label="Past-due subscriptions" value={integer(stats.pastDueSubscriptions)} href="/superadmin/subscriptions?status=PAST_DUE" tone="amber" />
            <MetricCard label="Expiring in 30 days" value={integer(stats.expiringSubscriptions)} href="/superadmin/subscriptions?expiring=30" tone="amber" />
            <MetricCard
              label="Billed last month"
              value={data.billing?.available ? money(data.billing.invoiced, data.billing.currency) : 'No data yet'}
              detail={data.billing?.available
                ? `${integer(data.billing.invoiceCount)} invoices \u00b7 ${money(data.billing.collected, data.billing.currency)} collected`
                : data.billing?.message}
              href="/superadmin/payments"
              tone={data.billing?.available ? 'green' : undefined}
            />
            <MetricCard
              label="Outstanding"
              value={data.billing?.available ? money(data.billing.outstanding, data.billing.currency) : '—'}
              detail={data.billing?.overdueInvoices
                ? `${integer(data.billing.overdueInvoices)} overdue \u00b7 ${money(data.billing.overdue, data.billing.currency)}`
                : `${integer(data.billing?.outstandingInvoices || 0)} unpaid invoices`}
              href="/superadmin/payments"
              tone={data.billing?.overdue > 0 ? 'red' : data.billing?.outstanding > 0 ? 'amber' : 'green'}
            />
            <MetricCard label="New restaurants in range" value={integer(stats.newRestaurants)} detail={changeDetail(stats.newRestaurants, stats.comparisons?.newRestaurants, 'restaurants')} href={`/superadmin/restaurants?createdFrom=${encodeURIComponent(data.range.from)}&createdTo=${encodeURIComponent(data.range.to)}`} />
            <MetricCard label="Locations" value={integer(stats.totalLocations)} href="/superadmin/restaurants" />
            <MetricCard label="Orders today" value={integer(stats.todayOrders)} href="/superadmin/orders?range=today" />
            <MetricCard label="QR orders in range" value={integer(stats.rangeQrOrders)} detail={`${integer(stats.rangeOrders)} all-channel orders · ${changeDetail(stats.rangeOrders, stats.comparisons?.rangeOrders, 'orders')}`} href="/superadmin/orders?source=QR" tone="blue" />
            <MetricCard label="Effective active QR codes" value={integer(stats.activeQrCodes)} href="/superadmin/operations?tab=qr" tone="blue" />
            <MetricCard label="Inventory items" value={integer(stats.totalInventoryItems)} href="/superadmin/operations?tab=inventory" />
            <MetricCard label="Failed order payments" value={integer(stats.failedPayments)} href="/superadmin/orders?paymentStatus=failed" tone={stats.failedPayments ? 'red' : 'green'} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <div className="mb-5"><h2 className="font-black">Order volume</h2><p className="text-xs text-sa-500">All orders and QR-origin orders in the selected range.</p></div>
              {charts.orderVolume?.length ? <div className="h-64"><ResponsiveContainer><LineChart data={charts.orderVolume}><CartesianGrid stroke="#262626" vertical={false} /><XAxis dataKey="date" stroke="#737373" fontSize={10} /><YAxis stroke="#737373" fontSize={10} allowDecimals={false} /><Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #404040' }} /><Line type="monotone" dataKey="orders" stroke="#f97316" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="qrOrders" stroke="#3b82f6" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <EmptyChart>No orders were recorded in this range.</EmptyChart>}
            </section>

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <div className="mb-5"><h2 className="font-black">Restaurant growth</h2><p className="text-xs text-sa-500">New restaurants created per day.</p></div>
              {charts.restaurantGrowth?.length ? <div className="h-64"><ResponsiveContainer><BarChart data={charts.restaurantGrowth}><CartesianGrid stroke="#262626" vertical={false} /><XAxis dataKey="date" stroke="#737373" fontSize={10} /><YAxis stroke="#737373" fontSize={10} allowDecimals={false} /><Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #404040' }} /><Bar dataKey="count" fill="#10b981" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyChart>No restaurants were created in this range.</EmptyChart>}
            </section>

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <div className="mb-2"><h2 className="font-black">Subscriptions by plan</h2><p className="text-xs text-sa-500">Current database assignments.</p></div>
              {charts.subscriptionDistribution?.length ? <div className="grid items-center md:grid-cols-[1fr_180px]"><div className="space-y-2">{charts.subscriptionDistribution.map((item, index) => <Link href={`/superadmin/subscriptions?planId=${item.planId}`} key={item.planId} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-sa-800"><span><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />{item.name}</span><strong>{item.count}</strong></Link>)}</div><div className="h-48"><ResponsiveContainer><PieChart><Pie data={charts.subscriptionDistribution} dataKey="count" nameKey="name" innerRadius={42} outerRadius={72}>{charts.subscriptionDistribution.map((item, index) => <Cell key={item.planId} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #404040' }} /></PieChart></ResponsiveContainer></div></div> : <EmptyChart>No subscriptions are assigned.</EmptyChart>}
            </section>

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <h2 className="font-black">Trial conversion</h2>
              {charts.trialConversion?.rate === null ? <EmptyChart>No trials started in the selected range, so a conversion rate cannot be calculated.</EmptyChart> : <div className="flex h-64 items-center justify-center text-center"><div><div className="text-5xl font-black text-blue-400">{charts.trialConversion.rate}%</div><div className="mt-3 text-sm text-sa-400">{charts.trialConversion.converted} converted from {charts.trialConversion.started} trials started</div></div></div>}
            </section>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
              <div className="flex items-center justify-between border-b border-sa-800 p-5"><div><h2 className="font-black">System alerts</h2><p className="text-xs text-sa-500">Only real unresolved signals are shown.</p></div><Link href="/superadmin/system-health" className="text-xs font-bold text-orange-400">System health</Link></div>
              {data.system.alerts.length ? <div className="divide-y divide-sa-800">{data.system.alerts.map((alert) => <Link href={alert.href} key={alert.type} className="flex items-center justify-between p-4 hover:bg-sa-800/50"><span className={alert.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}>{alert.label}</span><strong>{alert.count}</strong></Link>)}</div> : <div className="p-8 text-center text-sm text-emerald-400">No current failure or low-stock signals.</div>}
              <div className="grid grid-cols-2 border-t border-sa-800 p-4 text-xs text-sa-400"><div>Database: <strong className="text-white">{data.system.database}</strong> ({data.system.databaseLatencyMs} ms aggregate cycle)</div><div>API process uptime: <strong className="text-white">{Math.floor(data.system.processUptimeSeconds / 60)} min</strong></div></div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
              <div className="flex items-center justify-between border-b border-sa-800 p-5"><div><h2 className="font-black">Recent Super Admin activity</h2><p className="text-xs text-sa-500">Immutable control-plane audit records.</p></div><Link href="/superadmin/audit-logs" className="text-xs font-bold text-orange-400">View audit</Link></div>
              {data.recentAdminActivity.length ? <div className="divide-y divide-sa-800">{data.recentAdminActivity.map((item) => <div key={item.id} className="p-4 text-sm"><div className="flex items-center justify-between gap-2"><div className="font-bold">{item.action.replaceAll('.', ' ')}</div><span className="text-[10px] font-bold text-sa-500">{item.actor?.name || item.actor?.email || item.actorRole}</span></div><div className="mt-1 text-xs text-sa-500">{item.restaurant?.name || item.entityType} · {new Date(item.createdAt).toLocaleString()} · {item.reason || 'No reason recorded'}</div></div>)}</div> : <div className="p-8 text-center text-sm text-sa-500">No administrative changes have been recorded.</div>}
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
            <div className="flex items-center justify-between border-b border-sa-800 p-5"><div><h2 className="font-black">Recently added restaurants</h2><p className="text-xs text-sa-500">Newest tenant records.</p></div><Link href="/superadmin/restaurants" className="text-xs font-bold text-orange-400">Restaurant directory</Link></div>
            {data.recentRestaurants.length ? <div className="divide-y divide-sa-800">{data.recentRestaurants.map((restaurant) => <Link href={`/superadmin/restaurants/${restaurant.id}`} key={restaurant.id} className="grid gap-2 p-4 hover:bg-sa-800/50 sm:grid-cols-[1fr_auto_auto]"><div><div className="font-bold">{restaurant.name}</div><div className="text-xs text-sa-500">/{restaurant.slug} · {restaurant.subscription?.plan?.name || 'No plan'}</div></div><div className="text-xs text-sa-400">{restaurant._count.branches} locations · {restaurant._count.orders} orders</div><span className={restaurant.isActive ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-red-400'}>{restaurant.isActive ? 'Active' : 'Suspended'}</span></Link>)}</div> : <div className="p-8 text-center text-sm text-sa-500">No restaurants exist yet.</div>}
          </section>
        </>
      )}
    </div>
  );
}
