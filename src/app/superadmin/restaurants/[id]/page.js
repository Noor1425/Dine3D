'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';
import ConfirmActionDialog from '@/components/superadmin/ConfirmActionDialog';
import StatusBadge from '@/components/superadmin/StatusBadge';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';

const TABS = ['Overview', 'People & locations', 'Access & usage', 'QR & operations', 'Billing & support', 'Notes & audit'];
const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';

export default function RestaurantDetailsPage({ params }) {
  const { can } = useSuperAdminAccess();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(TABS[0]);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ name: '', countryCode: '', reason: '' });
  const [owner, setOwner] = useState({ staffId: '', reason: '' });
  const [note, setNote] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [mutating, setMutating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await saApi.getRestaurant(params.id);
      setData(result);
      setEdit({ name: result.restaurant.name, countryCode: result.restaurant.countryCode || '', reason: '' });
      setOwner((current) => ({ ...current, staffId: result.restaurant.staff.find((member) => member.role === 'owner')?.id || result.restaurant.staff[0]?.id || '' }));
    } catch (loadError) {
      setError(loadError.message || 'Restaurant details could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [params.id]);
  if (loading && !data) return <div className="space-y-4">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-sa-900" />)}</div>;
  if (error && !data) return <div role="alert" className="rounded-2xl border border-red-800 bg-red-500/10 p-6 text-red-300">{error} <button onClick={load} className="font-black underline">Retry</button></div>;

  const restaurant = data.restaurant;
  const status = restaurant.isActive ? restaurant.subscription?.status : 'SUSPENDED';
  const features = Object.entries(data.effectiveAccess?.features || {});
  const limits = Object.entries(data.effectiveAccess?.limits || {});

  const saveEdit = async (event) => {
    event.preventDefault();
    if (mutating) return;
    setMutating(true);
    try {
      await saApi.updateRestaurant(restaurant.id, { ...edit });
      toast.success('Restaurant information updated');
      setEditing(false);
      await load();
    } catch (saveError) { toast.error(saveError.message); }
    finally { setMutating(false); }
  };
  const changeOwner = async (event) => {
    event.preventDefault();
    if (mutating) return;
    setMutating(true);
    try {
      await saApi.changeRestaurantOwner(restaurant.id, { ...owner, confirmed: true });
      toast.success('Owner changed and affected sessions revoked');
      await load();
    } catch (ownerError) { toast.error(ownerError.message); }
    finally { setMutating(false); }
  };
  const addNote = async (event) => {
    event.preventDefault();
    if (mutating) return;
    setMutating(true);
    try {
      await saApi.addRestaurantNote(restaurant.id, { body: note });
      setNote('');
      toast.success('Internal note added');
      await load();
    } catch (noteError) { toast.error(noteError.message); }
    finally { setMutating(false); }
  };
  const runConfirmedAction = async ({ reason, confirmation }) => {
    if (confirmAction === 'revoke') {
      await saApi.revokeRestaurantSessions(restaurant.id, { reason, confirmation, confirmed: true });
      toast.success('All restaurant sessions revoked');
    } else if (confirmAction === 'reset') {
      await saApi.resetRestaurantOnboarding(restaurant.id, { reason, confirmed: true });
      toast.success('Onboarding state reset');
    } else {
      const isActive = confirmAction === 'reactivate';
      await saApi.updateRestaurant(restaurant.id, { isActive, reason, confirmation, confirmed: true });
      toast.success(isActive ? 'Restaurant reactivated' : 'Restaurant suspended');
    }
    await load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><Link href="/superadmin/restaurants" className="text-xs font-bold text-sa-500 hover:text-white">← Restaurant directory</Link><div className="mt-2 flex items-center gap-3"><h1 className="text-2xl font-black">{restaurant.name}</h1><StatusBadge status={status} /></div><p className="mt-1 font-mono text-sm font-bold tracking-wider text-orange-400">{restaurant.restaurantCode}</p><p className="mt-1 text-sm text-sa-500">/{restaurant.slug} · {restaurant.countryCode || 'Country not set'} · created {new Date(restaurant.createdAt).toLocaleDateString()}</p></div>
        <div className="flex flex-wrap gap-2">{can('subscriptions.view') && <Link href={`/superadmin/subscriptions?restaurantId=${restaurant.id}`} className="rounded-xl border border-sa-700 px-3 py-2 text-sm font-bold hover:bg-sa-800">Manage subscription</Link>}{can('restaurants.suspend') && <button onClick={() => setConfirmAction(restaurant.isActive ? 'suspend' : 'reactivate')} className={`rounded-xl px-3 py-2 text-sm font-black ${restaurant.isActive ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>{restaurant.isActive ? 'Suspend' : 'Reactivate'}</button>}</div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-sa-800" role="tablist">{TABS.map((item) => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold ${tab === item ? 'border-orange-500 text-orange-400' : 'border-transparent text-sa-500 hover:text-white'}`}>{item}</button>)}</div>

      {tab === 'Overview' && <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[['Orders today', data.summaries.todayOrders], ['Orders · 30 days', data.summaries.last30DayOrders], ['Total orders', data.summaries.totalOrders], ['Active QR codes', data.summaries.activeQrCodes], ['Inventory items', data.summaries.inventoryItems], ['Low-stock alerts', data.summaries.lowStockAlerts]].map(([label, value]) => <div key={label} className="rounded-2xl border border-sa-800 bg-sa-900 p-4"><div className="text-2xl font-black">{Number(value).toLocaleString()}</div><div className="mt-1 text-xs text-sa-500">{label}</div></div>)}</div>
        <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><div className="flex items-center justify-between"><h2 className="font-black">Restaurant information</h2><button disabled={mutating} onClick={() => setEditing((value) => !value)} className="text-xs font-bold text-orange-400 disabled:opacity-50">{editing ? 'Cancel' : 'Edit'}</button></div>{editing ? <form onSubmit={saveEdit} className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-xs text-sa-400">Name<input required value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} className="mt-1 block w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs text-sa-400">Country code<input maxLength={2} value={edit.countryCode} onChange={(event) => setEdit({ ...edit, countryCode: event.target.value.toUpperCase() })} className="mt-1 block w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs text-sa-400">Audit reason<input required minLength={5} value={edit.reason} onChange={(event) => setEdit({ ...edit, reason: event.target.value })} className="mt-1 block w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><button disabled={mutating} className="w-fit rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">{mutating ? 'Saving…' : 'Save changes'}</button></form> : <dl className="mt-4 grid gap-4 text-sm md:grid-cols-3"><div><dt className="text-sa-500">Restaurant login code</dt><dd className="mt-1 font-mono font-bold text-orange-300">{restaurant.restaurantCode}</dd></div><div><dt className="text-sa-500">Internal tenant ID</dt><dd className="mt-1 break-all font-mono text-xs font-bold">{restaurant.id}</dd></div><div><dt className="text-sa-500">Onboarding</dt><dd className="mt-1 font-bold">{restaurant.onboardingStatus.replaceAll('_', ' ')}</dd></div><div><dt className="text-sa-500">Tax / service charge</dt><dd className="mt-1 font-bold">{Number(restaurant.taxPercent)}% / {Number(restaurant.serviceChargePercent)}%</dd></div><div><dt className="text-sa-500">Currency</dt><dd className="mt-1 font-bold">{restaurant.currency}</dd></div><div><dt className="text-sa-500">Phone</dt><dd className="mt-1 font-bold">{restaurant.phone || 'Not provided'}</dd></div><div><dt className="text-sa-500">Address</dt><dd className="mt-1 font-bold">{restaurant.address || 'Not provided'}</dd></div><div><dt className="text-sa-500">Suspension reason</dt><dd className="mt-1 font-bold">{restaurant.suspensionReason || '—'}</dd></div></dl>}</section>
        <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900"><div className="border-b border-sa-800 p-5"><h2 className="font-black">Recent orders</h2></div>{data.recentOrders.length ? <div className="divide-y divide-sa-800">{data.recentOrders.map((order) => <div key={order.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4"><strong>{order.orderNumber || order.id.slice(0, 8)}</strong><span>{order.orderType.replaceAll('_', ' ')}</span><span>{restaurant.currency} {Number(order.grandTotal).toLocaleString()}</span><span className="text-sa-500">{order.status} · {formatDate(order.createdAt)}</span></div>)}</div> : <div className="p-8 text-center text-sm text-sa-500">No orders recorded.</div>}</section>
      </div>}

      {tab === 'People & locations' && <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Owner and staff</h2><div className="mt-3 divide-y divide-sa-800">{restaurant.staff.map((member) => <div key={member.id} className="flex justify-between py-3 text-sm"><div><div className="font-bold">{member.name || member.email}</div><div className="text-xs text-sa-500">{member.email} · last login {formatDate(member.lastLoginAt)}</div></div><div className={member.isActive ? 'text-emerald-400' : 'text-red-400'}>{member.role}{!member.isActive ? ' · inactive' : ''}</div></div>)}</div><form onSubmit={changeOwner} className="mt-5 space-y-3 border-t border-sa-800 pt-5"><h3 className="text-sm font-black">Change owner</h3><select required value={owner.staffId} onChange={(event) => setOwner({ ...owner, staffId: event.target.value })} className="w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2">{restaurant.staff.map((member) => <option key={member.id} value={member.id}>{member.name || member.email} · {member.role}</option>)}</select><input required minLength={5} value={owner.reason} onChange={(event) => setOwner({ ...owner, reason: event.target.value })} placeholder="Required audit reason" className="w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2" /><button disabled={mutating} className="rounded-xl border border-orange-700 px-4 py-2 text-sm font-black text-orange-400 disabled:opacity-50">{mutating ? 'Assigning…' : 'Assign owner'}</button></form></section><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Locations</h2><div className="mt-3 divide-y divide-sa-800">{restaurant.branches.map((location) => <div key={location.id} className="flex justify-between py-3 text-sm"><div><div className="font-bold">{location.name}</div><div className="text-xs text-sa-500">{location.code} · {location.timezone}</div></div><div>{location.isPrimary ? 'Primary · ' : ''}{location.isActive ? 'Active' : 'Inactive'}</div></div>)}</div></section></div>}

      {tab === 'Access & usage' && <div className="space-y-5"><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Current subscription</h2><p className="mt-1 text-sm text-sa-500">{restaurant.subscription?.plan?.name || 'No plan'} · {restaurant.subscription?.provider || 'No provider'}</p></div><StatusBadge status={restaurant.subscription?.status} /></div><dl className="mt-4 grid gap-4 text-sm md:grid-cols-4"><div><dt className="text-sa-500">Trial ends</dt><dd>{formatDate(restaurant.subscription?.trialEnd)}</dd></div><div><dt className="text-sa-500">Period ends</dt><dd>{formatDate(restaurant.subscription?.currentPeriodEnd)}</dd></div><div><dt className="text-sa-500">Grace ends</dt><dd>{formatDate(restaurant.subscription?.graceEnd)}</dd></div><div><dt className="text-sa-500">Scheduled plan</dt><dd>{restaurant.subscription?.scheduledPlan?.name || '—'}</dd></div></dl></section><div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Effective features</h2><div className="mt-3 max-h-[520px] divide-y divide-sa-800 overflow-auto">{features.map(([key, feature]) => <div key={key} className="flex justify-between gap-3 py-3 text-sm"><span>{key}</span><span className={feature.allowed ? 'text-emerald-400' : 'text-red-400'}>{feature.allowed ? 'Enabled' : 'Denied'} · {feature.source}</span></div>)}</div></section><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Usage and effective limits</h2><div className="mt-3 divide-y divide-sa-800">{limits.map(([key, limit]) => { const usage = data.usage?.[key]; return <div key={key} className="flex justify-between gap-3 py-3 text-sm"><span>{key}<span className="block text-xs text-sa-500">{limit.source}</span></span><strong className={usage?.overLimit ? 'text-red-400' : ''}>{usage?.current ?? 0} / {limit.value === null ? '∞' : limit.value}</strong></div>; })}</div></section></div><Link href={`/superadmin/subscriptions?restaurantId=${restaurant.id}`} className="inline-flex rounded-xl bg-brand-500 px-4 py-2 text-sm font-black text-sa-950">Manage plan, lifecycle, and overrides</Link></div>}

      {tab === 'QR & operations' && <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">QR tables</h2><div className="mt-3 max-h-[560px] divide-y divide-sa-800 overflow-auto">{data.qrTables.map((table) => <div key={table.id} className="flex justify-between py-3 text-sm"><div><div className="font-bold">Table {table.tableNumber}{table.label ? ` · ${table.label}` : ''}</div><div className="text-xs text-sa-500">Activated {formatDate(table.qrActivatedAt)}</div></div><StatusBadge status={table.isActive && table.isQrActive && !table.qrRevokedAt ? 'ACTIVE' : 'SUSPENDED'} /></div>)}</div></section><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Operational summary</h2><div className="mt-3 space-y-3 text-sm"><div className="flex justify-between"><span>Orders · 30 days</span><strong>{data.summaries.last30DayOrders}</strong></div><div className="flex justify-between"><span>Inventory items</span><strong>{data.summaries.inventoryItems}</strong></div><div className="flex justify-between"><span>Unacknowledged low stock</span><strong className={data.summaries.lowStockAlerts ? 'text-amber-400' : ''}>{data.summaries.lowStockAlerts}</strong></div></div><Link href={`/superadmin/orders?restaurantId=${restaurant.id}`} className="mt-5 inline-flex text-sm font-bold text-orange-400">Inspect tenant orders →</Link></section></div>}

      {tab === 'Billing & support' && <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Billing history</h2><p className="mt-1 text-xs text-sa-500">Manual assignment and provider synchronization events. These are not invoices.</p><div className="mt-3 divide-y divide-sa-800">{(restaurant.subscription?.billingEvents || []).map((event) => <div key={event.id} className="flex justify-between gap-3 py-3 text-sm"><div><div className="font-bold">{event.eventType}</div><div className="text-xs text-sa-500">{event.provider} · {formatDate(event.createdAt)}</div></div><StatusBadge status={event.status} /></div>)}</div>{!restaurant.subscription?.billingEvents?.length && <div className="p-8 text-center text-sm text-sa-500">No billing events.</div>}</section><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Support history</h2><div className="mt-4 rounded-xl border border-sa-800 bg-sa-950 p-5 text-sm text-sa-500">Unavailable: {data.support.message}</div></section></div>}

      {tab === 'Notes & audit' && <div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Internal Super Admin notes</h2><form onSubmit={addNote} className="mt-4"><textarea required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a private operational note…" className="min-h-28 w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm" /><button disabled={mutating} className="mt-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">{mutating ? 'Adding…' : 'Add note'}</button></form><div className="mt-4 divide-y divide-sa-800">{data.adminNotes.map((item) => <div key={item.id} className="py-3 text-sm"><p className="whitespace-pre-wrap">{item.body}</p><div className="mt-1 text-xs text-sa-500">{formatDate(item.createdAt)} · administrator {item.createdBy}</div></div>)}</div></section><section className="rounded-2xl border border-sa-800 bg-sa-900 p-5"><h2 className="font-black">Audit history</h2><div className="mt-3 max-h-[620px] divide-y divide-sa-800 overflow-auto">{data.auditHistory.map((item) => <div key={item.id} className="py-3 text-sm"><div className="font-bold">{item.action.replaceAll('.', ' ')}</div><div className="mt-1 text-xs text-sa-500">{item.reason || 'No reason'} · {formatDate(item.createdAt)}</div></div>)}</div></section></div>}

      <section className="rounded-2xl border border-red-900/60 bg-red-950/20 p-5"><h2 className="font-black text-red-300">Security actions</h2><p className="mt-1 text-sm text-sa-500">These actions preserve tenant data and produce immutable audit records.</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setConfirmAction('revoke')} className="rounded-xl border border-red-800 px-4 py-2 text-sm font-black text-red-300">Revoke all sessions</button><button onClick={() => setConfirmAction('reset')} className="rounded-xl border border-amber-800 px-4 py-2 text-sm font-black text-amber-300">Reset onboarding</button></div></section>

      <ConfirmActionDialog open={Boolean(confirmAction)} onClose={() => setConfirmAction(null)} onConfirm={runConfirmedAction} title={confirmAction === 'revoke' ? 'Revoke all restaurant sessions' : confirmAction === 'reset' ? 'Reset onboarding state' : confirmAction === 'suspend' ? `Suspend ${restaurant.name}` : `Reactivate ${restaurant.name}`} description={confirmAction === 'revoke' ? 'Every owner and staff identity token will be invalidated. Users must sign in again.' : confirmAction === 'reset' ? 'Marks onboarding as reset without deleting menus, orders, QR codes, or inventory.' : confirmAction === 'suspend' ? 'Stops tenant access and public QR ordering while preserving all data.' : 'Restores tenant access subject to the subscription.'} confirmLabel={confirmAction === 'revoke' ? 'Revoke all sessions' : confirmAction === 'reset' ? 'Reset onboarding' : confirmAction === 'suspend' ? 'Suspend restaurant' : 'Reactivate restaurant'} confirmationText={confirmAction === 'revoke' || confirmAction === 'suspend' ? restaurant.name : undefined} tone="danger" />
    </div>
  );
}
