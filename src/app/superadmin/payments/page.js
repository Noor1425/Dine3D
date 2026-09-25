'use client';

import { useCallback, useEffect, useState } from 'react';
import saApi from '@/lib/saApi';
import StatusBadge from '@/components/superadmin/StatusBadge';

const money = (value, currency = 'PKR') => {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const formatDateTime = (value) => (value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—');

const TABS = [
  { key: 'PENDING', label: 'Awaiting verification' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

export default function ManualPaymentsPage() {
  const [tab, setTab] = useState('PENDING');
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async (status) => {
    setLoading(true);
    setError('');
    try {
      const result = await saApi.getPaymentSubmissions(status);
      setPayments(result.payments || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const draftFor = (payment) => drafts[payment.id] || {
    creditedAmount: String(Number(payment.amount)),
    note: '',
    reason: '',
  };

  const setDraft = (id, patch) => setDrafts((current) => ({
    ...current,
    [id]: { ...(current[id] || {}), ...patch },
  }));

  const verify = async (payment) => {
    const draft = draftFor(payment);
    const credited = Number(draft.creditedAmount);
    if (!(credited > 0) || credited > Number(payment.amount)) {
      setError('The credited amount must be greater than zero and no more than the amount claimed.');
      return;
    }
    if (!window.confirm(
      `Credit ${money(credited, payment.currency)} against ${payment.invoice?.number || 'no invoice'}?\n\n`
      + `Confirm this transaction appears in the JazzCash statement first — this releases service to the restaurant.`
    )) return;

    setBusyId(payment.id);
    setError('');
    setNotice('');
    try {
      const result = await saApi.verifyPaymentSubmission(payment.id, {
        creditedAmount: credited,
        note: draft.note || null,
      });
      setNotice(
        `Credited ${money(result.creditedAmount, payment.currency)}.`
        + (result.invoice?.status === 'PAID' ? ` Invoice ${result.invoice.number || ''} is settled.` : '')
        + (result.reactivated ? ' Subscription reactivated.' : '')
      );
      await load(tab);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId('');
    }
  };

  const reject = async (payment) => {
    const draft = draftFor(payment);
    if (!draft.reason || draft.reason.trim().length < 5) {
      setError('Give a reason the restaurant can act on (at least 5 characters).');
      return;
    }
    setBusyId(payment.id);
    setError('');
    setNotice('');
    try {
      await saApi.rejectPaymentSubmission(payment.id, { reason: draft.reason.trim() });
      setNotice('Payment rejected. The restaurant can see your reason.');
      await load(tab);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId('');
    }
  };

  const pendingTotal = payments
    .filter((payment) => payment.status === 'PENDING')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Manual payments</h1>
        <p className="mt-1 text-sm text-sa-500">
          JazzCash and bank transfers declared by restaurants. Check each one against the wallet statement before
          crediting — verifying releases service.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-xl px-4 py-2 text-sm font-black transition ${
              tab === item.key
                ? 'bg-orange-500 text-sa-950'
                : 'border border-sa-700 bg-sa-900 text-sa-300 hover:bg-sa-800'
            }`}
          >
            {item.label}
          </button>
        ))}
        {tab === 'PENDING' && payments.length ? (
          <span className="ml-auto rounded-xl border border-sa-700 bg-sa-900 px-4 py-2 text-sm">
            <span className="text-sa-500">Claimed and unverified: </span>
            <span className="font-black tabular-nums">{money(pendingTotal)}</span>
          </span>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-800 bg-emerald-500/10 p-4 text-sm text-emerald-300">{notice}</div>
      ) : null}

      {loading ? (
        <div className="h-48 animate-pulse rounded-2xl border border-sa-800 bg-sa-900" />
      ) : payments.length ? (
        <div className="space-y-3">
          {payments.map((payment) => {
            const draft = draftFor(payment);
            const isPending = payment.status === 'PENDING';
            return (
              <div key={payment.id} className="rounded-2xl border border-sa-800 bg-sa-900 p-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black">{payment.restaurant?.name || 'Unknown restaurant'}</span>
                      <StatusBadge status={payment.status} />
                      <span className="rounded-full border border-sa-700 px-2 py-0.5 text-[11px] text-sa-400">
                        {String(payment.method).replaceAll('_', ' ')}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                      <dt className="text-sa-500">Reference (TID)</dt>
                      <dd className="font-mono">{payment.reference}</dd>
                      <dt className="text-sa-500">Amount claimed</dt>
                      <dd className="font-black tabular-nums">{money(payment.amount, payment.currency)}</dd>
                      <dt className="text-sa-500">Sent by restaurant</dt>
                      <dd>{formatDateTime(payment.paidAt)}</dd>
                      <dt className="text-sa-500">Submitted</dt>
                      <dd>{formatDateTime(payment.createdAt)}</dd>
                      <dt className="text-sa-500">Sender</dt>
                      <dd>{payment.senderName || '—'}{payment.senderPhone ? ` · ${payment.senderPhone}` : ''}</dd>
                      <dt className="text-sa-500">Invoice</dt>
                      <dd>
                        {payment.invoice
                          ? `${payment.invoice.number} · ${money(payment.invoice.amountDue, payment.currency)} due`
                          : 'Advance / unallocated'}
                      </dd>
                    </dl>
                    {payment.hasProof ? (
                      <a
                        href={saApi.paymentProofUrl(payment.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="group block w-fit rounded-xl border border-sa-700 bg-sa-950 p-2 transition hover:border-sa-500"
                      >
                        <img
                          src={saApi.paymentProofUrl(payment.id)}
                          alt={`Receipt for ${payment.reference}`}
                          className="h-36 w-auto max-w-[240px] rounded-lg object-contain"
                          onError={(event) => {
                            // A PDF receipt cannot render in an <img>. Fall back
                            // to the link rather than showing a broken image.
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                        <span className="mt-1.5 block text-[11px] font-semibold text-sa-400 group-hover:text-sa-200">
                          Open receipt ↗
                        </span>
                      </a>
                    ) : (
                      <p className="w-fit rounded-lg border border-amber-900/50 bg-amber-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300">
                        No receipt attached — check the JazzCash statement before crediting.
                      </p>
                    )}

                    {payment.reviewedAt ? (
                      <p className="text-xs text-sa-500">
                        Reviewed {formatDateTime(payment.reviewedAt)}
                        {payment.reviewNote ? ` — ${payment.reviewNote}` : ''}
                      </p>
                    ) : null}
                  </div>

                  {isPending ? (
                    <div className="space-y-2 rounded-xl border border-sa-800 bg-sa-950 p-3">
                      <label className="block">
                        <span className="text-[11px] font-black uppercase tracking-wider text-sa-500">
                          Amount to credit
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          max={Number(payment.amount)}
                          value={draft.creditedAmount}
                          onChange={(event) => setDraft(payment.id, { creditedAmount: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-sa-700 bg-sa-900 px-3 py-2 text-sm tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-black uppercase tracking-wider text-sa-500">
                          Verification note
                        </span>
                        <input
                          value={draft.note}
                          onChange={(event) => setDraft(payment.id, { note: event.target.value })}
                          placeholder="Matched against JazzCash statement"
                          className="mt-1 w-full rounded-lg border border-sa-700 bg-sa-900 px-3 py-2 text-sm"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busyId === payment.id}
                        onClick={() => verify(payment)}
                        className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-black text-sa-950 disabled:opacity-50"
                      >
                        {busyId === payment.id ? 'Working…' : 'Verify and credit'}
                      </button>

                      <div className="border-t border-sa-800 pt-2">
                        <input
                          value={draft.reason}
                          onChange={(event) => setDraft(payment.id, { reason: event.target.value })}
                          placeholder="Reason for rejection"
                          className="w-full rounded-lg border border-sa-700 bg-sa-900 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          disabled={busyId === payment.id}
                          onClick={() => reject(payment)}
                          className="mt-2 w-full rounded-lg border border-red-800 bg-red-500/10 px-4 py-2 text-sm font-black text-red-300 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-sa-800 bg-sa-900 p-10 text-center text-sm text-sa-500">
          Nothing here. {tab === 'PENDING' ? 'Every declared payment has been reviewed.' : ''}
        </div>
      )}
    </div>
  );
}
