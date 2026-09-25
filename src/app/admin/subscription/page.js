'use client';

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { LoadingScreen } from '@/components/ui/Loading';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

const label = (value) => String(value || '')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const formatDate = (value) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
  : 'Not scheduled';

export default function SubscriptionPage() {
  const { can } = useAdminAccess();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [support, setSupport] = useState(null);
  const canManageBilling = can('billing.manage');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [billingAction, setBillingAction] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');

  useEffect(() => {
    Promise.all([
      api.getSubscription(),
      api.getPublicPlans(),
      // Plans on this deployment are assigned by an operator and collected by
      // JazzCash, so a plan request needs the support contact.
      api.getPaymentInstructions().catch(() => null),
    ])
      .then(([subscriptionData, planData, instructionsData]) => {
        setData(subscriptionData);
        setPlans(planData.plans || []);
        setSupport(instructionsData?.support || null);
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));

    const query = new URLSearchParams(window.location.search);
    const checkoutState = query.get('checkout');
    const sessionId = query.get('session_id');
    if (checkoutState === 'cancelled') setCheckoutMessage('Checkout was cancelled. Your existing access was not changed.');
    if (checkoutState === 'success' && sessionId) {
      let attempts = 0;
      const verify = async () => {
        try {
          const result = await api.getCheckoutStatus(sessionId);
          if (result.settled) {
            setCheckoutMessage('Payment confirmed. Your subscription is active.');
            setData(await api.getSubscription());
            return;
          }
          attempts += 1;
          if (attempts < 8) {
            setCheckoutMessage('Payment received. Waiting for secure webhook confirmation…');
            window.setTimeout(verify, 1500);
          } else {
            setCheckoutMessage('Payment is still processing. Access will activate after Stripe confirms it.');
          }
        } catch (requestError) {
          setCheckoutMessage(requestError.message || 'Unable to confirm Checkout status yet.');
        }
      };
      verify();
    }
  }, []);

  const startCheckout = async (planKey) => {
    setError('');
    setBillingAction(`checkout:${planKey}`);
    try {
      const result = await api.createBillingCheckout(planKey, 'MONTHLY');
      window.location.assign(result.checkoutUrl);
    } catch (requestError) {
      setError(requestError.message || 'Unable to start secure Checkout.');
      setBillingAction('');
    }
  };

  const openPortal = async () => {
    setError('');
    setBillingAction('portal');
    try {
      const result = await api.createBillingPortal();
      window.location.assign(result.portalUrl);
    } catch (requestError) {
      setError(requestError.message || 'Unable to open billing management.');
      setBillingAction('');
    }
  };

  const includedFeatures = useMemo(() => Object.entries(data?.features || {})
    .filter(([, access]) => access.allowed)
    .map(([key, access]) => ({ key, ...access })), [data]);

  if (loading) return <LoadingScreen title="Loading your plan" detail="What you are on, what you have used, and what it costs." />;
  if (error) return <div className="card p-8 text-red-600">{error}</div>;

  const subscription = data?.subscription;
  const statusTone = data?.operational
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-red-50 text-red-700 border-red-200';
  const renewal = subscription?.expirationDate
    || subscription?.graceEnd
    || subscription?.currentPeriodEnd
    || subscription?.trialEnd;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="page-header">
        <div>
          <h1>Plan & Usage</h1>
          <div className="page-header-subtitle">Your subscription, included capabilities, and current limits</div>
        </div>
        <span className={`px-3 py-1.5 rounded-full border text-xs font-black uppercase tracking-wider ${statusTone}`}>
          {label(subscription?.status || 'No subscription')}
        </span>
      </div>

      {!data?.operational && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-black text-red-900">Subscription action required</h2>
          <p className="text-sm text-red-700 mt-1">{data?.subscriptionAccess?.reason || 'Contact your account administrator to restore access.'}</p>
        </div>
      )}

      {checkoutMessage && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-800" role="status">
          {checkoutMessage}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="card p-6 lg:col-span-2">
          <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">Current plan</div>
          <div className="flex flex-wrap items-end gap-3 mt-2">
            <h2 className="text-3xl font-black text-neutral-950">{subscription?.plan?.name || 'Unassigned'}</h2>
            {subscription?.plan && (
              <span className="text-sm text-neutral-500 mb-1">
                {subscription.plan.currency} {Number(subscription.plan.price || 0).toLocaleString()} / {label(subscription.plan.billingInterval).toLowerCase()}
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-3 gap-4 mt-6 text-sm">
            <div>
              <div className="text-neutral-500">Started</div>
              <div className="font-bold mt-1">{formatDate(subscription?.startDate)}</div>
            </div>
            <div>
              <div className="text-neutral-500">Renewal / expiry</div>
              <div className="font-bold mt-1">{formatDate(renewal)}</div>
            </div>
            <div>
              <div className="text-neutral-500">Billing source</div>
              <div className="font-bold mt-1">Managed subscription</div>
            </div>
          </div>
          {subscription?.scheduledPlan && (
            <div className="mt-5 rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
              A change to <strong>{subscription.scheduledPlan.name}</strong> is scheduled for {formatDate(subscription.scheduledChangeAt)}.
            </div>
          )}
        </section>

        <section className="card p-6">
          <h2 className="font-black text-lg">Billing management</h2>
          <p className="text-sm text-neutral-500 mt-2">Payments are collected by Stripe. Plan access changes only after a signed webhook is processed.</p>
          {canManageBilling ? (
            <button onClick={openPortal} disabled={Boolean(billingAction)} className="btn btn-outline w-full mt-6 text-center disabled:opacity-50">
              {billingAction === 'portal' ? 'Opening…' : 'Manage payment method'}
            </button>
          ) : (
            <p className="mt-5 text-xs font-bold text-neutral-500">Only a restaurant owner can change billing.</p>
          )}
        </section>
      </div>

      <section className="card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Available plans</h2>
            <p className="text-sm text-neutral-500 mt-1">Monthly Checkout uses server-configured Stripe Price IDs; browser prices are display-only.</p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
          {plans.map((plan) => {
            const current = subscription?.plan?.key === plan.key;
            // Prefer a price row in the plan's own currency. Taking whichever
            // monthly row came first showed a stale "USD 0" against plans
            // priced in PKR.
            const monthly = plan.prices?.find((price) =>
              price.billingInterval === 'MONTHLY' && price.currency === plan.currency) || null;
            const amount = monthly?.amount ?? plan.price;
            const currency = monthly?.currency ?? plan.currency;
            const metered = plan.billingModel === 'METERED' || plan.billingModel === 'HYBRID';
            const hybrid = plan.billingModel === 'HYBRID';
            const unitLabel = String(plan.meteredUnit || 'ORDER').toLowerCase();
            // Card checkout only applies to a licensed plan with a real price.
            const requestable = metered || Number(amount || 0) <= 0;
            return (
              <article key={plan.key} className={`rounded-2xl border p-5 ${current ? 'border-[#FF6B35] bg-orange-50/50' : 'border-neutral-200'}`}>
                <h3 className="font-black text-lg">{plan.name}</h3>
                <p className="text-xs text-neutral-500 mt-1 min-h-8">{plan.description || 'Dine3D subscription plan'}</p>
                {metered ? (
                  <div className="text-2xl font-black mt-4">
                    {currency} {Number(plan.meteredRate || 0).toLocaleString()}
                    <span className="text-xs text-neutral-500 font-semibold"> / {unitLabel}</span>
                    {hybrid && Number(amount || 0) > 0 ? (
                      <span className="block text-sm font-bold text-neutral-600">
                        plus {currency} {Number(amount).toLocaleString()} / month
                      </span>
                    ) : (
                      <span className="block text-xs font-semibold text-emerald-700">No monthly fee</span>
                    )}
                  </div>
                ) : (
                  <div className="text-2xl font-black mt-4">{currency} {Number(amount || 0).toLocaleString()}<span className="text-xs text-neutral-500 font-semibold"> / month</span></div>
                )}
                {Number(plan.includedUnits || 0) > 0 && (
                  <p className="text-xs text-neutral-500 mt-1">First {Number(plan.includedUnits).toLocaleString()} {unitLabel}s free each month</p>
                )}
                {plan.trialDurationDays > 0 && <p className="text-xs text-emerald-700 font-bold mt-2">{plan.trialDurationDays}-day trial</p>}
                {canManageBilling && (current ? (
                  <button disabled className="btn btn-primary w-full mt-5 disabled:opacity-50">Current plan</button>
                ) : requestable ? (
                  /* A metered plan has no Stripe price, and this deployment
                     collects by JazzCash, so switching is arranged with an
                     operator rather than through self-serve card checkout. */
                  <a
                    href={support?.whatsappUrl
                      ? `${support.whatsappUrl.split('?')[0]}?text=${encodeURIComponent(`Assalam o Alaikum, I would like to move to the ${plan.name} plan.`)}`
                      : '/admin/billing'}
                    target={support?.whatsappUrl ? '_blank' : undefined}
                    rel="noreferrer noopener"
                    className="btn btn-primary w-full mt-5 text-center"
                  >
                    Request this plan
                  </a>
                ) : (
                  <button
                    onClick={() => startCheckout(plan.key)}
                    disabled={Boolean(billingAction)}
                    className="btn btn-primary w-full mt-5 disabled:opacity-50"
                  >
                    {billingAction === `checkout:${plan.key}` ? 'Opening Checkout…' : 'Choose plan'}
                  </button>
                ))}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-xl font-black">Usage</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mt-5">
          {Object.entries(data?.usage || {}).map(([key, usage]) => {
            const percentage = usage.limit === null
              ? 0
              : Math.min(100, Math.round((usage.current / Math.max(usage.limit, 1)) * 100));
            return (
              <div key={key} className="rounded-2xl border border-neutral-200 p-4">
                <div className="flex justify-between gap-3">
                  <span className="font-bold text-sm">{label(key.replace('.max', ''))}</span>
                  <span className={`text-sm font-black ${usage.overLimit ? 'text-red-600' : 'text-neutral-800'}`}>
                    {usage.current} / {usage.limit === null ? 'Unlimited' : usage.limit}
                  </span>
                </div>
                <div className="h-2 bg-neutral-100 rounded-full mt-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${usage.overLimit ? 'bg-red-500' : percentage > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: usage.limit === null ? '100%' : `${percentage}%`, opacity: usage.limit === null ? 0.3 : 1 }}
                  />
                </div>
                {usage.overLimit && (
                  <p className="text-xs text-red-600 mt-2">Deactivate resources before creating or reactivating more.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="card p-6">
          <h2 className="text-xl font-black">Included features</h2>
          <div className="grid sm:grid-cols-2 gap-2 mt-4">
            {includedFeatures.map((feature) => (
              <div key={feature.key} className="flex items-center gap-2 rounded-xl bg-emerald-50 text-emerald-800 px-3 py-2 text-sm font-semibold">
                <span>✓</span>
                <span>{label(feature.key)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-xl font-black">Subscription history</h2>
          <div className="mt-4 divide-y divide-neutral-100">
            {(data?.history || []).slice(0, 8).map((event) => (
              <div key={event.id} className="py-3 flex justify-between gap-4 text-sm">
                <div>
                  <div className="font-bold">{label(event.toStatus)}</div>
                  <div className="text-neutral-500">{event.reason || 'Status updated'}</div>
                </div>
                <time className="text-neutral-400 whitespace-nowrap">{formatDate(event.createdAt)}</time>
              </div>
            ))}
            {!data?.history?.length && <p className="text-sm text-neutral-500 py-4">No history is available.</p>}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-xl font-black">Billing activity</h2>
          <div className="mt-4 divide-y divide-neutral-100">
            {(data?.billingEvents || []).slice(0, 8).map((event) => (
              <div key={event.id} className="py-3 flex justify-between gap-4 text-sm">
                <div>
                  <div className="font-bold">{label(event.eventType)}</div>
                  <div className="text-neutral-500">{label(event.provider)}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{label(event.status)}</div>
                  <time className="text-neutral-400 whitespace-nowrap">{formatDate(event.createdAt)}</time>
                </div>
              </div>
            ))}
            {!data?.billingEvents?.length && <p className="text-sm text-neutral-500 py-4">No billing activity is available.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
