'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';
import ConfirmActionDialog from '@/components/superadmin/ConfirmActionDialog';

const DEFAULT_LIMITS = [
  'locations.max',
  'tables.max',
  'staff_users.max',
  'menu_items.max',
  'active_qr_codes.max',
  'monthly_orders.max',
  'inventory_items.max'
];

const readable = (key) => String(key || '').replaceAll('_', ' ').replaceAll('.', ' · ');

export default function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [features, setFeatures] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [planAction, setPlanAction] = useState(null);
  const [duplicateDraft, setDuplicateDraft] = useState({ key: '', name: '', reason: '' });
  const [newPlan, setNewPlan] = useState({
    key: '',
    name: '',
    description: '',
    price: 0,
    currency: 'USD',
    billingInterval: 'MONTHLY',
    annualPrice: '',
    trialDurationDays: 0,
    sortOrder: 0,
    isPublic: true,
    isRecommended: false,
    reason: ''
  });

  const load = async () => {
    const [planResult, featureResult] = await Promise.all([
      saApi.getPlans(true),
      saApi.getFeatures()
    ]);
    setPlans(planResult.plans || []);
    setFeatures(featureResult.features || []);
    setSelectedId((current) => current || planResult.plans?.[0]?.id || null);
  };

  useEffect(() => {
    load().catch((error) => toast.error(error.message));
  }, []);

  const selected = useMemo(
    () => plans.find((plan) => plan.id === selectedId) || null,
    [plans, selectedId]
  );

  useEffect(() => {
    if (!selected) return setDraft(null);
    setDraft({
      name: selected.name,
      description: selected.description || '',
      price: Number(selected.price),
      currency: selected.currency,
      billingInterval: selected.billingInterval,
      intervalCount: selected.intervalCount,
      monthlyPrice: selected.prices?.find((entry) => entry.currency === selected.currency && entry.billingInterval === 'MONTHLY')?.amount ?? selected.price,
      annualPrice: selected.prices?.find((entry) => entry.currency === selected.currency && entry.billingInterval === 'YEARLY')?.amount ?? '',
      trialDurationDays: selected.trialDurationDays || 0,
      billingModel: selected.billingModel || 'LICENSED',
      meteredUnit: selected.meteredUnit || 'ORDER',
      meteredRate: selected.meteredRate ?? 0,
      includedUnits: selected.includedUnits ?? 0,
      minimumCharge: selected.minimumCharge ?? 0,
      sortOrder: selected.sortOrder || 0,
      isPublic: selected.isPublic,
      isRecommended: selected.isRecommended,
      isActive: selected.isActive,
      enabledFeatures: Object.fromEntries(
        (selected.features || []).map((entry) => [entry.feature.key, entry.enabled])
      ),
      limits: Object.fromEntries(
        [...DEFAULT_LIMITS, ...(selected.limits || []).map((entry) => entry.key)]
          .map((key) => [
            key,
            selected.limits?.find((entry) => entry.key === key)?.value ?? ''
          ])
      )
    });
    setImpactConfirmed(false);
  }, [selected]);

  const save = async () => {
    if (!reason.trim()) return toast.error('Enter a reason for this audited change.');
    if (selected._count?.subscriptions > 0 && !impactConfirmed) {
      return toast.error(`Confirm the impact on ${selected._count.subscriptions} assigned restaurant(s).`);
    }
    setSaving(true);
    try {
      await saApi.updatePlanConfiguration(selected.id, {
        name: draft.name,
        description: draft.description,
        price: Number(draft.monthlyPrice || 0),
        currency: draft.currency,
        billingInterval: 'MONTHLY',
        intervalCount: 1,
        trialDurationDays: Number(draft.trialDurationDays) || 0,
        sortOrder: Number(draft.sortOrder) || 0,
        billingModel: draft.billingModel || 'LICENSED',
        // A licensed plan must not keep a stale rate: it would start charging
        // again the moment someone switched the model back.
        meteredUnit: draft.billingModel === 'LICENSED' ? null : (draft.meteredUnit || 'ORDER'),
        meteredRate: draft.billingModel === 'LICENSED' ? 0 : Number(draft.meteredRate || 0),
        includedUnits: draft.billingModel === 'LICENSED' ? 0 : Number(draft.includedUnits || 0),
        minimumCharge: draft.billingModel === 'LICENSED' ? 0 : Number(draft.minimumCharge || 0),
        isPublic: draft.isPublic,
        isRecommended: draft.isRecommended,
        isActive: draft.isActive,
        prices: [
          { currency: draft.currency, billingInterval: 'MONTHLY', intervalCount: 1, amount: Number(draft.monthlyPrice || 0) },
          ...(draft.annualPrice === '' ? [] : [{ currency: draft.currency, billingInterval: 'YEARLY', intervalCount: 1, amount: Number(draft.annualPrice) }])
        ],
        features: features
          .filter((feature) => draft.enabledFeatures[feature.key])
          .map((feature) => ({ key: feature.key, enabled: true })),
        limits: Object.entries(draft.limits).map(([key, value]) => ({
          key,
          value: value === '' ? null : Number(value)
        })),
        reason,
        confirmed: selected._count?.subscriptions === 0 || impactConfirmed
      });
      toast.success('Plan configuration saved');
      setReason('');
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const create = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await saApi.createPlan({
        ...newPlan,
        price: Number(newPlan.price),
        trialDurationDays: Number(newPlan.trialDurationDays) || 0,
        prices: [
          { currency: newPlan.currency, billingInterval: 'MONTHLY', intervalCount: 1, amount: Number(newPlan.price) },
          ...(newPlan.annualPrice === '' ? [] : [{ currency: newPlan.currency, billingInterval: 'YEARLY', intervalCount: 1, amount: Number(newPlan.annualPrice) }])
        ],
        reason: newPlan.reason
      });
      toast.success('Plan created');
      setShowCreate(false);
      await load();
      setSelectedId(result.plan.id);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const startDuplicate = () => {
    setDuplicateDraft({ key: `${selected.key}_copy`, name: `${selected.name} Copy`, reason: `Duplicated from ${selected.name}` });
    setPlanAction({ type: 'duplicate' });
  };

  const duplicate = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await saApi.duplicatePlan(selected.id, {
        key: duplicateDraft.key,
        name: duplicateDraft.name,
        reason: duplicateDraft.reason
      });
      await load();
      setSelectedId(result.plan.id);
      setPlanAction(null);
      toast.success('Plan duplicated as an inactive draft');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async ({ reason: archiveReason }) => {
    if (saving) return;
    setSaving(true);
    try {
      await saApi.archivePlan(selected.id, { reason: archiveReason, confirmed: true });
      await load();
      toast.success('Plan archived');
    } catch (error) {
      toast.error(error.message);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">Plans & entitlements</h1>
          <p className="text-sm text-sa-500 mt-1">Edit commercial details, features, and capacity without code changes.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-brand-500 hover:bg-brand-400 px-4 py-2.5 text-sm font-black text-sa-950">
          Create plan
        </button>
      </div>

      {showCreate && (
        <form onSubmit={create} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 grid md:grid-cols-4 gap-3">
          <input required placeholder="Stable key" value={newPlan.key} onChange={(event) => setNewPlan({ ...newPlan, key: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input required placeholder="Plan name" value={newPlan.name} onChange={(event) => setNewPlan({ ...newPlan, name: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input placeholder="Description" value={newPlan.description} onChange={(event) => setNewPlan({ ...newPlan, description: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input required pattern="[A-Za-z]{3}" maxLength={3} placeholder="Currency" value={newPlan.currency} onChange={(event) => setNewPlan({ ...newPlan, currency: event.target.value.toUpperCase() })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input type="number" min="0" step="0.01" placeholder="Price" value={newPlan.price} onChange={(event) => setNewPlan({ ...newPlan, price: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input type="number" min="0" step="0.01" placeholder="Annual price (optional)" value={newPlan.annualPrice} onChange={(event) => setNewPlan({ ...newPlan, annualPrice: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input type="number" min="0" max="365" placeholder="Trial days" value={newPlan.trialDurationDays} onChange={(event) => setNewPlan({ ...newPlan, trialDurationDays: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <input type="number" min="0" placeholder="Display order" value={newPlan.sortOrder} onChange={(event) => setNewPlan({ ...newPlan, sortOrder: Number(event.target.value) })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
          <label className="flex items-center gap-2 rounded-xl border border-sa-800 bg-sa-950 px-3 py-2 text-sm"><input type="checkbox" checked={newPlan.isPublic} onChange={(event) => setNewPlan({ ...newPlan, isPublic: event.target.checked })} />Visible for selection</label>
          <label className="flex items-center gap-2 rounded-xl border border-sa-800 bg-sa-950 px-3 py-2 text-sm"><input type="checkbox" checked={newPlan.isRecommended} onChange={(event) => setNewPlan({ ...newPlan, isRecommended: event.target.checked })} />Recommended</label>
          <input required minLength={5} placeholder="Required audit reason" value={newPlan.reason} onChange={(event) => setNewPlan({ ...newPlan, reason: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2 md:col-span-2" />
          <div className="flex gap-2">
            <button disabled={saving} className="rounded-xl bg-white text-black px-4 py-2 font-bold disabled:opacity-50">{saving ? 'Creating…' : 'Create'}</button>
            <button disabled={saving} type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-sa-700 px-4 py-2 disabled:opacity-50">Cancel</button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
        <div className="border-b border-sa-800 p-5"><h2 className="font-black">Feature matrix</h2><p className="mt-1 text-xs text-sa-500">Plans are columns and stable features are rows. Select any cell or column to edit that plan below.</p></div>
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-sa-950"><tr><th className="sticky left-0 bg-sa-950 px-4 py-3 text-left text-xs uppercase tracking-wider text-sa-500">Feature</th>{plans.map((plan) => <th key={plan.id} className="min-w-36 px-3 py-3 text-center"><button onClick={() => setSelectedId(plan.id)} className={selectedId === plan.id ? 'font-black text-orange-400' : 'font-bold text-sa-300'}>{plan.name}</button></th>)}</tr></thead>
            <tbody className="divide-y divide-sa-800">{features.map((feature) => <tr key={feature.id}><th className="sticky left-0 bg-sa-900 px-4 py-3 text-left"><span className="block font-bold">{feature.name}</span><span className="text-[10px] font-normal text-sa-500">{feature.key}</span></th>{plans.map((plan) => { const enabled = plan.features?.some((entry) => entry.feature.key === feature.key && entry.enabled); return <td key={plan.id} className="px-3 py-3 text-center"><button onClick={() => setSelectedId(plan.id)} aria-label={`${feature.name} is ${enabled ? 'enabled' : 'disabled'} for ${plan.name}; select plan to edit`} className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${enabled ? 'border-emerald-700 bg-emerald-500/10 text-emerald-400' : 'border-sa-700 text-sa-600'}`}>{enabled ? '✓' : '—'}</button></td>; })}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-[280px_1fr] gap-5">
        <aside className="rounded-2xl border border-sa-800 bg-sa-900 p-3 h-fit">
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedId(plan.id)}
              className={`w-full text-left rounded-xl p-3 mb-1 transition ${selectedId === plan.id ? 'bg-orange-500/15 text-orange-300' : 'hover:bg-sa-800 text-sa-300'}`}
            >
              <div className="font-black">{plan.name}</div>
              <div className="text-xs opacity-60 mt-1">
                {plan.currency} {Number(plan.price).toLocaleString()} · {plan._count?.subscriptions || 0} tenants
              </div>
              {plan.isArchived && <span className="text-[10px] uppercase text-red-400 font-black">Archived</span>}
            </button>
          ))}
        </aside>

        {draft && (
          <main className="space-y-5">
            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <div className="flex justify-between gap-3">
                <h2 className="font-black text-lg">Commercial settings</h2>
                <div className="flex gap-2">
                  <button onClick={startDuplicate} className="rounded-lg border border-sa-700 px-3 py-1.5 text-xs font-bold">Duplicate</button>
                  {!selected.isArchived && <button onClick={() => setPlanAction({ type: 'archive' })} className="rounded-lg border border-red-900 text-red-400 px-3 py-1.5 text-xs font-bold">Archive</button>}
                </div>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <label className="text-xs text-sa-500">Monthly price<input type="number" min="0" step="0.01" value={draft.monthlyPrice} onChange={(event) => setDraft({ ...draft, monthlyPrice: event.target.value })} className="mt-1 w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2 text-white" /></label>
                <label className="text-xs text-sa-500">Annual price<input type="number" min="0" step="0.01" placeholder="Not offered" value={draft.annualPrice} onChange={(event) => setDraft({ ...draft, annualPrice: event.target.value })} className="mt-1 w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2 text-white" /></label>
                <input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
                <label className="text-xs text-sa-500">Trial days<input type="number" min="0" max="365" value={draft.trialDurationDays} onChange={(event) => setDraft({ ...draft, trialDurationDays: event.target.value })} className="mt-1 w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2 text-white" /></label>
                <label className="text-xs text-sa-500">Display order<input type="number" min="0" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} className="mt-1 w-full rounded-xl bg-sa-950 border border-sa-700 px-3 py-2 text-white" /></label>
              </div>

              {/* How this plan charges. A metered plan bills per order rung up
                  instead of, or alongside, the monthly price above. */}
              <div className="mt-4 rounded-xl border border-sa-800 bg-sa-950 p-4">
                <p className="text-[10px] font-black uppercase tracking-wide text-sa-500">Charging model</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <label className="text-xs text-sa-500">Model
                    <select
                      value={draft.billingModel}
                      onChange={(event) => setDraft({ ...draft, billingModel: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-900 px-3 py-2 text-white"
                    >
                      <option value="LICENSED">Fixed monthly fee</option>
                      <option value="METERED">Per order / receipt only</option>
                      <option value="HYBRID">Monthly fee plus usage</option>
                    </select>
                  </label>

                  {draft.billingModel === 'LICENSED' ? (
                    <p className="self-end text-xs text-sa-500 md:col-span-4">
                      Restaurants on this plan pay only the monthly price above.
                    </p>
                  ) : (
                    <>
                      <label className="text-xs text-sa-500">Billable unit
                        <select
                          value={draft.meteredUnit}
                          onChange={(event) => setDraft({ ...draft, meteredUnit: event.target.value })}
                          className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-900 px-3 py-2 text-white"
                        >
                          <option value="ORDER">Per order</option>
                          <option value="RECEIPT">Per receipt</option>
                        </select>
                      </label>
                      <label className="text-xs text-sa-500">Rate per unit
                        <input
                          type="number" min="0" step="0.01" value={draft.meteredRate}
                          onChange={(event) => setDraft({ ...draft, meteredRate: event.target.value })}
                          className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-900 px-3 py-2 text-white"
                        />
                      </label>
                      <label className="text-xs text-sa-500">Included free
                        <input
                          type="number" min="0" step="1" value={draft.includedUnits}
                          onChange={(event) => setDraft({ ...draft, includedUnits: event.target.value })}
                          className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-900 px-3 py-2 text-white"
                        />
                      </label>
                      <label className="text-xs text-sa-500">Monthly minimum
                        <input
                          type="number" min="0" step="0.01" value={draft.minimumCharge}
                          onChange={(event) => setDraft({ ...draft, minimumCharge: event.target.value })}
                          className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-900 px-3 py-2 text-white"
                        />
                      </label>
                    </>
                  )}
                </div>
                {draft.billingModel !== 'LICENSED' ? (
                  <p className="mt-3 text-xs text-sa-500">
                    A restaurant ringing up 400 {String(draft.meteredUnit || 'ORDER').toLowerCase()}s pays{' '}
                    <span className="font-black text-sa-300">
                      {draft.currency} {(Math.max(0, 400 - Number(draft.includedUnits || 0)) * Number(draft.meteredRate || 0)
                        + (draft.billingModel === 'HYBRID' ? Number(draft.monthlyPrice || 0) : 0)).toFixed(2)}
                    </span>{' '}
                    for the month. A metered plan needs a rate above zero.
                  </p>
                ) : null}
              </div>
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Plan description" className="w-full mt-3 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
              <label className="flex items-center gap-2 text-sm mt-3">
                <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
                Available for assignment
              </label>
              <div className="mt-3 flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isPublic} onChange={(event) => setDraft({ ...draft, isPublic: event.target.checked })} />Visible for selection</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isRecommended} onChange={(event) => setDraft({ ...draft, isRecommended: event.target.checked })} />Recommended plan</label></div>
              <div className="mt-3 text-xs text-sa-500">Configuration revision {selected.revisions?.[0]?.version || 0} · {selected._count?.revisions || 0} saved snapshots</div>
            </section>

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <h2 className="font-black text-lg">Feature matrix</h2>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">
                {features.map((feature) => (
                  <label key={feature.id} className="rounded-xl border border-sa-800 bg-sa-950 p-3 flex gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.enabledFeatures[feature.key])}
                      onChange={(event) => setDraft({
                        ...draft,
                        enabledFeatures: { ...draft.enabledFeatures, [feature.key]: event.target.checked }
                      })}
                    />
                    <span>
                      <span className="block text-sm font-bold">{feature.name}</span>
                      <span className="block text-[11px] text-sa-500">{feature.key}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
              <h2 className="font-black text-lg">Numeric limits</h2>
              <p className="text-xs text-sa-500 mt-1">Leave blank for unlimited. Zero explicitly blocks creation or activation.</p>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
                {Object.entries(draft.limits).map(([key, value]) => (
                  <label key={key} className="text-xs font-bold text-sa-400">
                    {readable(key)}
                    <input
                      type="number"
                      min="0"
                      placeholder="Unlimited"
                      value={value}
                      onChange={(event) => setDraft({
                        ...draft,
                        limits: { ...draft.limits, [key]: event.target.value }
                      })}
                      className="block w-full mt-1 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2 text-white"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="sticky bottom-4 rounded-2xl border border-sa-700 bg-sa-900/95 backdrop-blur p-4 flex flex-wrap gap-3">
              {selected._count?.subscriptions > 0 && <label className="flex w-full items-start gap-2 rounded-xl border border-amber-800 bg-amber-500/10 p-3 text-xs text-amber-200"><input type="checkbox" checked={impactConfirmed} onChange={(event) => setImpactConfirmed(event.target.checked)} />I understand this configuration change affects {selected._count.subscriptions} currently assigned restaurant(s). A versioned snapshot will be retained.</label>}
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required audit reason" className="flex-1 min-w-64 rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
              <button disabled={saving} onClick={save} className="rounded-xl bg-brand-500 px-5 py-2 font-black disabled:opacity-50 text-sa-950">
                {saving ? 'Saving…' : 'Save audited changes'}
              </button>
            </section>
          </main>
        )}
      </div>
      {planAction?.type === 'duplicate' && <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="duplicate-plan-title"><button aria-label="Close" className="absolute inset-0 bg-black/80" onClick={() => !saving && setPlanAction(null)} /><form onSubmit={duplicate} className="relative w-full max-w-lg space-y-4 rounded-2xl border border-sa-700 bg-sa-900 p-6"><h2 id="duplicate-plan-title" className="text-xl font-black">Duplicate {selected?.name}</h2><p className="text-sm text-sa-500">The copy starts inactive and hidden. Assign a new stable key before configuring it.</p><label className="block text-xs font-bold text-sa-400">Stable key<input required pattern="[a-z][a-z0-9_.]*" value={duplicateDraft.key} onChange={(event) => setDuplicateDraft({ ...duplicateDraft, key: event.target.value.toLowerCase() })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="block text-xs font-bold text-sa-400">Display name<input required value={duplicateDraft.name} onChange={(event) => setDuplicateDraft({ ...duplicateDraft, name: event.target.value })} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><label className="block text-xs font-bold text-sa-400">Audit reason<textarea required minLength={5} value={duplicateDraft.reason} onChange={(event) => setDuplicateDraft({ ...duplicateDraft, reason: event.target.value })} className="mt-1 min-h-20 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white" /></label><div className="flex justify-end gap-2"><button disabled={saving} type="button" onClick={() => setPlanAction(null)} className="rounded-xl border border-sa-700 px-4 py-2 disabled:opacity-50">Cancel</button><button disabled={saving} className="rounded-xl bg-brand-500 px-4 py-2 font-black disabled:opacity-50 text-sa-950">{saving ? 'Duplicating…' : 'Create inactive copy'}</button></div></form></div>}
      <ConfirmActionDialog open={planAction?.type === 'archive'} onClose={() => setPlanAction(null)} onConfirm={archive} title={`Archive ${selected?.name || 'plan'}`} description="The plan will no longer be available for new assignments. Existing subscriptions retain their plan and data." confirmLabel="Archive plan" tone="danger" />
    </div>
  );
}
