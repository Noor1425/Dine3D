'use client';

import { useEffect, useState } from 'react';
import saApi from '@/lib/saApi';
import StatusBadge from '@/components/superadmin/StatusBadge';

export default function BillingEventsPage() {
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ status: '', provider: '', restaurant: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (overrides = {}) => {
    setLoading(true);
    setError('');
    try {
      const effective = { ...filters, ...overrides };
      const query = new URLSearchParams();
      Object.entries(effective).forEach(([key, value]) => { if (value) query.set(key, value); });
      const result = await saApi.getBillingEvents(query.toString());
      setEvents(result.events || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const requested = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('status') || ''
      : '';
    setFilters((current) => ({ ...current, status: requested }));
    load({ status: requested });
  }, []);

  const field = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Billing events</h1>
        <p className="mt-1 text-sm text-sa-500">Provider and manual subscription synchronization events. Manual events are not proof of payment or revenue.</p>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); load(); }} className="grid gap-2 rounded-2xl border border-sa-800 bg-sa-900 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <select value={filters.status} onChange={(event) => field('status', event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm">
          <option value="">All statuses</option><option>RECEIVED</option><option>PROCESSED</option><option>FAILED</option><option>IGNORED</option>
        </select>
        <input value={filters.provider} onChange={(event) => field('provider', event.target.value)} placeholder="Provider" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <input value={filters.restaurant} onChange={(event) => field('restaurant', event.target.value)} placeholder="Restaurant name or slug" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <input type="date" aria-label="From date" value={filters.from} onChange={(event) => field('from', event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <input type="date" aria-label="To date" value={filters.to} onChange={(event) => field('to', event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <button disabled={loading} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-black disabled:opacity-50 text-sa-950">Apply filters</button>
      </form>
      {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-red-300">{error}</div>}
      <div className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
        {loading ? <div className="h-48 animate-pulse" /> : events.length ? (
          <div className="divide-y divide-sa-800">
            {events.map((item) => (
              <div key={item.id} className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_1fr_auto]">
                <div><div className="font-bold">{item.eventType}</div><div className="text-xs text-sa-500">{item.provider} · {item.eventId}</div></div>
                <div className="text-xs text-sa-500">Restaurant {item.restaurantId || 'unresolved'} · attempts {item.attempts}<br />{item.error || new Date(item.createdAt).toLocaleString()}</div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        ) : <div className="p-12 text-center text-sm text-sa-500">No billing events match these filters.</div>}
      </div>
    </div>
  );
}
