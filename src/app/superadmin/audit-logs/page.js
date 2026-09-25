'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, RefreshCw, X } from 'lucide-react';
import saApi from '@/lib/saApi';

const format = (value) => value ? new Date(value).toLocaleString() : '—';
export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [action, setAction] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (action) query.set('action', action);
      if (restaurantId) query.set('restaurantId', restaurantId);
      query.set('limit', '100');
      const result = await saApi.getAdminAuditLogs(query.toString());
      setLogs(result.logs || []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const [exporting, setExporting] = useState(null);

  /**
   * Built on the server, not here.
   *
   * This used to assemble a CSV in the browser from whatever page was loaded,
   * which capped an audit export at 100 rows and could never be anything but
   * plain text. The endpoint applies the same filters and returns the whole
   * matching history, formatted the same way as every other export.
   */
  const exportActivity = async (format) => {
    setExporting(format);
    try {
      const query = new URLSearchParams();
      if (action) query.set('action', action);
      if (restaurantId) query.set('restaurantId', restaurantId);
      await saApi.downloadAuditLogs(format, query.toString());
    } catch (error) {
      toast.error(error.message || 'That export could not be generated');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black">Activity feed</h1><p className="text-sm text-sa-500 mt-1">Immutable who, what, when, why, and correlation context for control-plane changes.</p></div>
        <div className="flex gap-2"><button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-xl border border-sa-700 px-3 py-2 text-xs font-bold text-sa-300 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button><button onClick={() => exportActivity('xlsx')} disabled={Boolean(exporting)} className="flex items-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-xs font-black text-sa-950 disabled:opacity-40"><Download className="h-3.5 w-3.5" />{exporting === 'xlsx' ? 'Preparing…' : 'Export Excel'}</button><button onClick={() => exportActivity('csv')} disabled={Boolean(exporting)} title="Plain text, for other tools" className="rounded-xl border border-sa-700 px-3 py-2 text-xs font-bold text-sa-300 disabled:opacity-40">{exporting === 'csv' ? '…' : 'CSV'}</button></div>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); load(); }} className="grid md:grid-cols-[1fr_1fr_auto] gap-3 rounded-2xl border border-sa-800 bg-sa-900 p-4">
        <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Action, e.g. subscription.suspended" className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
        <input value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)} placeholder="Restaurant UUID" className="rounded-xl bg-sa-950 border border-sa-700 px-3 py-2" />
        <button className="rounded-xl bg-brand-500 px-5 py-2 font-black text-sa-950">Filter</button>
      </form>

      <div className="rounded-2xl border border-sa-800 bg-sa-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sa-950 text-sa-500 text-xs uppercase">
              <tr>
                <th className="text-left p-4">Time</th>
                <th className="text-left p-4">Action</th>
                <th className="text-left p-4">Actor</th>
                <th className="text-left p-4">Restaurant</th>
                <th className="text-left p-4">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sa-800">
              {logs.map((log) => (
                <tr key={log.id} onClick={() => setSelected(log)} className="hover:bg-sa-800/70 cursor-pointer">
                  <td className="p-4 whitespace-nowrap text-sa-400">{format(log.createdAt)}</td>
                  <td className="p-4 font-bold">{log.action}</td>
                  <td className="p-4"><div className="font-semibold">{log.actor?.name || log.actor?.email || log.actorRole}</div><div className="text-[11px] text-sa-600">{log.actor?.email || `${log.actorRole} · ${log.actorId}`}</div></td>
                  <td className="p-4 text-sa-400">{log.restaurant?.name || log.restaurantId || 'Platform'}</td>
                  <td className="p-4 text-sa-400 max-w-sm truncate">{log.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="p-8 text-center text-sa-500">Loading audit records…</div>}
        {!loading && !logs.length && <div className="p-8 text-center text-sa-500">No audit records match these filters.</div>}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setSelected(null)}>
          <section className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl border border-sa-700 bg-sa-900 p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-between gap-3">
              <div><h2 className="text-xl font-black">{selected.action}</h2><p className="text-xs text-sa-500 mt-1">{selected.id}</p></div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-1 text-sa-400 hover:bg-sa-800" aria-label="Close audit details"><X className="h-4 w-4" /></button>
            </div>
            <dl className="grid md:grid-cols-2 gap-3 mt-5 text-sm">
              <div><dt className="text-sa-500">Actor</dt><dd className="font-bold">{selected.actor?.name || selected.actor?.email || selected.actorRole}</dd><dd className="text-xs text-sa-600">{selected.actorRole} · {selected.actorId}</dd></div>
              <div><dt className="text-sa-500">Source</dt><dd className="font-bold">{selected.source}</dd></div>
              <div><dt className="text-sa-500">Correlation ID</dt><dd className="font-bold">{selected.correlationId || '—'}</dd></div>
              <div><dt className="text-sa-500">Recorded</dt><dd className="font-bold">{format(selected.createdAt)}</dd></div>
            </dl>
            <div className="mt-5"><div className="text-xs uppercase text-sa-500 font-bold">Reason</div><p className="mt-1">{selected.reason || '—'}</p></div>
            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <div><div className="text-xs uppercase text-sa-500 font-bold mb-2">Old value</div><pre className="rounded-xl bg-sa-950 p-3 text-xs overflow-auto">{JSON.stringify(selected.oldValue, null, 2) || 'null'}</pre></div>
              <div><div className="text-xs uppercase text-sa-500 font-bold mb-2">New value</div><pre className="rounded-xl bg-sa-950 p-3 text-xs overflow-auto">{JSON.stringify(selected.newValue, null, 2) || 'null'}</pre></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
