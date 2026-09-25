'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';
import ConfirmActionDialog from '@/components/superadmin/ConfirmActionDialog';
import StatusBadge from '@/components/superadmin/StatusBadge';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';

const initialCreate = {
  name: '', email: '', password: '', slug: '', restaurantCode: '', countryCode: '', planId: '',
  subscriptionStatus: 'ACTIVE', trialEnd: '', reason: ''
};

export default function RestaurantsPage() {
  const { can } = useSuperAdminAccess();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('createdAt:desc');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [filterOptions, setFilterOptions] = useState({ plans: [], countries: [] });
  const [action, setAction] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newRestaurant, setNewRestaurant] = useState(initialCreate);
  const [creating, setCreating] = useState(false);
  const [createdRestaurant, setCreatedRestaurant] = useState(null);

  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') setShowCreate(true);
    if (params.get('status')) setStatus(params.get('status'));
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (status) params.set('status', status);
      if (plan) params.set('plan', plan);
      if (country) params.set('country', country);
      const [sortBy, sortOrder] = sort.split(':');
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      const data = await saApi.getRestaurants(params.toString());
      setRestaurants(data.restaurants || []);
      setPagination(data.pagination || {});
      setFilterOptions(data.filters || { plans: [], countries: [] });
      if (!newRestaurant.planId && data.filters?.plans?.[0]?.id) {
        setNewRestaurant((current) => ({ ...current, planId: data.filters.plans[0].id }));
      }
    } catch (loadError) {
      setError(loadError.message || 'Restaurants could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [debouncedSearch, status, plan, country, sort, page]);

  const submitCreate = async (event) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const response = await saApi.createRestaurant({
        ...newRestaurant,
        trialEnd: newRestaurant.subscriptionStatus === 'TRIALING' ? newRestaurant.trialEnd : null
      });
      setCreatedRestaurant({
        ...response.restaurant,
        ownerEmail: response.owner?.email || newRestaurant.email,
        onboardingEmail: response.owner?.onboardingEmail || 'unknown',
        temporaryPassword: newRestaurant.password,
      });
      toast.success('Restaurant created securely');
      setShowCreate(false);
      setNewRestaurant({ ...initialCreate, planId: filterOptions.plans[0]?.id || '' });
      await load();
    } catch (createError) {
      toast.error(createError.message);
    } finally {
      setCreating(false);
    }
  };

  const runAction = async ({ reason, confirmation }) => {
    const restaurant = action.restaurant;
    if (action.type === 'suspend' || action.type === 'reactivate') {
      const isActive = action.type === 'reactivate';
      await saApi.updateRestaurant(restaurant.id, {
        isActive,
        reason,
        confirmation,
        confirmed: true
      });
      toast.success(isActive ? 'Restaurant reactivated' : 'Restaurant suspended');
      await load();
      return;
    }
    const mode = action.type === 'preview' ? 'preview' : 'impersonation';
    await saApi.impersonateRestaurant(restaurant.id, reason, mode);
    localStorage.setItem('dine3d_restaurant', JSON.stringify(restaurant));
    localStorage.setItem('dine3d_is_impersonating', mode === 'preview' ? 'preview' : 'true');
    localStorage.setItem('dine3d_admin_active', 'true');
    const local = window.location.hostname === 'localhost' || window.location.hostname.endsWith('.localhost');
    const tenantBase = local ? `http://${restaurant.slug}.localhost:3000` : `https://${restaurant.slug}.dine3d.ai`;
    window.location.assign(mode === 'preview' ? tenantBase : `${tenantBase}/admin/dashboard`);
  };

  const actionCopy = action ? {
    suspend: {
      title: `Suspend ${action.restaurant.name}`,
      description: 'New logins, QR ordering, and subscription-gated operations will stop. Existing restaurant data is preserved.',
      confirmLabel: 'Suspend restaurant',
      confirmationText: action.restaurant.name,
      tone: 'danger'
    },
    reactivate: {
      title: `Reactivate ${action.restaurant.name}`,
      description: 'Tenant access will be restored subject to the current subscription and effective entitlements.',
      confirmLabel: 'Reactivate restaurant',
      tone: 'warning'
    },
    impersonate: {
      title: `Impersonate ${action.restaurant.name}`,
      description: 'Starts an audited, time-limited tenant session. Billing and account-security changes remain blocked.',
      confirmLabel: 'Start impersonation',
      tone: 'warning'
    },
    preview: {
      title: `Preview ${action.restaurant.name}`,
      description: 'Starts an audited, time-limited read-only tenant preview.',
      confirmLabel: 'Start preview',
      tone: 'warning'
    }
  }[action.type] : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-black">Restaurants</h1><p className="mt-1 text-sm text-sa-500">Server-filtered tenants, ownership, locations, plans, status, and recent activity.</p></div>
        {can('restaurants.create') && <button onClick={() => setShowCreate(true)} className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-black hover:bg-brand-400 text-sa-950">Add restaurant</button>}
      </div>

      <div className="grid gap-2 rounded-2xl border border-sa-800 bg-sa-900 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <label className="xl:col-span-2"><span className="sr-only">Search restaurants</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, login code, slug, or owner…" className="w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm outline-none focus:border-orange-500" /></label>
        <select aria-label="Status filter" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">All statuses</option><option value="active">Active</option><option value="trial">Trial</option><option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select>
        <select aria-label="Plan filter" value={plan} onChange={(event) => { setPlan(event.target.value); setPage(1); }} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">All plans</option>{filterOptions.plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Country filter" value={country} onChange={(event) => { setCountry(event.target.value); setPage(1); }} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">All countries</option>{filterOptions.countries.map((item) => <option key={item.code} value={item.code}>{item.code} ({item.count})</option>)}</select>
        <select aria-label="Sort restaurants" value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option></select>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-red-800 bg-red-500/10 p-4 text-sm text-red-300">{error} <button onClick={load} className="font-black underline">Retry</button></div>}

      <div className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-sa-950 text-xs uppercase tracking-wide text-sa-500"><tr><th className="px-4 py-3">Restaurant</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Locations</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Last activity</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-sa-800">
              {loading ? Array.from({ length: 6 }).map((_, index) => <tr key={index}><td colSpan={8} className="px-4 py-3"><div className="h-8 animate-pulse rounded bg-sa-800" /></td></tr>) : restaurants.map((restaurant) => {
                const effectiveStatus = !restaurant.isActive ? 'SUSPENDED' : restaurant.subscription?.status || 'EXPIRED';
                return <tr key={restaurant.id} className="hover:bg-sa-800/40"><td className="px-4 py-4"><Link href={`/superadmin/restaurants/${restaurant.id}`} className="font-black text-white hover:text-orange-400">{restaurant.name}</Link><div className="mt-1 font-mono text-xs font-bold text-orange-400">{restaurant.restaurantCode}</div><div className="text-xs text-sa-500">/{restaurant.slug} {restaurant.countryCode ? `· ${restaurant.countryCode}` : ''}</div></td><td className="px-4 py-4"><StatusBadge status={effectiveStatus} /><div className="mt-1 text-[10px] text-sa-500">{restaurant.onboardingStatus.replaceAll('_', ' ')}</div></td><td className="px-4 py-4">{restaurant.subscription?.plan?.name || 'No plan'}</td><td className="px-4 py-4"><div>{restaurant.owner?.name || 'Unassigned'}</div><div className="text-xs text-sa-500">{restaurant.owner?.email}</div></td><td className="px-4 py-4">{restaurant._count.branches}</td><td className="px-4 py-4 text-sa-400">{new Date(restaurant.createdAt).toLocaleDateString()}</td><td className="px-4 py-4 text-sa-400">{restaurant.lastActivityAt ? new Date(restaurant.lastActivityAt).toLocaleString() : 'No activity'}</td><td className="px-4 py-4"><div className="flex justify-end gap-1"><Link href={`/superadmin/restaurants/${restaurant.id}`} className="rounded-lg px-2 py-1 font-bold text-blue-400 hover:bg-blue-500/10">Details</Link>{can('restaurants.impersonate') && <><button onClick={() => setAction({ type: 'preview', restaurant })} className="rounded-lg px-2 py-1 font-bold text-amber-400 hover:bg-amber-500/10">Preview</button><button onClick={() => setAction({ type: 'impersonate', restaurant })} className="rounded-lg px-2 py-1 font-bold text-orange-400 hover:bg-orange-500/10">Manage</button></>}{can('restaurants.suspend') && <button onClick={() => setAction({ type: restaurant.isActive ? 'suspend' : 'reactivate', restaurant })} className={`rounded-lg px-2 py-1 font-bold ${restaurant.isActive ? 'text-red-400 hover:bg-red-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'}`}>{restaurant.isActive ? 'Suspend' : 'Reactivate'}</button>}</div></td></tr>;
              })}
            </tbody>
          </table>
          {!loading && !restaurants.length && <div className="p-12 text-center text-sm text-sa-500">No restaurants match these filters.</div>}
        </div>
        {pagination.pages > 1 && <div className="flex items-center justify-between border-t border-sa-800 p-4 text-xs text-sa-400"><span>Page {pagination.page} of {pagination.pages} · {pagination.total} restaurants</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-sa-700 px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-sa-700 px-3 py-1.5 disabled:opacity-40">Next</button></div></div>}
      </div>

      {showCreate && can('restaurants.create') && <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"><button aria-label="Close create restaurant" className="absolute inset-0 bg-black/80" onClick={() => !creating && setShowCreate(false)} /><form onSubmit={submitCreate} className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-sa-700 bg-sa-900 p-6"><h2 className="text-xl font-black">Add restaurant</h2><p className="mt-1 text-sm text-sa-500">Creates the tenant, primary location, owner, and initial subscription atomically. No demo data is added.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-xs font-bold text-sa-400">Restaurant name<input required minLength={2} maxLength={120} value={newRestaurant.name} onChange={(event) => setNewRestaurant({ ...newRestaurant, name: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs font-bold text-sa-400">URL slug (optional)<input pattern="[a-z0-9-]*" value={newRestaurant.slug} onChange={(event) => setNewRestaurant({ ...newRestaurant, slug: event.target.value.toLowerCase() })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs font-bold text-sa-400 md:col-span-2">Restaurant login code (optional)<input maxLength={13} pattern="DINE-[A-Z0-9]{8}" placeholder="Auto-generate, e.g. DINE-7K9M2P4Q" value={newRestaurant.restaurantCode} onChange={(event) => setNewRestaurant({ ...newRestaurant, restaurantCode: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 font-mono uppercase tracking-wider text-white" /><span className="mt-1.5 block font-normal text-sa-600">Leave blank for a secure unique code. This is the customer-facing sign-in code, not the internal tenant UUID.</span></label><label className="text-xs font-bold text-sa-400">Owner email<input required type="email" value={newRestaurant.email} onChange={(event) => setNewRestaurant({ ...newRestaurant, email: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs font-bold text-sa-400">Temporary password (14+ characters)<input required minLength={14} type="password" autoComplete="new-password" value={newRestaurant.password} onChange={(event) => setNewRestaurant({ ...newRestaurant, password: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs font-bold text-sa-400">Country code<input maxLength={2} placeholder="PK" value={newRestaurant.countryCode} onChange={(event) => setNewRestaurant({ ...newRestaurant, countryCode: event.target.value.toUpperCase() })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="text-xs font-bold text-sa-400">Plan<select required value={newRestaurant.planId} onChange={(event) => setNewRestaurant({ ...newRestaurant, planId: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white">{filterOptions.plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-bold text-sa-400">Initial access<select value={newRestaurant.subscriptionStatus} onChange={(event) => setNewRestaurant({ ...newRestaurant, subscriptionStatus: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white"><option value="ACTIVE">Active</option><option value="TRIALING">Trial</option></select></label>{newRestaurant.subscriptionStatus === 'TRIALING' && <label className="text-xs font-bold text-sa-400">Trial ends<input required type="datetime-local" value={newRestaurant.trialEnd} onChange={(event) => setNewRestaurant({ ...newRestaurant, trialEnd: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label>}<label className="text-xs font-bold text-sa-400 md:col-span-2">Audit reason<input required minLength={5} value={newRestaurant.reason} onChange={(event) => setNewRestaurant({ ...newRestaurant, reason: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={creating} onClick={() => setShowCreate(false)} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold">Cancel</button><button disabled={creating || !newRestaurant.planId} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">{creating ? 'Creating…' : 'Create restaurant'}</button></div></form></div>}

      {createdRestaurant && <div className="fixed inset-0 z-[95] flex items-center justify-center p-4"><button aria-label="Close restaurant credentials" className="absolute inset-0 bg-black/85" onClick={() => setCreatedRestaurant(null)} /><section role="dialog" aria-modal="true" aria-labelledby="restaurant-created-title" className="relative w-full max-w-xl rounded-2xl border border-emerald-700/50 bg-sa-900 p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">Tenant provisioned</p><h2 id="restaurant-created-title" className="mt-1 text-2xl font-black">{createdRestaurant.name} is ready</h2><p className="mt-2 text-sm text-sa-400">Copy these onboarding credentials now and deliver them through a secure channel. The temporary password is not stored in readable form.</p><p className={`mt-2 text-xs font-bold ${['sent', 'preview'].includes(createdRestaurant.onboardingEmail) ? 'text-emerald-400' : 'text-amber-400'}`}>Onboarding email: {createdRestaurant.onboardingEmail.replaceAll('_', ' ')}</p></div><button onClick={() => setCreatedRestaurant(null)} className="rounded-lg p-2 text-sa-400 hover:bg-sa-800 hover:text-white" aria-label="Close">✕</button></div><div className="mt-6 space-y-3"><CredentialRow label="Restaurant login code" value={createdRestaurant.restaurantCode} onCopy={() => copyText(createdRestaurant.restaurantCode, 'Restaurant code')} highlight /><CredentialRow label="Owner email" value={createdRestaurant.ownerEmail} onCopy={() => copyText(createdRestaurant.ownerEmail, 'Owner email')} /><CredentialRow label="Temporary password" value={createdRestaurant.temporaryPassword} onCopy={() => copyText(createdRestaurant.temporaryPassword, 'Temporary password')} secret /><CredentialRow label="Internal tenant ID" value={createdRestaurant.id} onCopy={() => copyText(createdRestaurant.id, 'Tenant ID')} /></div><div className="mt-5 rounded-xl border border-amber-800/60 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">The owner signs in with the restaurant code, email, and temporary password. Ask the owner to change it immediately after the secure handoff.</div><div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={() => copyText(`Restaurant code: ${createdRestaurant.restaurantCode}\nOwner email: ${createdRestaurant.ownerEmail}\nTemporary password: ${createdRestaurant.temporaryPassword}`, 'Credential bundle')} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold hover:bg-sa-800">Copy credential bundle</button><Link href={`/superadmin/restaurants/${createdRestaurant.id}`} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-black text-sa-950 hover:bg-brand-400">Open restaurant</Link></div></section></div>}

      <ConfirmActionDialog open={Boolean(action)} onClose={() => setAction(null)} onConfirm={runAction} {...actionCopy} />
    </div>
  );
}

function CredentialRow({ label, value, onCopy, highlight = false, secret = false }) {
  const [revealed, setRevealed] = useState(false);
  return <div className={`flex items-center gap-3 rounded-xl border p-3 ${highlight ? 'border-orange-700/60 bg-orange-500/10' : 'border-sa-800 bg-sa-950'}`}><div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-wider text-sa-500">{label}</div><div className={`mt-1 break-all font-mono font-bold ${highlight ? 'text-lg tracking-wider text-orange-300' : 'text-sm text-sa-200'}`}>{secret && !revealed ? '••••••••••••••' : value}</div></div>{secret && <button type="button" onClick={() => setRevealed((current) => !current)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-bold text-sa-400 hover:text-white">{revealed ? 'Hide' : 'Show'}</button>}<button type="button" onClick={onCopy} className="shrink-0 rounded-lg border border-sa-700 px-3 py-1.5 text-xs font-bold text-sa-300 hover:bg-sa-800">Copy</button></div>;
}
