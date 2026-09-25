'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';
import ConfirmActionDialog from '@/components/superadmin/ConfirmActionDialog';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';

const STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'EXPIRED'];
const LIMIT_KEYS = ['locations.max', 'tables.max', 'staff_users.max', 'menu_items.max', 'active_qr_codes.max', 'monthly_orders.max', 'inventory_items.max'];
const title = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const date = (value) => value ? new Date(value).toLocaleString() : '—';

export default function SubscriptionsPage() {
  const { can } = useSuperAdminAccess();
  const canManage = can('subscriptions.manage');
  const [subscriptions, setSubscriptions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [features, setFeatures] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [expiringFilter, setExpiringFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [pendingOverrideAction, setPendingOverrideAction] = useState(null);
  const [assignment, setAssignment] = useState({ planId: '', status: 'ACTIVE', trialEnd: '', graceEnd: '', complimentaryUntil: '', reason: '' });
  const [transition, setTransition] = useState({ toStatus: 'ACTIVE', trialEnd: '', graceEnd: '', expirationDate: '', cancelAtPeriodEnd: false, reason: '' });
  const [schedule, setSchedule] = useState({ planId: '', effectiveAt: '', reason: '' });
  const [featureOverride, setFeatureOverride] = useState({ featureKey: '', effect: 'GRANT', expiresAt: '', reason: '' });
  const [limitOverride, setLimitOverride] = useState({ limitKey: 'tables.max', value: '', expiresAt: '', reason: '' });

  const loadList = async (overrides = {}) => {
    const query = new URLSearchParams();
    const effectiveSearch = overrides.search ?? search;
    const effectiveStatus = overrides.status ?? statusFilter;
    const effectivePlan = overrides.planId ?? planFilter;
    const effectiveExpiring = overrides.expiring ?? expiringFilter;
    const effectivePage = overrides.page ?? page;
    if (effectiveSearch) query.set('search', effectiveSearch);
    if (effectiveStatus) query.set('status', effectiveStatus);
    if (effectivePlan) query.set('planId', effectivePlan);
    if (effectiveExpiring) query.set('expiring', effectiveExpiring);
    query.set('limit', '25');
    query.set('offset', String((effectivePage - 1) * 25));
    const [subscriptionResult, planResult, featureResult] = await Promise.all([
      saApi.getSubscriptions(query.toString()),
      saApi.getPlans(),
      saApi.getFeatures()
    ]);
    setSubscriptions(subscriptionResult.subscriptions || []);
    setTotal(subscriptionResult.total || 0);
    setPlans(planResult.plans || []);
    setFeatures(featureResult.features || []);
    setSelectedId((current) => current || subscriptionResult.subscriptions?.[0]?.restaurantId || null);
  };

  const loadDetail = async (restaurantId) => {
    if (!restaurantId) return;
    setLoadingDetail(true);
    try {
      const result = await saApi.getSubscription(restaurantId);
      setDetail(result);
      setAssignment((current) => ({
        ...current,
        planId: result.subscription.planId,
        status: result.subscription.status
      }));
      setSchedule((current) => ({ ...current, planId: current.planId || result.subscription.planId }));
      setFeatureOverride((current) => ({
        ...current,
        featureKey: current.featureKey || features[0]?.key || ''
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    let initialFilters = {};
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const requestedStatus = params.get('status') || '';
      const requestedPlan = params.get('planId') || '';
      const requestedRestaurant = params.get('restaurantId');
      const requestedExpiring = params.get('expiring') || '';
      setStatusFilter(requestedStatus);
      setPlanFilter(requestedPlan);
      setExpiringFilter(requestedExpiring);
      if (requestedRestaurant) setSelectedId(requestedRestaurant);
      initialFilters = { status: requestedStatus, planId: requestedPlan, expiring: requestedExpiring, page: 1 };
    }
    loadList(initialFilters).catch((error) => toast.error(error.message));
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, features.length]);

  const refresh = async () => {
    await Promise.all([loadList(), loadDetail(selectedId)]);
  };

  const changePage = (nextPage) => {
    setPage(nextPage);
    loadList({ page: nextPage }).catch((error) => toast.error(error.message));
  };

  const assign = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!assignment.reason.trim()) return toast.error('An audit reason is required.');
    setBusy(true);
    try {
      await saApi.assignSubscription(selectedId, {
        ...assignment,
        trialEnd: assignment.trialEnd || null,
        graceEnd: assignment.graceEnd || null,
        complimentaryUntil: assignment.complimentaryUntil || null
      });
      toast.success('Subscription assignment updated');
      await refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (event) => {
    event.preventDefault();
    if (!transition.reason.trim()) return toast.error('An audit reason is required.');
    const dangerous = transition.toStatus === 'SUSPENDED'
      || (transition.toStatus === 'CANCELLED' && !transition.cancelAtPeriodEnd);
    if (dangerous) {
      setPendingTransition({ ...transition });
      return;
    }
    try {
      await executeStatusChange(transition);
    } catch {
      // Feedback is shown by executeStatusChange; keep the form values for retry.
    }
  };

  const executeStatusChange = async (payload, confirmation) => {
    if (busy) return;
    setBusy(true);
    try {
      await saApi.changeSubscriptionStatus(selectedId, {
        ...payload,
        trialEnd: payload.trialEnd || null,
        graceEnd: payload.graceEnd || null,
        expirationDate: payload.expirationDate || undefined,
        confirmed: payload.toStatus === 'SUSPENDED' || (payload.toStatus === 'CANCELLED' && !payload.cancelAtPeriodEnd),
        confirmation
      });
      toast.success('Subscription status updated');
      await refresh();
    } catch (error) {
      toast.error(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const addFeatureOverride = async (event) => {
    event.preventDefault();
    if (!featureOverride.reason.trim()) return toast.error('An audit reason is required.');
    setPendingOverrideAction({ type: 'feature', payload: { ...featureOverride } });
  };

  const executeOverrideAction = async ({ reason }) => {
    if (!pendingOverrideAction || busy) return;
    setBusy(true);
    try {
      if (pendingOverrideAction.type === 'feature') {
        await saApi.createFeatureOverride(selectedId, {
          ...pendingOverrideAction.payload,
          expiresAt: pendingOverrideAction.payload.expiresAt || null,
          confirmed: true
        });
        toast.success('Feature override added');
      } else if (pendingOverrideAction.type === 'limit') {
        await saApi.createLimitOverride(selectedId, {
          ...pendingOverrideAction.payload,
          value: pendingOverrideAction.payload.value === '' ? null : Number(pendingOverrideAction.payload.value),
          expiresAt: pendingOverrideAction.payload.expiresAt || null,
          confirmed: true
        });
        toast.success('Limit override added');
      } else {
        await saApi.revokeOverride(pendingOverrideAction.overrideType, pendingOverrideAction.id, { reason, confirmed: true });
        toast.success('Override revoked');
      }
      await loadDetail(selectedId);
    } catch (error) {
      toast.error(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const scheduleChange = async (event) => {
    event.preventDefault();
    if (busy || !schedule.reason.trim() || !schedule.effectiveAt) return toast.error('A future date and audit reason are required.');
    setBusy(true);
    try {
      await saApi.schedulePlanChange(selectedId, schedule);
      toast.success('Plan change scheduled');
      await refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const addLimitOverride = async (event) => {
    event.preventDefault();
    if (!limitOverride.reason.trim()) return toast.error('An audit reason is required.');
    setPendingOverrideAction({ type: 'limit', payload: { ...limitOverride } });
  };

  const revoke = (overrideType, id, label) => setPendingOverrideAction({ type: 'revoke', overrideType, id, label });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Subscriptions</h1>
        <p className="text-sm text-sa-500 mt-1">Manual access, trials, lifecycle controls, overrides, and billing history.</p>
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); setPage(1); loadList({ page: 1 }).catch((error) => toast.error(error.message)); }}
        className="flex flex-wrap gap-2"
      >
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search restaurant…" className="w-full max-w-md rounded-xl bg-sa-900 border border-sa-800 px-4 py-2.5" />
        <button className="rounded-xl border border-sa-700 px-4 font-bold">Search</button>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl bg-sa-900 border border-sa-800 px-3 py-2.5"><option value="">All statuses</option>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="rounded-xl bg-sa-900 border border-sa-800 px-3 py-2.5"><option value="">All plans</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={expiringFilter} onChange={(event) => setExpiringFilter(event.target.value)} className="rounded-xl bg-sa-900 border border-sa-800 px-3 py-2.5"><option value="">Any expiry</option><option value="7">Expiring in 7 days</option><option value="30">Expiring in 30 days</option><option value="90">Expiring in 90 days</option></select>
      </form>

      <div className="grid xl:grid-cols-[320px_1fr] gap-5">
        <aside className="rounded-2xl border border-sa-800 bg-sa-900 p-3 h-fit max-h-[75vh] overflow-y-auto">
          {subscriptions.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.restaurantId)}
              className={`w-full text-left rounded-xl p-3 mb-1 ${selectedId === item.restaurantId ? 'bg-orange-500/15 text-orange-300' : 'hover:bg-sa-800'}`}
            >
              <div className="font-black">{item.restaurant.name}</div>
              <div className="text-xs text-sa-500 mt-1">{item.plan.name} · {title(item.status)}</div>
              <div className="text-[11px] text-sa-600 mt-1">{item.restaurant._count.tables} tables · {item.restaurant._count.staff} staff</div>
            </button>
          ))}
          {!subscriptions.length && <div className="p-6 text-center text-sm text-sa-500">No subscriptions match these filters.</div>}
          {total > 25 && <div className="mt-2 flex items-center justify-between border-t border-sa-800 px-2 pt-3 text-xs text-sa-500"><span>{total} total</span><div className="flex gap-1"><button disabled={page <= 1} onClick={() => changePage(page - 1)} className="rounded border border-sa-700 px-2 py-1 disabled:opacity-40">Previous</button><button disabled={page * 25 >= total} onClick={() => changePage(page + 1)} className="rounded border border-sa-700 px-2 py-1 disabled:opacity-40">Next</button></div></div>}
        </aside>

        {loadingDetail && <div className="rounded-2xl border border-sa-800 bg-sa-900 p-8">Loading subscription…</div>}
        {!loadingDetail && detail && (
          <main className="space-y-5 min-w-0">
            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">{detail.subscription.restaurant.name}</h2>
                  <p className="text-xs text-sa-500 mt-1">{detail.subscription.restaurant.slug}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-black ${detail.snapshot.operational ? 'border-emerald-700 text-emerald-400 bg-emerald-500/10' : 'border-red-800 text-red-400 bg-red-500/10'}`}>
                  {title(detail.subscription.status)}
                </span>
              </div>
              <div className="grid md:grid-cols-3 gap-4 mt-5 text-sm">
                <div><span className="text-sa-500">Plan</span><div className="font-bold mt-1">{detail.subscription.plan.name}</div></div>
                <div><span className="text-sa-500">Period ends</span><div className="font-bold mt-1">{date(detail.subscription.currentPeriodEnd)}</div></div>
                <div><span className="text-sa-500">Provider</span><div className="font-bold mt-1">{detail.subscription.provider}</div></div>
              </div>
            </section>

            {canManage && <div className="grid lg:grid-cols-3 gap-5">
              <form onSubmit={assign} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 space-y-3">
                <h3 className="font-black">Manual assignment / complimentary access</h3>
                <select value={assignment.planId} onChange={(event) => setAssignment({ ...assignment, planId: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
                <select value={assignment.status} onChange={(event) => setAssignment({ ...assignment, status: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  {STATUSES.filter((status) => !['SUSPENDED', 'CANCELLED'].includes(status)).map((status) => <option key={status}>{status}</option>)}
                </select>
                <label className="text-xs text-sa-400">Trial end<input type="datetime-local" value={assignment.trialEnd} onChange={(event) => setAssignment({ ...assignment, trialEnd: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                <label className="text-xs text-sa-400">Grace end<input type="datetime-local" value={assignment.graceEnd} onChange={(event) => setAssignment({ ...assignment, graceEnd: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                <label className="text-xs text-sa-400">Complimentary until<input type="datetime-local" value={assignment.complimentaryUntil} onChange={(event) => setAssignment({ ...assignment, complimentaryUntil: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                <input required value={assignment.reason} onChange={(event) => setAssignment({ ...assignment, reason: event.target.value })} placeholder="Required reason" className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <button disabled={busy} className="w-full rounded-xl bg-brand-500 py-2.5 font-black disabled:opacity-50 text-sa-950">{busy ? 'Working…' : 'Apply assignment'}</button>
              </form>

              <form onSubmit={changeStatus} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 space-y-3">
                <h3 className="font-black">Status transition</h3>
                <select value={transition.toStatus} onChange={(event) => setTransition({ ...transition, toStatus: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  {STATUSES.map((status) => <option key={status}>{status}</option>)}
                </select>
                <label className="text-xs text-sa-400">Trial end<input type="datetime-local" value={transition.trialEnd} onChange={(event) => setTransition({ ...transition, trialEnd: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                <label className="text-xs text-sa-400">Grace end<input type="datetime-local" value={transition.graceEnd} onChange={(event) => setTransition({ ...transition, graceEnd: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                <label className="text-xs text-sa-400">Expiration date<input type="datetime-local" value={transition.expirationDate} onChange={(event) => setTransition({ ...transition, expirationDate: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                {transition.toStatus === 'CANCELLED' && <label className="flex items-center gap-2 rounded-xl border border-sa-800 bg-sa-950 p-3 text-xs text-sa-300"><input type="checkbox" checked={transition.cancelAtPeriodEnd} onChange={(event) => setTransition({ ...transition, cancelAtPeriodEnd: event.target.checked })} />Cancel at current period end</label>}
                <input required value={transition.reason} onChange={(event) => setTransition({ ...transition, reason: event.target.value })} placeholder="Required reason" className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <button disabled={busy} className="w-full rounded-xl border border-sa-600 py-2.5 font-black disabled:opacity-50">{busy ? 'Working…' : 'Change status'}</button>
              </form>

              <form onSubmit={scheduleChange} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 space-y-3">
                <h3 className="font-black">Scheduled upgrade / downgrade</h3>
                <select value={schedule.planId} onChange={(event) => setSchedule({ ...schedule, planId: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
                <label className="text-xs text-sa-400">Effective at<input required type="datetime-local" value={schedule.effectiveAt} onChange={(event) => setSchedule({ ...schedule, effectiveAt: event.target.value })} className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" /></label>
                <input required value={schedule.reason} onChange={(event) => setSchedule({ ...schedule, reason: event.target.value })} placeholder="Required reason" className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <button disabled={busy} className="w-full rounded-xl border border-sa-600 py-2.5 font-black disabled:opacity-50">{busy ? 'Working…' : 'Schedule change'}</button>
              </form>
            </div>}

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <h3 className="font-black">Usage and effective limits</h3>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
                {Object.entries(detail.usage || {}).map(([key, usage]) => (
                  <div key={key} className="rounded-xl bg-sa-950 border border-sa-800 p-3">
                    <div className="text-xs text-sa-500">{key}</div>
                    <div className={`font-black mt-1 ${usage.overLimit ? 'text-red-400' : ''}`}>{usage.current} / {usage.limit === null ? '∞' : usage.limit}</div>
                  </div>
                ))}
              </div>
            </section>

            {canManage && <div className="grid lg:grid-cols-2 gap-5">
              <form onSubmit={addFeatureOverride} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 space-y-3">
                <h3 className="font-black">Feature grant / deny</h3>
                <select value={featureOverride.featureKey} onChange={(event) => setFeatureOverride({ ...featureOverride, featureKey: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  {features.map((feature) => <option key={feature.id} value={feature.key}>{feature.name}</option>)}
                </select>
                <select value={featureOverride.effect} onChange={(event) => setFeatureOverride({ ...featureOverride, effect: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  <option>GRANT</option><option>DENY</option>
                </select>
                <input type="datetime-local" value={featureOverride.expiresAt} onChange={(event) => setFeatureOverride({ ...featureOverride, expiresAt: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <input required value={featureOverride.reason} onChange={(event) => setFeatureOverride({ ...featureOverride, reason: event.target.value })} placeholder="Reason" className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <button disabled={busy} className="w-full rounded-xl bg-brand-500 py-2.5 font-black disabled:opacity-50 text-sa-950">Add override</button>
              </form>

              <form onSubmit={addLimitOverride} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 space-y-3">
                <h3 className="font-black">Limit override</h3>
                <select value={limitOverride.limitKey} onChange={(event) => setLimitOverride({ ...limitOverride, limitKey: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2">
                  {LIMIT_KEYS.map((key) => <option key={key}>{key}</option>)}
                </select>
                <input type="number" min="0" placeholder="Blank = unlimited" value={limitOverride.value} onChange={(event) => setLimitOverride({ ...limitOverride, value: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <input type="datetime-local" value={limitOverride.expiresAt} onChange={(event) => setLimitOverride({ ...limitOverride, expiresAt: event.target.value })} className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <input required value={limitOverride.reason} onChange={(event) => setLimitOverride({ ...limitOverride, reason: event.target.value })} placeholder="Reason" className="w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <button disabled={busy} className="w-full rounded-xl bg-brand-500 py-2.5 font-black disabled:opacity-50 text-sa-950">Add override</button>
              </form>
            </div>}

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <h3 className="font-black">Overrides</h3>
              <div className="mt-3 divide-y divide-sa-800">
                {[...(detail.featureOverrides || []).map((item) => ({ ...item, type: 'feature', label: `${item.feature.name}: ${item.effect}` })),
                  ...(detail.limitOverrides || []).map((item) => ({ ...item, type: 'limit', label: `${item.limitKey}: ${item.value ?? 'Unlimited'}` }))]
                  .map((item) => (
                    <div key={`${item.type}-${item.id}`} className="py-3 flex justify-between gap-4 text-sm">
                      <div>
                        <div className="font-bold">{item.label}</div>
                        <div className="text-sa-500">{item.reason} · expires {date(item.expiresAt)}</div>
                      </div>
                      {canManage && !item.revokedAt && <button onClick={() => revoke(item.type, item.id, item.label)} className="text-red-400 text-xs font-bold">Revoke</button>}
                    </div>
                  ))}
              </div>
            </section>

            <div className="grid lg:grid-cols-2 gap-5">
              <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
                <h3 className="font-black">Subscription history</h3>
                <div className="mt-3 divide-y divide-sa-800">
                  {(detail.subscription.statusHistory || []).slice(0, 20).map((item) => (
                    <div key={item.id} className="py-3 text-sm">
                      <div className="font-bold">{title(item.fromStatus || 'Created')} → {title(item.toStatus)}</div>
                      <div className="text-sa-500">{item.reason} · {date(item.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
                <h3 className="font-black">Billing events</h3>
                <div className="mt-3 divide-y divide-sa-800">
                  {(detail.subscription.billingEvents || []).slice(0, 20).map((item) => (
                    <div key={item.id} className="py-3 text-sm flex justify-between gap-3">
                      <div><div className="font-bold">{item.eventType}</div><div className="text-sa-500">{date(item.createdAt)}</div></div>
                      <span className="text-xs font-black">{item.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </main>
        )}
      </div>
      <ConfirmActionDialog
        open={Boolean(pendingTransition)}
        onClose={() => setPendingTransition(null)}
        onConfirm={({ reason, confirmation }) => executeStatusChange({ ...pendingTransition, reason }, confirmation)}
        title={`${title(pendingTransition?.toStatus)} ${detail?.subscription?.restaurant?.name || 'subscription'}`}
        description={pendingTransition?.toStatus === 'SUSPENDED' ? 'Subscription-gated access and public QR ordering will stop. Existing restaurant data remains preserved.' : 'The subscription will be cancelled immediately. Existing restaurant data remains preserved.'}
        confirmLabel={pendingTransition?.toStatus === 'SUSPENDED' ? 'Suspend subscription' : 'Cancel immediately'}
        confirmationText={detail?.subscription?.restaurant?.name}
        tone="danger"
      />
      <ConfirmActionDialog
        open={Boolean(pendingOverrideAction)}
        onClose={() => setPendingOverrideAction(null)}
        onConfirm={executeOverrideAction}
        title={pendingOverrideAction?.type === 'revoke' ? 'Revoke override' : pendingOverrideAction?.type === 'feature' ? 'Add feature override' : 'Add limit override'}
        description={pendingOverrideAction?.type === 'revoke'
          ? `Revoke ${pendingOverrideAction.label || 'this override'} now. Effective access will be recalculated immediately.`
          : 'This restaurant-specific change does not alter the source plan. It will apply only for the configured time window.'}
        confirmLabel={pendingOverrideAction?.type === 'revoke' ? 'Revoke override' : 'Confirm override'}
        requireReason={pendingOverrideAction?.type === 'revoke'}
        tone={pendingOverrideAction?.type === 'revoke' ? 'danger' : 'warning'}
      />
    </div>
  );
}
