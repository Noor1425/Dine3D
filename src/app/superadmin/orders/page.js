'use client';
import { useState, useEffect } from 'react';
import saApi from '@/lib/saApi';

const STATUS_COLORS = {
  PENDING:   'text-amber-400 border-amber-400/20 bg-amber-400/5',
  CONFIRMED: 'text-blue-400 border-blue-400/20 bg-blue-400/5',
  PREPARING: 'text-purple-400 border-purple-400/20 bg-purple-400/5',
  READY:     'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  SERVED:    'text-teal-400 border-teal-400/20 bg-teal-400/5',
  COMPLETED: 'text-sa-400 border-sa-400/20 bg-sa-400/5',
  CANCELLED: 'text-red-400 border-red-400/20 bg-red-400/5',
  FAILED:    'text-red-400 border-red-400/20 bg-red-400/5',
  PICKED_UP: 'text-sky-400 border-sky-400/20 bg-sky-400/5',
  DELIVERED: 'text-green-400 border-green-400/20 bg-green-400/5',
};

const formatTime = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function SuperAdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [restaurant, setRestaurant] = useState('');
  const [location, setLocation] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [failureType, setFailureType] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const load = async (overrides = {}) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const filters = { status, source, restaurantId, restaurant, location, from, to, paymentStatus, failureType, ...overrides };
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      params.set('page', page);
      params.set('limit', '25');
      const data = await saApi.getOrders(params.toString());
      setOrders(data.orders || []);
      setPagination(data.pagination || {});
    } catch (e) { setError(e.message || 'Orders could not be loaded'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const today = new Date().toISOString().slice(0, 10);
    const initial = {
      status: params.get('status') || '', source: params.get('source') || '',
      restaurantId: params.get('restaurantId') || '', paymentStatus: params.get('paymentStatus') || '',
      failureType: params.get('failureType') || '',
      from: params.get('range') === 'today' ? today : params.get('from') || '',
      to: params.get('range') === 'today' ? today : params.get('to') || ''
    };
    setStatus(initial.status); setSource(initial.source); setRestaurantId(initial.restaurantId);
    setPaymentStatus(initial.paymentStatus); setFailureType(initial.failureType); setFrom(initial.from); setTo(initial.to);
    load(initial).finally(() => setInitialized(true));
  }, []);
  useEffect(() => { if (initialized) load(); }, [status, source, page]);

  const STATUSES = ['', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED', 'FAILED'];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Orders</h1>
          <p className="text-sa-500 text-sm mt-1">Every order placed across all restaurants</p>
        </div>
        <div className="text-sm text-sa-500">{pagination.total ?? 0} total orders</div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1 bg-sa-900 border border-sa-800 rounded-xl p-1 w-fit mb-6">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${status === s ? 'bg-orange-500 text-white' : 'text-sa-400 hover:text-white'}`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setPage(1); load(); }} className="mb-6 grid gap-2 rounded-2xl border border-sa-800 bg-sa-900 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input value={restaurant} onChange={(event) => setRestaurant(event.target.value)} placeholder="Restaurant name or slug" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location name" className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">All sources</option><option value="QR">QR</option><option value="POS">POS</option></select>
        <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">All payment states</option><option>UNPAID</option><option>PARTIAL</option><option>PAID</option><option>REFUNDED</option><option>FAILED</option></select>
        <select value={failureType} onChange={(event) => setFailureType(event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm"><option value="">All outcomes</option><option value="submission">Submission failures</option></select>
        <input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-sm" />
        <button className="w-fit rounded-xl bg-brand-500 px-4 py-2 text-sm font-black text-sa-950">Apply filters</button>
      </form>
      {error && <div role="alert" className="mb-5 rounded-xl border border-red-800 bg-red-500/10 p-4 text-red-300">{error} <button onClick={() => load()} className="font-black underline">Retry</button></div>}

      {/* Table */}
      <div className="bg-sa-900 border border-sa-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-sa-600">No orders found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-sa-800 bg-sa-950/50">
                    {['Time', 'Restaurant / location', 'Source', 'Items', 'Total', 'Status'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-bold uppercase tracking-widest text-sa-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-sa-800">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-sa-800/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="text-xs font-mono text-sa-400">{formatTime(order.createdAt)}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-semibold text-white">{order.restaurant?.name}</div>
                        <div className="text-xs font-mono text-sa-600">/{order.restaurant?.slug}</div>
                        <div className="text-xs text-sa-600">{order.branch?.name || 'No location'}</div>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-bold text-blue-400">{order.source}</td>
                      <td className="px-5 py-3.5 text-sm text-sa-300">
                        {order.items?.map(i => i.menuItem?.name).filter(Boolean).join(', ').slice(0, 40) || '—'}
                        {(order.items?.length || 0) > 2 && <span className="text-sa-500"> +{order.items.length - 2}</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-bold text-white text-sm">{order.restaurant?.currency} {parseFloat(order.grandTotal || 0).toFixed(2)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${STATUS_COLORS[order.status] || STATUS_COLORS.PENDING}`}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-sa-800">
                <span className="text-xs text-sa-500">Page {pagination.page} of {pagination.pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-sa-400 hover:text-white bg-sa-800 hover:bg-sa-700 disabled:opacity-40 transition-all">
                    ← Prev
                  </button>
                  <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-sa-400 hover:text-white bg-sa-800 hover:bg-sa-700 disabled:opacity-40 transition-all">
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
