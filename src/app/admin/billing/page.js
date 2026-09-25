'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '@/lib/api';
import { LoadingScreen } from '@/components/ui/Loading';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

const money = (value, currency = 'PKR') => {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const formatDate = (value) => (value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
  : '—');

/**
 * Billing period boundaries are UTC calendar dates, not instants, so they must
 * be rendered in UTC. Formatting them in the viewer's zone shifts them a day —
 * in Pakistan (UTC+5) a September period would read "Sep 1 – Oct 1".
 */
const formatUtcDate = (value) => (value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
  : '—');

const formatPeriod = (start, end) => {
  if (!start) return '—';
  // The stored period end is exclusive (the 1st of the next month), so show the
  // last day the restaurant actually traded in.
  const lastDay = new Date(new Date(end).getTime() - 1);
  return `${formatUtcDate(start)} – ${formatUtcDate(lastDay)}`;
};

const STATUS_STYLES = {
  OPEN: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  DRAFT: 'bg-neutral-100 text-neutral-700',
  VOID: 'bg-neutral-100 text-neutral-500 line-through',
  UNCOLLECTIBLE: 'bg-red-100 text-red-700',
  PENDING: 'bg-sky-100 text-sky-800',
  VERIFIED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
};

const Badge = ({ value }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[value] || 'bg-neutral-100 text-neutral-700'}`}>
    {String(value || '').replaceAll('_', ' ')}
  </span>
);

const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>
    {children}
  </div>
);

const Stat = ({ label, value, hint, accent = 'text-neutral-900' }) => (
  <Card>
    <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
    <p className={`mt-2 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
    {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
  </Card>
);

export default function BillingPage() {
  const { can } = useAdminAccess();
  const canManageBilling = can('billing.manage');

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openInvoiceId, setOpenInvoiceId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [ladder, setLadder] = useState(null);
  const [changingPlan, setChangingPlan] = useState('');
  const [planNotice, setPlanNotice] = useState('');

  const [form, setForm] = useState({
    invoiceId: '',
    reference: '',
    amount: '',
    paidAt: new Date().toISOString().slice(0, 10),
    senderName: '',
    senderPhone: '',
  });

  const changePlan = async (planKey, planName) => {
    setChangingPlan(planKey);
    setPlanNotice('');
    setError('');
    try {
      const result = await api.changePlan(planKey);
      // Moving up applies now; moving down waits for the period to close, and
      // the difference matters enough to say out loud rather than leave someone
      // wondering why nothing changed.
      setPlanNotice(result.effective === 'immediately'
        ? `You are now on ${planName}.`
        : `${planName} starts at the end of this billing period.`);
      await load();
    } catch (changeError) {
      setError(changeError.message || 'Could not change your plan.');
    } finally {
      setChangingPlan('');
    }
  };

  const load = useCallback(async () => {
    try {
      // The ladder is loaded alongside the summary but never blocks it: a
      // restaurant that cannot reach the catalogue still needs to see what it
      // owes and how to pay it.
      const [data, ladderData] = await Promise.all([
        api.getBillingSummary(),
        api.getPlanLadder().catch(() => null),
      ]);
      setSummary(data);
      setLadder(ladderData);
      // Default the payment form to the oldest unpaid invoice.
      const openInvoice = (data.invoices || []).find((invoice) => invoice.status === 'OPEN');
      setForm((previous) => ({
        ...previous,
        invoiceId: previous.invoiceId || openInvoice?.id || '',
        amount: previous.amount || (openInvoice ? String(openInvoice.amountDue) : ''),
      }));
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load billing information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const usage = summary?.usage;
  const balance = summary?.balance;
  const instructions = summary?.instructions;
  const jazzCash = instructions?.methods?.find((method) => method.method === 'JAZZCASH');
  const currency = usage?.currency || 'PKR';

  const unitLabel = (usage?.unit || 'ORDER').toLowerCase();

  const chartData = useMemo(() => (usage?.daily || []).map((point) => ({
    date: point.date,
    orders: point.quantity,
    cost: Number((point.quantity * (usage?.rate || 0)).toFixed(2)),
  })), [usage]);

  const invoiceHistory = useMemo(() => (summary?.invoices || [])
    .filter((invoice) => invoice.status !== 'DRAFT')
    .slice(0, 6)
    .map((invoice) => ({
      label: formatUtcDate(invoice.periodStart).replace(/,.*$/, ''),
      total: invoice.total,
    }))
    .reverse(), [summary]);

  // The wallet screenshot. Held separately from `form` because it is a File,
  // not a string, and must survive the reset that clears the text fields.
  const [proof, setProof] = useState(null);

  const submitPayment = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      // Sent as multipart so the wallet screenshot travels with the claim.
      // A reference number on its own cannot be checked against anything until
      // someone opens the JazzCash statement, and the person who reviews it is
      // not the person who sent the money.
      const payload = new FormData();
      payload.append('invoiceId', form.invoiceId || '');
      payload.append('method', 'JAZZCASH');
      payload.append('reference', form.reference.trim());
      payload.append('amount', String(Number(form.amount)));
      payload.append('paidAt', new Date(form.paidAt).toISOString());
      payload.append('senderName', form.senderName.trim());
      payload.append('senderPhone', form.senderPhone.trim());
      if (proof) payload.append('proof', proof);

      const result = await api.submitPayment(payload);
      setNotice(result.message || 'Payment submitted for verification.');
      setForm((previous) => ({ ...previous, reference: '', senderName: '', senderPhone: '' }));
      setProof(null);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Unable to submit this payment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingScreen title="Loading billing" detail="Your invoices, payments and what is due." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Billing</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {usage?.plan?.name
              ? `${usage.plan.name} · ${usage.metered ? `${money(usage.rate, currency)} per ${unitLabel}` : 'fixed monthly plan'}`
              : 'No plan assigned yet'}
            {usage ? ` · current period ${formatPeriod(usage.periodStart, usage.periodEnd)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      {/* ── Headline numbers ───────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={`${unitLabel}s this period`}
          value={(usage?.quantity ?? 0).toLocaleString()}
          hint={usage?.includedUnits ? `${usage.includedUnits.toLocaleString()} included free` : 'Counted as they are rung up'}
        />
        <Stat
          label="Billable so far"
          value={(usage?.billableUnits ?? 0).toLocaleString()}
          hint={usage?.metered ? `× ${money(usage.rate, currency)} per ${unitLabel}` : 'Not charged per order on this plan'}
        />
        <Stat
          label="Projected bill"
          value={money(usage?.projectedTotal, currency)}
          hint={
            /* When the ceiling is doing the work, say so. A restaurant that has
               rung up Rs 15,000 of orders and sees "Rs 5,000" should be told it
               is capped, not left wondering whether the figure is broken. */
            Number(usage?.cappedAmount) > 0
              ? `Capped at ${money(usage.maximumCharge, currency)} — ${money(usage.cappedAmount, currency)} not charged`
              : Number(usage?.maximumCharge) > 0
                ? `Never more than ${money(usage.maximumCharge, currency)} a month`
                : 'For the period that is still open'
          }
          accent="text-teal-700"
        />
        <Stat
          label="Outstanding"
          value={money(balance?.amountDue, currency)}
          hint={balance?.openInvoices ? `${balance.openInvoices} unpaid invoice(s)` : 'Nothing due — you are all clear'}
          accent={Number(balance?.amountDue) > 0 ? 'text-amber-700' : 'text-emerald-700'}
        />
      </section>

      {/* ── Your plan, and the ladder ──────────────────────────────── */}
      {ladder?.plans?.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Your plan</p>
              <h2 className="text-lg font-bold text-neutral-900">
                {ladder.current.name}
                {ladder.scheduled ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 align-middle">
                    changing to {ladder.scheduled.name} at the end of this period
                  </span>
                ) : null}
              </h2>
            </div>
            {planNotice ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">{planNotice}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ladder.plans.map((plan) => {
              const isCurrent = plan.isCurrent;
              const isScheduled = ladder.scheduled?.key === plan.key;
              return (
                <div
                  key={plan.key}
                  className={`flex flex-col rounded-xl border p-4 ${
                    isCurrent ? 'border-teal-300 bg-teal-50/40' : 'border-neutral-200 bg-white'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-base font-bold text-neutral-900">{plan.name}</h3>
                    {isCurrent ? (
                      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Current
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-2xl font-black text-neutral-900 tabular-nums">
                    {money(plan.meteredRate, plan.currency)}
                    <span className="ml-1 text-sm font-medium text-neutral-500">
                      per {(plan.meteredUnit || 'order').toLowerCase()}
                    </span>
                  </p>

                  {/* The ceiling in orders is the number a restaurant can check
                      against its own till; the money figure is what lands on the
                      invoice. Both, or neither means much. */}
                  <p className="mt-1 text-sm text-neutral-600">
                    Never more than <strong>{money(plan.maximumCharge, plan.currency)}</strong> a month
                    {plan.ceilingOrders ? (
                      <span className="text-neutral-400"> · {plan.ceilingOrders.toLocaleString()} orders</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Minimum {money(plan.minimumCharge, plan.currency)} a month
                  </p>

                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    {plan.features.length} features
                  </p>

                  <div className="mt-3 pt-3 border-t border-neutral-200/70">
                    {isCurrent ? (
                      <p className="text-sm text-neutral-500">You are on this plan.</p>
                    ) : isScheduled ? (
                      <p className="text-sm text-amber-700">Starts at the end of this period.</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => changePlan(plan.key, plan.name)}
                        disabled={Boolean(changingPlan)}
                        className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {changingPlan === plan.key ? 'Switching…' : `Switch to ${plan.name}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-neutral-500">
            Moving up starts straight away. Moving down starts at the end of this billing
            period, so the month you have already part-used stays on the plan you used it on.
            {ladder.current?.setupFeeInvoicedAt ? ' Your setup fee is already paid — changing plan never charges it again.' : ''}
          </p>
        </section>
      ) : null}

      {/* ── Usage chart ────────────────────────────────────────────── */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <Card>
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">This period</p>
              <h2 className="text-lg font-bold text-neutral-900">Daily {unitLabel}s and charge</h2>
            </div>
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
              {money(usage?.rate, currency)} / {unitLabel}
            </span>
          </div>
          <div style={{ height: 280 }}>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="billingUsageFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0F766E" stopOpacity={0.24} />
                      <stop offset="95%" stopColor="#0F766E" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: '#6B7280' }}
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => String(value).slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    formatter={(value, name) => (name === 'cost'
                      ? [money(value, currency), 'Charge']
                      : [Number(value).toLocaleString(), `${unitLabel}s`])}
                    labelStyle={{ color: '#111827', fontWeight: 700 }}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E5E7EB',
                      boxShadow: '0 12px 24px -8px rgba(15, 23, 42, 0.16)',
                    }}
                  />
                  <Area type="monotone" dataKey="orders" stroke="#0F766E" strokeWidth={3} fillOpacity={1} fill="url(#billingUsageFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                No {unitLabel}s recorded in this period yet.
              </div>
            )}
          </div>
        </Card>

        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">History</p>
          <h2 className="text-lg font-bold text-neutral-900">Invoiced by month</h2>
          <div className="mt-4" style={{ height: 240 }}>
            {invoiceHistory.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={invoiceHistory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <RechartsTooltip
                    formatter={(value) => [money(value, currency), 'Invoiced']}
                    contentStyle={{ borderRadius: 16, border: '1px solid #E5E7EB' }}
                  />
                  <Bar dataKey="total" fill="#0F766E" radius={[8, 8, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-neutral-400">
                Your first invoice is issued when this period closes.
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* ── Pay by JazzCash ────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-teal-200 bg-teal-50/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">How to pay</p>
              <h2 className="text-lg font-bold text-neutral-900">{jazzCash?.label || 'JazzCash'}</h2>
            </div>
            {instructions?.support?.whatsappUrl ? (
              <a
                href={instructions.support.whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                WhatsApp {instructions.support.whatsapp}
              </a>
            ) : null}
          </div>

          {jazzCash ? (
            <>
              <div className="mt-4 rounded-xl border border-teal-200 bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Send payment to</p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-wide text-neutral-900">{jazzCash.accountNumber}</p>
                <p className="text-sm text-neutral-600">{jazzCash.accountTitle}</p>
              </div>
              <ol className="mt-4 space-y-2 text-sm text-neutral-700">
                {jazzCash.steps.map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="mt-4 text-sm text-neutral-600">
              Contact support on WhatsApp to arrange payment.
            </p>
          )}

          <p className="mt-4 text-xs text-neutral-500">
            Invoices are due {instructions?.terms?.dueDays ?? 7} days after they are issued.
            {instructions?.support?.note ? ` ${instructions.support.note}` : ''}
          </p>
        </Card>

        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">After you have sent it</p>
          <h2 className="text-lg font-bold text-neutral-900">Submit your transaction ID</h2>
          <p className="mt-1 text-sm text-neutral-500">
            We check every transfer against the JazzCash statement before marking an invoice paid.
          </p>

          {canManageBilling ? (
            <form onSubmit={submitPayment} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-neutral-600">Invoice</span>
                <select
                  value={form.invoiceId}
                  onChange={(event) => {
                    const invoiceId = event.target.value;
                    const invoice = (summary?.invoices || []).find((item) => item.id === invoiceId);
                    setForm((previous) => ({
                      ...previous,
                      invoiceId,
                      amount: invoice ? String(invoice.amountDue) : previous.amount,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                >
                  <option value="">Advance / no specific invoice</option>
                  {(summary?.invoices || [])
                    .filter((invoice) => invoice.status === 'OPEN')
                    .map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.number} — {money(invoice.amountDue, invoice.currency)} due
                      </option>
                    ))}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-neutral-600">
                    {jazzCash?.referenceLabel || 'Transaction ID (TID)'}
                  </span>
                  <input
                    required
                    inputMode="numeric"
                    value={form.reference}
                    onChange={(event) => setForm((previous) => ({ ...previous, reference: event.target.value }))}
                    placeholder="123456789012"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-neutral-600">Amount sent ({currency})</span>
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={form.amount}
                    onChange={(event) => setForm((previous) => ({ ...previous, amount: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm tabular-nums"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-neutral-600">Date sent</span>
                  <input
                    required
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={form.paidAt}
                    onChange={(event) => setForm((previous) => ({ ...previous, paidAt: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-neutral-600">Sender mobile number</span>
                  <input
                    value={form.senderPhone}
                    onChange={(event) => setForm((previous) => ({ ...previous, senderPhone: event.target.value }))}
                    placeholder="03xxxxxxxxx"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm tabular-nums"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-700">
                      Payment screenshot
                      <span className="ml-1.5 font-normal text-neutral-500">(recommended)</span>
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
                      {proof
                        ? proof.name
                        : 'Attach the JazzCash confirmation. Transfers with a receipt are verified the same day; without one we wait for the statement.'}
                    </p>
                  </div>
                  {proof ? (
                    <button
                      type="button"
                      onClick={() => setProof(null)}
                      className="shrink-0 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-100"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <input
                  id="payment-proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  onChange={(event) => {
                    const [file] = event.target.files || [];
                    // Caught here as well as on the server, so a cashier on a
                    // slow connection is told before the upload, not after it.
                    if (file && file.size > 5 * 1024 * 1024) {
                      setError('That screenshot is larger than 5 MB. Send a smaller one.');
                      event.target.value = '';
                      return;
                    }
                    setError('');
                    setProof(file || null);
                  }}
                />
                <label
                  htmlFor="payment-proof"
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-100"
                >
                  {proof ? 'Choose a different file' : 'Choose screenshot'}
                </label>
              </div>

              <p className="text-xs text-neutral-500">{jazzCash?.referenceHint}</p>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit payment for verification'}
              </button>
            </form>
          ) : (
            <p className="mt-4 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
              You need the <strong>billing.manage</strong> permission to submit a payment.
            </p>
          )}
        </Card>
      </section>

      {/* ── Invoices ───────────────────────────────────────────────── */}
      <Card className="p-0">
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 className="text-lg font-bold text-neutral-900">Invoices</h2>
          <p className="text-sm text-neutral-500">Every closed period, with the exact orders it charged for.</p>
        </div>
        {(summary?.invoices || []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Invoice</th>
                  <th className="px-5 py-3 font-semibold">Period</th>
                  <th className="px-5 py-3 text-right font-semibold">{unitLabel}s</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 text-right font-semibold">Due</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {summary.invoices.map((invoice) => (
                  <Fragment key={invoice.id}>
                    <tr className="hover:bg-neutral-50/60">
                      <td className="px-5 py-3 font-semibold tabular-nums text-neutral-900">{invoice.number}</td>
                      <td className="px-5 py-3 text-neutral-600">{formatPeriod(invoice.periodStart, invoice.periodEnd)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">{Number(invoice.meteredQuantity ?? 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-neutral-900">{money(invoice.total, invoice.currency)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-700">
                        {invoice.amountDue > 0 ? money(invoice.amountDue, invoice.currency) : '—'}
                      </td>
                      <td className="px-5 py-3"><Badge value={invoice.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setOpenInvoiceId(openInvoiceId === invoice.id ? null : invoice.id)}
                          className="text-xs font-semibold text-teal-700 hover:underline"
                        >
                          {openInvoiceId === invoice.id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {openInvoiceId === invoice.id ? (
                      <tr className="bg-neutral-50/70">
                        <td colSpan={7} className="px-5 py-4">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                            Charges · issued {formatDate(invoice.issuedAt)} · due {formatDate(invoice.dueAt)}
                          </p>
                          <table className="w-full text-sm">
                            <tbody className="divide-y divide-neutral-200">
                              {invoice.lines.map((line) => (
                                <tr key={line.id}>
                                  <td className="py-2 text-neutral-700">{line.description}</td>
                                  <td className="py-2 text-right tabular-nums text-neutral-600">{Number(line.quantity ?? 0).toLocaleString()}</td>
                                  <td className="py-2 text-right font-semibold tabular-nums text-neutral-900">
                                    {money(line.amount, invoice.currency)}
                                  </td>
                                </tr>
                              ))}
                              <tr>
                                <td className="py-2 font-bold text-neutral-900">Total</td>
                                <td />
                                <td className="py-2 text-right font-bold tabular-nums text-neutral-900">
                                  {money(invoice.total, invoice.currency)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">
            No invoices yet. Your first one is issued when the current period closes.
          </p>
        )}
      </Card>

      {/* ── Payment history ────────────────────────────────────────── */}
      <Card className="p-0">
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 className="text-lg font-bold text-neutral-900">Payments you have submitted</h2>
        </div>
        {(summary?.payments || []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Submitted</th>
                  <th className="px-5 py-3 font-semibold">Method</th>
                  <th className="px-5 py-3 font-semibold">Reference</th>
                  <th className="px-5 py-3 font-semibold">Invoice</th>
                  <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {summary.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-5 py-3 text-neutral-600">{formatDate(payment.createdAt)}</td>
                    <td className="px-5 py-3 text-neutral-700">{String(payment.method).replaceAll('_', ' ')}</td>
                    <td className="px-5 py-3 font-mono text-xs text-neutral-700">{payment.reference}</td>
                    <td className="px-5 py-3 text-neutral-600">{payment.invoiceNumber || '—'}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {money(payment.amount, payment.currency)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge value={payment.status} />
                      {payment.status === 'REJECTED' && payment.reviewNote ? (
                        <p className="mt-1 text-xs text-red-600">{payment.reviewNote}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-neutral-500">No payments submitted yet.</p>
        )}
      </Card>
    </div>
  );
}
