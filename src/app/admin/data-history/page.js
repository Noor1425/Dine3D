'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';

const isoDate = (date) => date.toISOString().slice(0, 10);
const today = () => isoDate(new Date());
const daysAgo = (days) => isoDate(new Date(Date.now() - days * 86400000));
const presets = [
  ['Today', 0], ['7 days', 6], ['30 days', 29], ['90 days', 89], ['1 year', 364]
];

export default function DataHistoryPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [recentExports, setRecentExports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState('');
  const query = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [summary, exportsResult] = await Promise.all([api.get(`/exports/history/summary?${query}`), api.get('/exports/history/exports')]);
      setData(summary); setRecentExports(exportsResult.data || []);
    }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const download = async (kind, format, endpoint) => {
    // Which card and which of its two buttons, so only the one pressed shows
    // as busy rather than the whole card going dead.
    setDownloading({ key: kind, format }); setError('');
    try { await api.download(endpoint, `${kind}.${format}`); await load(); }
    catch (downloadError) { setError(downloadError.message); }
    finally { setDownloading(null); }
  };

  const currency = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: data?.restaurant?.currency || 'PKR', maximumFractionDigits: 2 }).format(Number(value || 0));
  const oldest = data?.availability?.earliestOrderAt ? new Date(data.availability.earliestOrderAt).toLocaleDateString() : 'No order records yet';

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black text-neutral-900">Data & history</h1><p className="mt-1 text-sm text-neutral-500">Review preserved sales and operations records for your current location scope.</p></div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-bold text-neutral-700 shadow-sm disabled:opacity-50">Refresh</button>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1 text-xs font-bold text-neutral-500">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900" /></label>
          <label className="min-w-40 flex-1 text-xs font-bold text-neutral-500">To<input type="date" value={to} min={from} max={today()} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900" /></label>
          <div className="flex flex-wrap gap-2">{presets.map(([label, days]) => <button key={label} onClick={() => { setFrom(daysAgo(days)); setTo(today()); }} className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-200">{label}</button>)}</div>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
      {loading && !data ? <div className="h-56 animate-pulse rounded-2xl bg-neutral-200" /> : data && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Net sales after refunds" value={currency(data.sales.netAfterRefunds)} detail={`${data.sales.orders.toLocaleString()} orders`} />
          <Metric label="Gross sales" value={currency(data.sales.grossSales)} detail={`${currency(data.sales.refunds)} refunded`} />
          <Metric label="Average ticket" value={currency(data.sales.averageTicket)} detail={`${currency(data.sales.discounts)} discounts`} />
          <Metric label="Inventory valuation now" value={currency(data.operations.inventoryValuation)} detail={`${data.operations.stockMovements.count.toLocaleString()} movements in period`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Breakdown title="Order status" rows={data.breakdowns.statuses} currency={currency} />
          <Breakdown title="Order channels" rows={data.breakdowns.orderTypes} currency={currency} />
          <Breakdown title="Recorded payment methods" rows={data.breakdowns.paymentMethods} currency={currency} />
        </div>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black text-neutral-900">Export center</h2><p className="mt-1 text-sm text-neutral-500">Every file opens in Excel with a header block naming the restaurant, branches, period and currency, and ends with a totals row. Exports respect your current restaurant, assigned locations, and selected date range.</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Audit logged</span></div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <ExportCard title="Orders" detail="Every order line by line: items, customer, tax, service charge, tip, refunds and net — totalled at the bottom." busy={downloading?.key === 'orders' ? downloading.format : null} onDownload={(format) => download('orders', format, `/exports/orders.${format}?${query}`)} />
            <ExportCard title="Inventory movements" detail="Every addition, deduction, reversal and count — with stock before and after, who did it, and what it was worth." busy={downloading?.key === 'inventory-movements' ? downloading.format : null} onDownload={(format) => download('inventory-movements', format, `/exports/inventory-movements.${format}?${query}`)} />
            <ExportCard title="Current inventory" detail="What is on the shelf right now, flagged OK / LOW / OUT OF STOCK, valued at cost." busy={downloading?.key === 'inventory' ? downloading.format : null} onDownload={(format) => download('inventory', format, `/exports/inventory.${format}`)} />
          </div>
        </section>

        {recentExports.length > 0 && <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><div className="border-b border-neutral-100 p-5"><h2 className="font-black text-neutral-900">Recent export register</h2><p className="mt-1 text-xs text-neutral-500">Integrity checksums and access scope are retained for audit evidence.</p></div><div className="divide-y divide-neutral-100">{recentExports.slice(0, 8).map((item) => <div key={item.id} className="grid min-w-0 gap-2 p-4 text-sm sm:grid-cols-[1fr_auto_auto]"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate font-bold text-neutral-800">{item.dataset.replaceAll('_', ' ')}</span><span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${item.format === 'XLSX' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>{item.format === 'XLSX' ? 'Excel' : item.format}</span></div><div className="truncate font-mono text-[10px] text-neutral-400">SHA-256 {item.checksumSha256}</div></div><span className="text-xs font-bold text-neutral-500">{item.scope}</span><span className="text-xs text-neutral-500">{new Date(item.createdAt).toLocaleString()}</span></div>)}</div></section>}

        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
          <h2 className="font-black">What is preserved?</h2>
          <p className="mt-2 leading-6">Order prices, taxes, discounts, modifiers, tips, refunds, and timestamps are stored as transaction-time snapshots. Your oldest available order is <strong>{oldest}</strong>. Platform disaster-recovery backups are encrypted and controlled by Dine3D operators; they are not downloadable tenant files.</p>
        </section>
      </>}
    </div>
  );
}

function Metric({ label, value, detail }) {
  return <div className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</div><div className="mt-2 truncate text-2xl font-black text-neutral-900" title={value}>{value}</div><div className="mt-1 truncate text-xs text-neutral-500" title={detail}>{detail}</div></div>;
}

function Breakdown({ title, rows, currency }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><h2 className="border-b border-neutral-100 p-4 font-black text-neutral-900">{title}</h2><div className="divide-y divide-neutral-100">{rows.length ? rows.map((row) => <div key={row.key} className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 text-sm"><div className="min-w-0"><div className="truncate font-bold text-neutral-800">{String(row.key).replaceAll('_', ' ')}</div><div className="text-xs text-neutral-500">{row.count.toLocaleString()} orders</div></div><div className="shrink-0 font-bold text-neutral-700">{currency(row.amount)}</div></div>) : <div className="p-8 text-center text-sm text-neutral-500">No records in this period</div>}</div></section>;
}

/**
 * Two formats, and the order matters.
 *
 * Excel is what the owner opens: it arrives formatted, with the money in their
 * own currency, the header frozen and the totals reading as totals. CSV is what
 * an accountant's software swallows — plain text, no formatting possible — so
 * it stays, in second place.
 */
function ExportCard({ title, detail, busy, onDownload }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-neutral-200 p-4">
      <div className="font-black text-neutral-900">{title}</div>
      <p className="mt-1 flex-1 text-xs leading-5 text-neutral-500">{detail}</p>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onDownload('xlsx')}
          disabled={Boolean(busy)}
          className="flex-1 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}
        </button>
        <button
          onClick={() => onDownload('csv')}
          disabled={Boolean(busy)}
          title="Plain text, for accounting software"
          className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {busy === 'csv' ? '…' : 'CSV'}
        </button>
      </div>
    </div>
  );
}
