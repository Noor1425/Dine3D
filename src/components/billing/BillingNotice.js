'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

/**
 * What a restaurant is told before its till stops taking orders.
 *
 * The only warning used to be a strip reading "Subscription status: PAST DUE",
 * shown once the subscription had already flipped — by which point the POS was
 * refusing new orders and a cashier was standing in front of a customer trying
 * to work out why. Nothing appeared during the fortnight when paying would
 * still have prevented it.
 *
 * So this counts down instead of reporting: how much, by when, and what stops.
 * It says "nine days" while nine days remain, and it says it in money and dates
 * rather than in a status name nobody outside the company uses.
 */

const money = (amount, currency) => {
  const value = Number(amount || 0);
  const symbol = { PKR: 'Rs ', USD: '$', GBP: '£', EUR: '€', AED: 'AED ', SAR: 'SAR ' }[currency] || `${currency} `;
  return `${symbol}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const onDate = (value) => (value
  ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
  : null);

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** What to say, how loudly, and what the restaurant should do about it. */
function notice(standing) {
  const amount = money(standing.amountDue, standing.currency);
  const days = Number(standing.daysRemaining);

  switch (standing.state) {
    case 'period_ending':
      return {
        tone: 'calm',
        headline: days <= 0
          ? `Your ${standing.planName || ''} month ends today`.replace('  ', ' ')
          : `Your month ends in ${plural(days, 'day', 'days')}`,
        detail: `${amount} will be invoiced on ${onDate(standing.periodEnd)}, with ${plural(standing.payWithinDays, 'day', 'days')} to pay. Nothing changes before then.`,
        action: 'View billing',
      };
    case 'under_review':
      return {
        tone: 'calm',
        headline: `We have your ${amount} payment and are checking it`,
        detail: 'Transfers are matched against the JazzCash statement by hand, usually within one business day. Nothing stops while we do that.',
        action: 'View payment',
      };
    case 'due_soon':
      return {
        tone: 'notice',
        headline: `${amount} is due ${days <= 0 ? 'today' : `in ${plural(days, 'day', 'days')}`}`,
        detail: `Invoice ${standing.invoiceNumber} · due ${onDate(standing.dueAt)}. Pay by JazzCash and send the receipt — it takes a minute.`,
        action: 'Pay now',
      };
    case 'overdue':
      return {
        tone: 'warn',
        headline: `${amount} is overdue`,
        detail: `Invoice ${standing.invoiceNumber} was due ${onDate(standing.dueAt)}. Your till keeps taking orders until ${onDate(standing.cutoffAt)}.`,
        action: 'Pay now',
      };
    case 'stopping_soon':
      return {
        tone: 'urgent',
        headline: days <= 0
          ? `Your till pauses today unless ${amount} is paid`
          : `Your till pauses in ${plural(days, 'day', 'days')}`,
        detail: `${amount} outstanding on invoice ${standing.invoiceNumber}. Nothing is lost — your orders, menu and stock stay exactly as they are, and everything restarts the moment the payment clears.`,
        action: 'Pay now',
      };
    case 'stopped':
      return {
        tone: 'stopped',
        headline: 'Your till is paused',
        detail: standing.paymentUnderReview
          ? `Your ${money(standing.claimedAmount, standing.currency)} payment is being checked. Everything restarts as soon as it clears — nothing has been lost.`
          : `${amount} outstanding. Nothing has been lost: your orders, menu, stock and staff are all exactly where you left them, and everything restarts the moment the payment clears.`,
        action: standing.paymentUnderReview ? 'View payment' : 'Pay now',
      };
    default:
      return null;
  }
}

const TONES = {
  calm:    'bg-sky-50 text-sky-900 border-sky-200 hover:bg-sky-100',
  notice:  'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100',
  warn:    'bg-orange-50 text-orange-900 border-orange-200 hover:bg-orange-100',
  urgent:  'bg-red-50 text-red-900 border-red-300 hover:bg-red-100',
  stopped: 'bg-red-600 text-white border-red-700 hover:bg-red-700',
};

export default function BillingNotice({ canSeeBilling = true }) {
  const [standing, setStanding] = useState(null);

  useEffect(() => {
    if (!canSeeBilling) return undefined;
    let cancelled = false;
    const load = () => api.getBillingStanding()
      .then((result) => { if (!cancelled) setStanding(result?.standing || null); })
      // A billing warning that cannot load must not break the page it sits on.
      .catch(() => {});
    load();
    // Slow on purpose. This is a countdown in days; polling it harder would
    // only add requests to every screen in the product.
    const timer = setInterval(load, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [canSeeBilling]);

  if (!standing) return null;
  const content = notice(standing);
  if (!content) return null;

  return (
    <Link
      href="/admin/billing"
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-4 py-2.5 text-xs transition md:px-8 ${TONES[content.tone]}`}
      role={content.tone === 'stopped' || content.tone === 'urgent' ? 'alert' : undefined}
    >
      <span className="font-bold">{content.headline}</span>
      <span className="opacity-90">{content.detail}</span>
      <span className="ml-auto whitespace-nowrap font-bold underline underline-offset-2">
        {content.action} →
      </span>
    </Link>
  );
}
